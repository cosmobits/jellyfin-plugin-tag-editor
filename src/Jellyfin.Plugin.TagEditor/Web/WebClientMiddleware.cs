using System.IO.Compression;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TagEditor.Web;

public sealed class WebClientMiddleware(RequestDelegate next, ILogger<WebClientMiddleware> logger)
{
    private static readonly string[] ConditionalHeaders = ["If-None-Match", "If-Modified-Since", "Range", "If-Range"];

    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        var path = request.Path.Value ?? string.Empty;
        var isHead = HttpMethods.IsHead(request.Method);
        if ((!HttpMethods.IsGet(request.Method) && !isHead)
            || (!path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
                && !path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)))
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        // A 304 or range response could reuse an older shell without our loader. Fetch the
        // complete shell through Jellyfin's own pipeline, preserving its base URL and checks.
        var savedHeaders = ConditionalHeaders.ToDictionary(name => name, name => request.Headers[name]);
        foreach (var name in ConditionalHeaders)
        {
            request.Headers.Remove(name);
        }

        var method = request.Method;
        if (isHead)
        {
            request.Method = HttpMethods.Get;
        }

        var originalBody = context.Features.Get<IHttpResponseBodyFeature>()!;
        await using var buffer = new MemoryStream();
        var bufferedBody = new BufferedResponseBody(buffer);
        context.Features.Set<IHttpResponseBodyFeature>(bufferedBody);
        byte[] body;
        try
        {
            await next(context).ConfigureAwait(false);
            await bufferedBody.CompleteAsync().ConfigureAwait(false);
            body = buffer.ToArray();
            var response = context.Response;
            if (response.StatusCode == StatusCodes.Status200OK
                && response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true)
            {
                try
                {
                    var encoding = response.Headers.ContentEncoding.ToString();
                    var decoded = Decode(body, encoding);
                    var updated = ClientAssets.Inject(Encoding.UTF8.GetString(decoded));
                    body = Encode(Encoding.UTF8.GetBytes(updated), encoding);
                    response.ContentLength = body.Length;
                    response.Headers.Remove("ETag");
                    response.Headers.Remove("Last-Modified");
                    response.Headers.Remove("Content-MD5");
                    response.Headers.CacheControl = "no-store";
                }
                catch (Exception error) when (error is InvalidDataException or NotSupportedException)
                {
                    // Preserve the original page if another middleware uses an unsupported encoding.
                    logger.LogWarning(error, "Tag Editor could not add its loader to Jellyfin Web");
                }
            }
        }
        finally
        {
            request.Method = method;
            foreach (var (name, value) in savedHeaders)
            {
                if (value.Count > 0)
                {
                    request.Headers[name] = value;
                }
            }

            context.Features.Set(originalBody);
        }

        if (!isHead)
        {
            await context.Response.Body.WriteAsync(body, context.RequestAborted).ConfigureAwait(false);
        }
    }

    private static byte[] Decode(byte[] body, string encoding)
    {
        if (string.IsNullOrEmpty(encoding) || encoding == "identity")
        {
            return body;
        }

        using var input = new MemoryStream(body);
        using Stream decompressor = encoding switch
        {
            "gzip" => new GZipStream(input, CompressionMode.Decompress),
            "br" => new BrotliStream(input, CompressionMode.Decompress),
            _ => throw new NotSupportedException($"Unsupported content encoding: {encoding}")
        };
        using var output = new MemoryStream();
        decompressor.CopyTo(output);
        return output.ToArray();
    }

    private static byte[] Encode(byte[] body, string encoding)
    {
        if (string.IsNullOrEmpty(encoding) || encoding == "identity")
        {
            return body;
        }

        using var output = new MemoryStream();
        using (Stream compressor = encoding switch
        {
            "gzip" => new GZipStream(output, CompressionLevel.Fastest, leaveOpen: true),
            "br" => new BrotliStream(output, CompressionLevel.Fastest, leaveOpen: true),
            _ => throw new NotSupportedException($"Unsupported content encoding: {encoding}")
        })
        {
            compressor.Write(body);
        }

        return output.ToArray();
    }
}
