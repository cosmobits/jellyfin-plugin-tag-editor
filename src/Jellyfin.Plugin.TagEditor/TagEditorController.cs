using System.ComponentModel.DataAnnotations;
using Jellyfin.Plugin.TagEditor.Web;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TagEditor;

[ApiController]
[Route("TagEditor")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class TagEditorController(TagService tags) : ControllerBase
{
    // These public resources contain only UI code, never credentials or library data.
    [AllowAnonymous]
    [HttpGet("Client.js")]
    public ActionResult Script() => Asset("tag-editor.js", "text/javascript; charset=utf-8");

    [AllowAnonymous]
    [HttpGet("Client.css")]
    public ActionResult Styles() => Asset("tag-editor.css", "text/css; charset=utf-8");

    [HttpGet("Items/{itemId:guid}/Tags")]
    public ActionResult<TagItem> GetTags(Guid itemId)
    {
        var item = tags.FindItem(itemId);
        if (item is null)
        {
            return NotFound();
        }

        return TagService.IsSupported(item)
            ? new TagItem(item.Id, item.Name, item.Tags.ToArray())
            : BadRequest("This item type is not supported.");
    }

    [HttpPut("Items/{itemId:guid}/Tags")]
    [RequestSizeLimit(131072)]
    public async Task<ActionResult<TagItem>> UpdateTags(Guid itemId, UpdateTagsRequest request)
    {
        if (request.Tags.Any(tag => tag is null || tag.Length > 256)
            || request.OriginalTags.Any(tag => tag is null))
        {
            return BadRequest("Tags must be strings of at most 256 characters.");
        }

        var item = tags.FindItem(itemId);
        if (item is null)
        {
            return NotFound();
        }

        if (!TagService.IsSupported(item))
        {
            return BadRequest("This item type is not supported.");
        }

        var result = await tags.SaveAsync(itemId, request.OriginalTags, request.Tags).ConfigureAwait(false);
        if (result.Status == TagSaveStatus.NotFound)
        {
            return NotFound();
        }

        if (result.Status == TagSaveStatus.Conflict)
        {
            return Conflict("Tags changed while this editor was open. Close it and reopen to load the latest tags.");
        }

        return result.Item!;
    }

    private ContentResult Asset(string name, string contentType)
    {
        Response.Headers.CacheControl = "no-cache";
        return Content(ClientAssets.Read(name), contentType);
    }
}

public sealed record TagItem(Guid Id, string Name, string[] Tags);

public sealed class UpdateTagsRequest
{
    [Required, MaxLength(100)]
    public required string[] Tags { get; init; }

    [Required, MaxLength(1000)]
    public required string[] OriginalTags { get; init; }
}
