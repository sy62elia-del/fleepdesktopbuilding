# Fleep update server

The desktop app uses electron-builder release metadata to install platform-
specific updates. The server also reads `releases.json` and exposes the
validated release version and HTTPS URLs at
`https://updates.fleep.space/releases.json`. Edit that file for the current
public release.

## Run locally

Build release files first, then run:

```sh
npm run dist
npm run updater:serve
```

By default, the server reads artifacts from `dist/`, the manifest from
`updater/releases.json`, and listens on `127.0.0.1:3000`. Set `UPDATE_DIR` to
serve a different artifact directory, `RELEASES_FILE` to use a different
manifest path, and `HOST` and `PORT` to change the listening address and port.

The manifest must be JSON with a non-empty version and public HTTPS URLs:

```json
{
  "version": "1.0.1",
  "url": "https://updates.fleep.space/Fleep%20Setup%201.0.1.exe",
  "url-win": "https://updates.fleep.space/Fleep%20Setup%201.0.1.exe",
  "url-mac": "https://updates.fleep.space/Fleep-1.0.1-mac.zip",
  "url-lin": "https://updates.fleep.space/Fleep-1.0.1.AppImage",
  "url-bcm": "https://updates.fleep.space/Fleep%20Setup%201.0.1.exe.blockmap"
}
```

`url` is the general release link, while `url-win`, `url-mac`, and `url-lin`
are direct links for Windows, macOS, and Linux packages. `url-bcm` is the
blockmap URL. All five URL fields are required and must use HTTPS. They are
returned with `version` by `/releases.json`. The app's platform-aware automatic
installation continues to use electron-builder's `latest*.yml` metadata and
matching artifacts; publish those alongside the release links for in-app
updates.

## Deploy

Run the server behind an HTTPS reverse proxy at `updates.fleep.space`. Publish
the current version and public release URL in `updater/releases.json`, and
publish the platform build output directory (including the `latest*.yml`
metadata files, installer/package files, and `.blockmap` files) into the
directory configured by `UPDATE_DIR`. Do not cache `/releases.json` or
`latest*.yml`; versioned package files can be cached. The server intentionally
does not provide directory listings or files outside its release-file allowlist.

Build every platform on its supported host and upload its update metadata and
artifacts to the same release directory. The build configuration emits a
Windows NSIS installer, macOS DMG and ZIP, and Linux AppImage. For production
releases, protect update hosting and use platform code signing; update
metadata and downloads must remain available over HTTPS.
