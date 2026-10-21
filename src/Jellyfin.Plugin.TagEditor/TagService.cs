using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.TagEditor;

public sealed class TagService(ILibraryManager libraryManager) : IDisposable
{
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public static bool IsSupported(BaseItem item) => item is Movie or Series or Episode or MusicAlbum;

    public BaseItem? FindItem(Guid id) => libraryManager.GetItemById(id);

    public async Task<TagSaveResult> SaveAsync(Guid id, string[] originalTags, string[] tags)
    {
        await _writeLock.WaitAsync().ConfigureAwait(false);
        try
        {
            // Reload under the lock: another tag editor may have saved while this dialog was open.
            var item = libraryManager.GetItemById(id);
            if (item is null)
            {
                return new(TagSaveStatus.NotFound);
            }

            if (!item.Tags.SequenceEqual(originalTags, StringComparer.Ordinal))
            {
                return new(TagSaveStatus.Conflict);
            }

            var previousTags = item.Tags;
            item.Tags = Normalize(tags);
            try
            {
                await item.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, CancellationToken.None).ConfigureAwait(false);
            }
            catch
            {
                item.Tags = previousTags;
                throw;
            }

            return new(TagSaveStatus.Updated, new TagItem(item.Id, item.Name, item.Tags.ToArray()));
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public static string[] Normalize(IEnumerable<string> tags) => tags
        .Select(tag => tag.Trim())
        .Where(tag => tag.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    public void Dispose() => _writeLock.Dispose();
}

public enum TagSaveStatus { Updated, Conflict, NotFound }

public sealed record TagSaveResult(TagSaveStatus Status, TagItem? Item = null);
