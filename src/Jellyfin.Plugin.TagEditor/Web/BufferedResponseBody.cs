using System.IO.Pipelines;
using Microsoft.AspNetCore.Http.Features;

namespace Jellyfin.Plugin.TagEditor.Web;

// Delay starting the real response until the HTML and its HTTP headers have been updated.
// In particular, SendFileAsync must not bypass the buffer used by static-file middleware.
internal sealed class BufferedResponseBody(Stream stream) : IHttpResponseBodyFeature
{
    private PipeWriter? _writer;
    private bool _completed;

    public Stream Stream => stream;

    public PipeWriter Writer => _writer ??= PipeWriter.Create(stream, new StreamPipeWriterOptions(leaveOpen: true));

    public void DisableBuffering() { }

    public Task StartAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    public async Task CompleteAsync()
    {
        if (_writer is not null && !_completed)
        {
            await _writer.FlushAsync().ConfigureAwait(false);
            await _writer.CompleteAsync().ConfigureAwait(false);
            _completed = true;
        }
    }

    public async Task SendFileAsync(string path, long offset, long? count, CancellationToken cancellationToken = default)
    {
        await using var file = File.OpenRead(path);
        file.Position = offset;
        var remaining = count ?? file.Length - offset;
        var buffer = new byte[16384];
        while (remaining > 0)
        {
            var read = await file.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            await stream.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            remaining -= read;
        }
    }
}
