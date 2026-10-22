using System.Collections.Concurrent;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;

namespace Jellyfin.Plugin.TagEditor;

public sealed class PopularTagService(ILibraryManager libraryManager)
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(10);
    private const int ResultLimit = 12;
    private readonly ConcurrentDictionary<Guid, CachedTags> _cache = new();

    public IReadOnlyList<PopularTag> GetPopularTags(User user)
    {
        if (_cache.TryGetValue(user.Id, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Tags;
        }

        var root = libraryManager.GetParentItem(null, user.Id) as Folder;
        if (root is null)
        {
            return Array.Empty<PopularTag>();
        }

        var query = new InternalItemsQuery(user)
        {
            Recursive = true,
            IsFolder = false,
            EnableTotalRecordCount = false,
            DtoOptions = new DtoOptions
            {
                Fields = [ItemFields.Tags],
                EnableImages = false,
                EnableUserData = false
            }
        };

        var counts = new Dictionary<string, (string Name, int Count)>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in root.GetItemList(query))
        {
            foreach (var tag in item.Tags.Where(tag => !string.IsNullOrWhiteSpace(tag)).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (counts.TryGetValue(tag, out var current))
                {
                    counts[tag] = (current.Name, current.Count + 1);
                }
                else
                {
                    counts[tag] = (tag, 1);
                }
            }
        }

        var result = counts.Values
            .OrderByDescending(tag => tag.Count)
            .ThenBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
            .Take(ResultLimit)
            .Select(tag => new PopularTag(tag.Name, tag.Count))
            .ToArray();

        _cache[user.Id] = new CachedTags(DateTimeOffset.UtcNow.Add(CacheDuration), result);
        return result;
    }

    private sealed record CachedTags(DateTimeOffset ExpiresAt, IReadOnlyList<PopularTag> Tags);
}

public sealed record PopularTag(string Name, int Count);
