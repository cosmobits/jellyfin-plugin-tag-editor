using Jellyfin.Plugin.TagEditor.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.TagEditor;

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public const string PluginId = "886bc3d5-31bb-4dcb-8fbd-45e5caf9e05d";

    public static Plugin Instance { get; private set; } = null!;

    public Plugin(IApplicationPaths paths, IXmlSerializer serializer)
        : base(paths, serializer)
    {
        Instance = this;
    }

    public override Guid Id => Guid.Parse(PluginId);

    public override string Name => "Tag Toolkit";

    public override string Description => "Edit tags and discover popular tags directly in Jellyfin Web.";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        yield return new PluginPageInfo
        {
            Name = Name,
            DisplayName = Name,
            EmbeddedResourcePath = "Jellyfin.Plugin.TagEditor.Configuration.config.html"
        };
    }
}
