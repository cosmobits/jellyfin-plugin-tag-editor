using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.TagEditor;

public sealed class Plugin(IApplicationPaths paths, IXmlSerializer serializer)
    : BasePlugin<BasePluginConfiguration>(paths, serializer)
{
    public const string PluginId = "886bc3d5-31bb-4dcb-8fbd-45e5caf9e05d";

    public override Guid Id => Guid.Parse(PluginId);

    public override string Name => "Tag Editor";

    public override string Description => "Edit movie, series, episode, and album tags directly in Jellyfin Web.";
}
