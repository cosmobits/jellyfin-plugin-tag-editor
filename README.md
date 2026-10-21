# Jellyfin Tag Editor

A small client-side extension that adds an **Edit Tags** action to supported Jellyfin item detail pages. It edits tags for movies, series, episodes, and music albums through the Jellyfin web client's `ApiClient`.

## Current status

This project is a browser script, not a Jellyfin server plugin. Jellyfin's **Plugin Repositories** install server plugin packages (assemblies distributed as release archives); they cannot install or load a standalone JavaScript file. A `manifest.json` pointing at this script would be misleading and would not make the extension appear in the web client.

The script currently needs to be loaded into the Jellyfin web client by a separate JavaScript injector or during development from the browser console. Adding it to the Plugins repository catalog requires a server-side integration that loads the script into Jellyfin Web, plus a compiled and released plugin package. That is not part of this script-only package yet.

## Requirements

- Jellyfin Web with the global `ApiClient` available.
- The signed-in user must have a media or metadata editing permission.
- Supported item types: Movie, Series, Episode, MusicAlbum.

## Development / manual loading

For local development, open a Jellyfin item detail page, open the browser developer console, and load the contents of `jellyfin-tag-editor.js`. The editor adds an **Edit Tags** control beside the item's existing tags. Use a JavaScript injector that you trust for persistent use; injecting code into a Jellyfin session gives that code access to the signed-in user's web client API.

The script exposes `window.JellyfinTagEditor` for diagnostics:

- `JellyfinTagEditor.status()` reports current page and injection state.
- `JellyfinTagEditor.inspect()` reports the edit control's layout and hit-test details.
- `JellyfinTagEditor.refresh()` retries insertion on the current page.
- `JellyfinTagEditor.destroy()` disconnects its DOM observer.
- `JellyfinTagEditor.open()` opens the editor for the current item.

## Repository releases

The source can be published as a normal GitHub repository under `cosmobits`. It is not installable from Jellyfin's Plugins page in its current form. Do not add a Jellyfin plugin repository manifest until a compatible server plugin package exists and is attached to a release.

## License

No license has been selected yet. Add a license before accepting outside contributions or publishing this repository for reuse.
