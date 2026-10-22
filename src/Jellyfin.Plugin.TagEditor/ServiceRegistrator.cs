using Jellyfin.Plugin.TagEditor.Web;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.TagEditor;

public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost applicationHost)
    {
        services.AddSingleton<TagService>();
        services.AddSingleton<PopularTagService>();
        services.AddTransient<IStartupFilter, WebStartupFilter>();
    }
}
