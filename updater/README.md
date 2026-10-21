# Fleep update hosting

The desktop app uses electron-builder release metadata to install platform-
specific updates. The GitHub Actions workflow can publish each completed
platform build to the `flp-updates` Cloudflare R2 bucket and the public
`https://versions.fleep.space` domain.

## Enable automatic publishing

Add these repository Actions secrets in GitHub:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

The R2 access key should be scoped to the `flp-updates` bucket with object
read/write permissions. Then add the repository Actions variable
`R2_UPLOAD_ENABLED` with the value `true`. Until enabled, builds still run and
their artifacts are uploaded to GitHub Actions, while the workflow explains
that R2 publishing is disabled.

After all four platform builds succeed, the workflow uploads artifacts under
`windows-x64/`, `linux-x64/`, `mac-x64/`, and `mac-arm64/`. Update metadata is
uploaded with `no-cache`; versioned packages are cached as immutable files.
The workflow creates and publishes `/releases.json` from the package version
and generated installer filenames.

The manifest must be JSON with a non-empty version and public HTTPS URLs:

```json
{
  "version": "1.0.1",
  "url": "https://versions.fleep.space/windows-x64/Fleep%20Setup%201.0.1.exe",
  "url-win": "https://versions.fleep.space/windows-x64/Fleep%20Setup%201.0.1.exe",
  "url-mac": "https://versions.fleep.space/mac-x64/Fleep-1.0.1.dmg",
  "url-mac-x64": "https://versions.fleep.space/mac-x64/Fleep-1.0.1.dmg",
  "url-mac-arm64": "https://versions.fleep.space/mac-arm64/Fleep-1.0.1-arm64.dmg",
  "url-lin": "https://versions.fleep.space/linux-x64/Fleep-1.0.1.AppImage",
  "url-bcm": "https://versions.fleep.space/windows-x64/Fleep%20Setup%201.0.1.exe.blockmap"
}
```

`url` is the general release link, while `url-win`, `url-mac`, and `url-lin`
are direct links for Windows, macOS, and Linux packages. `url-mac-x64` and
`url-mac-arm64` distinguish the two Mac builds. `url-bcm` is the Windows
blockmap URL. All URL fields use HTTPS. The workflow generates these links
with the `version` in `/releases.json`. Automatic installation uses
electron-builder's platform-specific `latest*.yml` metadata and matching
artifacts.

Do not cache `/releases.json` or `latest*.yml`; versioned package files can be
cached. Keep the `versions.fleep.space` custom domain attached to the R2 bucket
and accessible over HTTPS.
