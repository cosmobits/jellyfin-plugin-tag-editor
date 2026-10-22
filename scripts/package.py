#!/usr/bin/env python3
"""Build the plugin and generate the exact archive/checksum Jellyfin installs."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "src/Jellyfin.Plugin.TagEditor/Jellyfin.Plugin.TagEditor.csproj"
ASSEMBLY = "Jellyfin.Plugin.TagEditor.dll"


def merge_manifest(existing, release):
    """Preserve every previously published version, replacing only matching versions."""
    entries = {entry["guid"]: entry for entry in existing}
    for entry in release:
        previous = entries.get(entry["guid"], {})
        versions = {version["version"]: version for version in previous.get("versions", [])}
        versions.update({version["version"]: version for version in entry["versions"]})
        entries[entry["guid"]] = {
            **entry,
            "versions": sorted(versions.values(), key=lambda version: tuple(map(int, version["version"].split("."))), reverse=True),
        }
    return list(entries.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-build", action="store_true", help="Package an already built Release DLL")
    parser.add_argument("--expected-version", help="Fail if the Git tag and source version differ")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--manifest-output", type=Path, default=ROOT / "manifest.json")
    parser.add_argument("--merge", type=Path, help="Merge a generated release manifest into --manifest-output")
    args = parser.parse_args()

    if args.merge:
        current = json.loads(args.manifest_output.read_text()) if args.manifest_output.exists() else []
        args.manifest_output.write_text(json.dumps(merge_manifest(current, json.loads(args.merge.read_text())), indent=2) + "\n")
        return

    properties = ET.parse(ROOT / "Directory.Build.props").getroot()
    version = properties.findtext(".//Version")
    target_abi = properties.findtext(".//TargetAbi")
    framework = properties.findtext(".//TargetFramework")
    if not version or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", version):
        parser.error("Directory.Build.props must contain a four-part Version")
    if args.expected_version and args.expected_version.removeprefix("v") != version:
        parser.error(f"Tag version {args.expected_version!r} does not match source version {version}")

    metadata = json.loads((ROOT / "repository.json").read_text())
    plugin_source = (PROJECT.parent / "Plugin.cs").read_text()
    if f'PluginId = "{metadata["guid"]}"' not in plugin_source:
        parser.error("Plugin.cs and repository.json must use the same plugin GUID")
    repository = metadata.pop("repository")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        parser.error("repository.json must contain an owner/repository GitHub path")

    if not args.no_build:
        subprocess.run(["dotnet", "build", str(PROJECT), "--configuration", "Release"], cwd=ROOT, check=True)
    dll = PROJECT.parent / "bin/Release" / framework / ASSEMBLY
    if not dll.is_file():
        parser.error(f"Missing Release assembly: {dll}")

    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / f"jellyfin-plugin-tag-editor_{version}.zip"
    # A stable timestamp and a DLL at archive root make the package reproducible and
    # compatible with Jellyfin's plugin extraction (no framework DLLs are bundled).
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        info = zipfile.ZipInfo(ASSEMBLY, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, dll.read_bytes())

    data = archive.read_bytes()
    md5 = hashlib.md5(data, usedforsecurity=False).hexdigest()
    sha256 = hashlib.sha256(data).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{sha256}  {archive.name}\n")
    release = [{**metadata, "versions": [{
        "version": version,
        "changelog": "Add plugin settings and an optional user-scoped popular-tags row to Jellyfin Web.",
        "targetAbi": target_abi,
        "sourceUrl": f"https://github.com/{repository}/releases/download/v{version}/{archive.name}",
        "checksum": md5,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }]}]
    baseline = ROOT / "manifest.json"
    existing = json.loads(baseline.read_text()) if baseline.exists() else []
    manifest = merge_manifest(existing, release)
    args.manifest_output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_output.write_text(json.dumps(manifest, indent=2) + "\n")
    (args.output / "release-manifest.json").write_text(json.dumps(release, indent=2) + "\n")
    print(f"Archive: {archive}")
    print(f"Manifest: {args.manifest_output}")
    print(f"Jellyfin checksum (MD5): {md5}")


if __name__ == "__main__":
    main()
