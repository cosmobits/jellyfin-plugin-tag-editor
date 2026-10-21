using System.IO.Compression;
using System.Net;
using Jellyfin.Plugin.TagEditor.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;

namespace Jellyfin.Plugin.TagEditor.Tests;

public sealed class WebIntegrationTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "jfte-tests-" + Guid.NewGuid());
    private readonly TestServer _server;
    private readonly HttpClient _client;

    public WebIntegrationTests()
    {
        Directory.CreateDirectory(_directory);
        File.WriteAllText(Path.Combine(_directory, "index.html"), "<!doctype html><html><body>Jellyfin</body></html>");
        File.WriteAllText(Path.Combine(_directory, "video.bin"), "unmodified-media");
        _server = new TestServer(new WebHostBuilder()
            .ConfigureServices(services =>
            {
                services.AddTransient<IStartupFilter, WebStartupFilter>();
                services.AddResponseCompression(options =>
                {
                    options.Providers.Add<GzipCompressionProvider>();
                    options.Providers.Add<BrotliCompressionProvider>();
                });
            })
            .Configure(app =>
            {
                app.UseResponseCompression();
                app.Map("/jellyfin", branch =>
                {
                    var files = new PhysicalFileProvider(_directory);
                    branch.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files, RequestPath = "/web" });
                    branch.UseStaticFiles(new StaticFileOptions
                    {
                        FileProvider = files, RequestPath = "/web", ServeUnknownFileTypes = true
                    });
                });
                app.Run(context => { context.Response.StatusCode = 404; return Task.CompletedTask; });
            }));
        _client = _server.CreateClient();
    }

    [Theory]
    [InlineData("/jellyfin/web/index.html", "")]
    [InlineData("/jellyfin/web/", "gzip")]
    [InlineData("/jellyfin/web/index.html", "br")]
    public async Task ShellGetsLoaderWithCorrectFraming(string path, string encoding)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (encoding.Length > 0) request.Headers.AcceptEncoding.ParseAdd(encoding);
        using var response = await _client.SendAsync(request);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(bytes.Length, response.Content.Headers.ContentLength);
        Assert.Equal(encoding, string.Join(",", response.Content.Headers.ContentEncoding));
        using var stream = new MemoryStream(bytes);
        using Stream decoded = encoding switch
        {
            "gzip" => new GZipStream(stream, CompressionMode.Decompress),
            "br" => new BrotliStream(stream, CompressionMode.Decompress),
            _ => stream
        };
        using var reader = new StreamReader(decoded);
        var html = await reader.ReadToEndAsync();
        var version = typeof(Plugin).Assembly.GetName().Version;
        Assert.Contains($"../TagEditor/Client.js?v={version}", html);
        Assert.Contains($"../TagEditor/Client.css?v={version}", html);
        Assert.Equal(1, html.Split("id=\"cosmobits-tag-editor\"").Length - 1);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Null(response.Headers.ETag);
        Assert.Null(response.Content.Headers.LastModified);
    }

    [Fact]
    public async Task ConditionalAndRangeRequestsCannotReuseUnmodifiedShell()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/jellyfin/web/index.html");
        request.Headers.TryAddWithoutValidation("If-None-Match", "*");
        request.Headers.IfModifiedSince = DateTimeOffset.UtcNow.AddDays(1);
        request.Headers.Range = new(0, 4);
        using var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("cosmobits-tag-editor", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task HeadReportsTransformedLengthWithoutBody()
    {
        using var get = await _client.GetAsync("/jellyfin/web/index.html");
        using var head = await _client.SendAsync(new(HttpMethod.Head, "/jellyfin/web/index.html"));
        Assert.Equal(get.Content.Headers.ContentLength, head.Content.Headers.ContentLength);
        Assert.Empty(await head.Content.ReadAsByteArrayAsync());
    }

    [Theory]
    [InlineData("/other/web/index.html", HttpStatusCode.NotFound, "")]
    [InlineData("/jellyfin/web/video.bin", HttpStatusCode.OK, "unmodified-media")]
    public async Task DoesNotBypassJellyfinRoutingOrModifyOtherFiles(string path, HttpStatusCode status, string body)
    {
        using var response = await _client.GetAsync(path);
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(body, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public void AssetsAreEmbeddedAndInjectionIsIdempotent()
    {
        Assert.Contains("JellyfinTagEditor", ClientAssets.Read("tag-editor.js"));
        Assert.Contains("jfte-tag-editor", ClientAssets.Read("tag-editor.css"));
        var once = ClientAssets.Inject("<html><body></body></html>");
        Assert.Equal(once, ClientAssets.Inject(once));
    }

    public void Dispose()
    {
        _client.Dispose();
        _server.Dispose();
        Directory.Delete(_directory, recursive: true);
    }
}
