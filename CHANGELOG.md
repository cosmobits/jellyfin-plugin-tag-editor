# Changelog

## 1.1.0.0

- Add a native plugin settings page.
- Add an optional home-page row showing the 12 tags used by the most visible items; disabled by default.
- Count tags against each signed-in user's accessible libraries and link tags to Jellyfin's filtered item list.

## 1.0.0.0

- Convert the standalone tag script into an installable Jellyfin 10.11 server plugin.
- Load the editor automatically in the web client without modifying files on disk.
- Provide administrator-only tag endpoints that preserve unrelated metadata.
- Detect stale edits, deduplicate tags, and retain edits when saving fails.
- Support tag suggestions, keyboard navigation, cancellation, and repeated editing.
- Add release archives, checksums, a repository manifest, and GitHub release automation.
