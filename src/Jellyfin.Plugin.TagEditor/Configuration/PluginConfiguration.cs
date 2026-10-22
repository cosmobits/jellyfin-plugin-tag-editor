using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.TagEditor.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public bool ShowPopularTags { get; set; }
}
