# Fleep update hosting

The desktop app uses electron-builder release metadata to install platform-
specific updates. This repository contains the public release manifest
format only; update-server implementation and deployment code are maintained
outside this repository.

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
intended to be returned with `version` by the separately hosted
`/releases.json` endpoint. The app's platform-aware automatic installation
continues to use electron-builder's `latest*.yml` metadata and matching
artifacts; publish those alongside the release links for in-app updates.

Publish the current manifest and platform artifacts through the separately
hosted `https://updates.fleep.space/` service. Do not cache `/releases.json`
or `latest*.yml`; versioned package files can be cached. Keep update metadata
and downloads available over HTTPS.
