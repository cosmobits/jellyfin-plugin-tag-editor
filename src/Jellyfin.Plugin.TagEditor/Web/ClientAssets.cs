namespace Jellyfin.Plugin.TagEditor.Web;

public static class ClientAssets
{
    private static readonly string Version = typeof(Plugin).Assembly.GetName().Version!.ToString();

    public static string Read(string name)
    {
        using var stream = typeof(Plugin).Assembly.GetManifestResourceStream($"Jellyfin.Plugin.TagEditor.Web.{name}")
            ?? throw new InvalidOperationException($"Missing embedded asset: {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static string Inject(string html)
    {
        const string marker = "id=\"cosmobits-tag-editor\"";
        if (html.Contains(marker, StringComparison.Ordinal))
        {
            return html;
        }

        var closingBody = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (closingBody < 0)
        {
            return html;
        }

        var assets = $"<link rel=\"stylesheet\" href=\"../TagEditor/Client.css?v={Version}\">"
            + $"<script {marker} src=\"../TagEditor/Client.js?v={Version}\" defer></script>";
        return html.Insert(closingBody, assets);
    }
}
