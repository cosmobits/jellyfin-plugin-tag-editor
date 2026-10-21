# Jellyfin Tag Editor

An installable Jellyfin server plugin by **cosmobits**. It adds an **Edit tags** button to movie, series, episode, and music album detail pages in Jellyfin Web.

The plugin loads its own web UI automatically. It does not require a JavaScript injector, edits to `index.html`, or writable web client files. Tag changes use an administrator-only endpoint that updates tags without submitting the rest of the item's metadata. If another tag editor saved changes while your dialog was open, your save is rejected so their changes are not overwritten.

## Compatibility

- Jellyfin Server **10.11.x**, with its bundled Jellyfin Web client.
- An administrator account is required to read or save tags through this plugin.
- The first release targets ABI `10.11.0.0` and .NET 9. It does not claim compatibility with Jellyfin 10.10, 12, or 13.
- The button is a Jellyfin Web feature. Native TV/mobile clients and separately hosted web clients do not automatically receive the button.
- Standard Jellyfin base URLs and gzip/Brotli responses are supported.

## Install from the Jellyfin catalog

**The GitHub repository and its first release must be published before this URL works.**

1. In Jellyfin, open **Dashboard → Plugins → Repositories**, then add a repository.
2. Set its name to **cosmobits** and URL to:

   ```text
   https://raw.githubusercontent.com/cosmobits/jellyfin-plugin-tag-editor/main/manifest.json
   ```

3. Open **Catalog**, install **Tag Editor**, and restart Jellyfin.
4. Refresh Jellyfin Web and sign in as an administrator. Open a supported item and choose **Edit tags** beside its tags. If that layout has no tag container, the button appears near the item title or in the lower right.

Use Enter or a comma to add a tag, choose an existing tag suggestion, or remove a tag with its × button. Save also adds text still in the input. Escape or Cancel closes the dialog. Saves support up to 100 tags with 256 characters per tag; names are trimmed and duplicate names are combined without regard to capitalization.

## Install a local build

1. Build the package with the command below, or use the prepared ZIP in `artifacts/`.
2. Stop Jellyfin. Create a folder such as `TagEditor_1.0.0.0` inside its **data directory's `plugins` folder**.
3. Extract `Jellyfin.Plugin.TagEditor.dll` from the ZIP directly into that folder.
4. Start Jellyfin and refresh the browser. The plugin should appear in **Dashboard → Plugins**.

Uninstall through Jellyfin and restart the server to remove the integration. No web files need restoring. Removing the plugin does not remove saved item tags.

## Build and check

Building requires the .NET 9 SDK and Python 3.10+. Browser interaction checks additionally require Node.js 24.

```sh
dotnet test tests/Jellyfin.Plugin.TagEditor.Tests --configuration Release
npm ci --ignore-scripts
npm test
python3 scripts/package.py
```

The packaging script builds a Release DLL and creates:

- `artifacts/jellyfin-plugin-tag-editor_1.0.0.0.zip`, containing the plugin assembly at the archive root.
- A SHA-256 checksum file for manual downloads.
- `manifest.json` with the archive's actual MD5 checksum, as required by Jellyfin's catalog.
- `artifacts/release-manifest.json` for publishing the new version while preserving earlier catalog versions.

The generated manifest points to the intended GitHub release URL. The URL only becomes available after that exact archive has been published. Never replace an archive without regenerating its manifest checksum.

## Publish under cosmobits

Create an empty public GitHub repository named **`jellyfin-plugin-tag-editor`** in the **`cosmobits`** account. Then connect and push this local repository:

```sh
git remote add origin git@github.com:cosmobits/jellyfin-plugin-tag-editor.git
git push -u origin main
git tag v1.0.0.0
git push origin v1.0.0.0
```

If this checkout already has `origin`, skip the `git remote add` command. This local checkout uses a dedicated cosmobits SSH key and an SSH remote; its settings live in `.git/config` and are not part of the published source. Keep private keys outside the repository. Set the Git author name/email locally for each checkout if you use multiple accounts.

The tag starts the release workflow. It runs the checks, builds the ZIP, creates a GitHub Release with the archive and checksum, and then commits the matching `manifest.json` to `main`. The repository URL above becomes usable once the workflow finishes. The workflow uses GitHub's repository token; no publishing secret is required. Allow GitHub Actions to write repository contents, and ensure branch rules permit its manifest commit.

For later releases, bump the four-part `<Version>` in `Directory.Build.props`, update `CHANGELOG.md`, commit, and push a matching `v` tag. Release archives and existing catalog versions should be retained so already installed versions remain available. If the catalog commit is blocked by repository rules, the release archive is still published. Download that release's `release-manifest.json` into `artifacts/`, then merge it into `main` and push that change. Use the manifest attached to the release so its checksum matches the published archive:

```sh
python3 scripts/package.py --merge artifacts/release-manifest.json
git add manifest.json
git commit -m "Update plugin catalog"
git push origin main
```

For a fork, update `repository.json` and the project repository URL before packaging. Preserve the plugin GUID for releases of this same plugin; give a separately distributed incompatible fork its own GUID.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/Jellyfin.Plugin.TagEditor/Plugin.cs` | Stable Jellyfin identity and plugin metadata |
| `TagEditorController.cs` and `TagService.cs` | Authorization, validation, tag-only persistence, stale-edit checks |
| `Web/` | Embedded JS/CSS, web startup hook, and HTML response integration |
| `tests/` | HTTP integration checks and browser DOM interaction checks |
| `scripts/package.py` | Release archive, manifest, and checksums |
| `.github/workflows/` | CI and tag-driven publication |

The web hook transforms only the HTML shell returned by Jellyfin's own request pipeline. It leaves disk files alone, preserves base URL routing, and does not intercept media responses. The editor uses the signed-in web client's API session; no API key is configured or embedded.

## Verification scope

Automated checks cover the administrator policy, invalid payloads, tag-only updates, stale edits, persistence failures, compressed HTML, base URLs, cache/range handling, HTTP HEAD, cancellation/reopening, focus behavior, navigation, session changes, and safe rendering of tag/item names. The first release still needs a smoke check on the intended Jellyfin server before public distribution; these checks do not replace that server-specific check.

## License

No redistribution license has been selected. Choose and add a license before publishing for public reuse.
