using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TagEditor;

[ApiController]
[Route("TagEditor")]
[Authorize]
public sealed class TagEditorHomeController(IUserManager userManager, PopularTagService popularTags) : ControllerBase
{
    [HttpGet("Settings")]
    public ActionResult<TagEditorSettings> GetSettings()
        => new(new TagEditorSettings(Plugin.Instance.Configuration.ShowPopularTags));

    [HttpGet("PopularTags")]
    public ActionResult<IReadOnlyList<PopularTag>> GetPopularTags()
    {
        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value;
        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var user = userManager.GetUserById(userId);
        return user is null
            ? Unauthorized()
            : Ok(popularTags.GetPopularTags(user));
    }
}

public sealed record TagEditorSettings(bool ShowPopularTags);
