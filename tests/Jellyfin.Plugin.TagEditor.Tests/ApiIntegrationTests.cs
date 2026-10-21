using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace Jellyfin.Plugin.TagEditor.Tests;

public sealed class ApiIntegrationTests : IDisposable
{
    private readonly TestServer _server;
    private readonly HttpClient _client;
    private readonly TestMovie _item = new() { Id = Guid.NewGuid(), Name = "Film", Tags = ["Original"], Overview = "Keep this" };

    public ApiIntegrationTests()
    {
        var library = new Mock<ILibraryManager>();
        library.Setup(manager => manager.GetItemById(_item.Id)).Returns(_item);
        _server = new TestServer(new WebHostBuilder()
            .ConfigureServices(services =>
            {
                services.AddSingleton(library.Object);
                services.AddSingleton<TagService>();
                services.AddControllers().AddApplicationPart(typeof(TagEditorController).Assembly);
                services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, TestAuthentication>("test", _ => { });
                services.AddAuthorization(options => options.AddPolicy(Policies.RequiresElevation,
                    policy => policy.RequireAuthenticatedUser().RequireClaim("admin", "true")));
            })
            .Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(endpoints => endpoints.MapControllers());
            }));
        _client = _server.CreateClient();
    }

    [Theory]
    [InlineData("", HttpStatusCode.Unauthorized)]
    [InlineData("viewer", HttpStatusCode.Forbidden)]
    [InlineData("admin", HttpStatusCode.OK)]
    public async Task TagsRequireAnAdministrator(string role, HttpStatusCode status)
    {
        if (role.Length > 0) _client.DefaultRequestHeaders.Add("X-Test-Role", role);
        using var response = await _client.GetAsync($"/TagEditor/Items/{_item.Id}/Tags");
        Assert.Equal(status, response.StatusCode);
        using var update = await _client.PutAsJsonAsync($"/TagEditor/Items/{_item.Id}/Tags",
            new { Tags = new[] { "New" }, OriginalTags = new[] { "Original" } });
        Assert.Equal(status, update.StatusCode);
    }

    [Fact]
    public async Task SavesOnlyTagsAndRejectsStaleEditors()
    {
        _client.DefaultRequestHeaders.Add("X-Test-Role", "admin");
        var url = $"/TagEditor/Items/{_item.Id}/Tags";
        using var response = await _client.PutAsJsonAsync(url,
            new { Tags = new[] { " New ", "new", "Other", " " }, OriginalTags = new[] { "Original" } });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(["New", "Other"], _item.Tags);
        Assert.Equal("Keep this", _item.Overview);
        Assert.Equal(1, _item.SaveCount);
        using var stale = await _client.PutAsJsonAsync(url,
            new { Tags = new[] { "Lost update" }, OriginalTags = new[] { "Original" } });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(["New", "Other"], _item.Tags);
        Assert.Equal(1, _item.SaveCount);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"Tags\":null,\"OriginalTags\":[]}")]
    [InlineData("{\"Tags\":[null],\"OriginalTags\":[]}")]
    public async Task InvalidPayloadDoesNotModifyItem(string json)
    {
        _client.DefaultRequestHeaders.Add("X-Test-Role", "admin");
        using var response = await _client.PutAsync($"/TagEditor/Items/{_item.Id}/Tags",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["Original"], _item.Tags);
    }

    [Fact]
    public async Task PublicAssetsWorkWithoutAUser()
    {
        using var script = await _client.GetAsync("/TagEditor/Client.js");
        Assert.Equal(HttpStatusCode.OK, script.StatusCode);
        Assert.Contains("JellyfinTagEditor", await script.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task FailedPersistenceRestoresInMemoryTags()
    {
        _item.FailSave = true;
        var library = new Mock<ILibraryManager>();
        library.Setup(manager => manager.GetItemById(_item.Id)).Returns(_item);
        using var service = new TagService(library.Object);
        await Assert.ThrowsAsync<IOException>(() => service.SaveAsync(_item.Id, ["Original"], ["New"]));
        Assert.Equal(["Original"], _item.Tags);
    }

    public void Dispose()
    {
        _client.Dispose();
        _server.Dispose();
    }

    private sealed class TestMovie : Movie
    {
        public int SaveCount { get; private set; }
        public bool FailSave { get; set; }

        public override Task UpdateToRepositoryAsync(ItemUpdateType updateReason, CancellationToken cancellationToken)
        {
            if (FailSave) throw new IOException("Simulated persistence failure");
            SaveCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class TestAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var role = Request.Headers["X-Test-Role"].ToString();
            if (role.Length == 0) return Task.FromResult(AuthenticateResult.NoResult());
            var identity = new ClaimsIdentity([new Claim("admin", (role == "admin").ToString().ToLowerInvariant())], "test");
            return Task.FromResult(AuthenticateResult.Success(new(new ClaimsPrincipal(identity), "test")));
        }
    }
}
