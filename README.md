# Fleep Desktop

An Electron desktop wrapper for [Fleep](https://fleep.space/). It uses Fleep's existing web app and REST API; it does not reimplement the service or store credentials outside the normal Electron browser profile.

## Features

- Persistent web profile, so sign-in survives app restarts
- System tray controls and hide-to-tray behavior when closing the window
- Native Fleep web notifications
- Reports a desktop browser label in the Fleep Gateway IDENTIFY payload
- Optional launch at login setting in the application menu
- External web links open in the system browser
- Single-instance behavior
- `fleep://` deep links with Windows/Linux cold starts and macOS URL events
- Renderer IPC bridge for native window controls
- Screen/window sharing through Electron's native display-capture picker

## Run from source

Install Node.js, then run:

```sh
npm install
npm start
```

## Build an installer

```sh
npm run dist
```

The installer or package is written to `dist/`. Builds target Windows (NSIS), macOS (DMG), and Linux (AppImage); build each platform on its supported host.

To build macOS DMGs on GitHub, push the project to a GitHub repository with
Actions enabled, then run **Build macOS DMGs** from the repository's Actions
tab using **Run workflow**. The workflow builds separate Intel (`x64`) and
Apple Silicon (`arm64`) DMGs and uploads each as a workflow artifact. These
builds are unsigned and are not notarized.

The workflow also creates an Intel (`x64`) DMG for macOS 10.15 Catalina using
Electron 32.3.3. Electron 33 and later no longer support Catalina, so this
legacy build uses an unsupported Electron release and does not receive
Electron security updates. Use it only when Catalina compatibility is
required; the standard DMGs use the current Electron version.

## Deep links and window controls

The main process registers the `fleep://` protocol and sends validated links to
the loaded web app as `fleepDesktop.onDeepLink((url) => { ... })`. The
subscription returns an unsubscribe function. For example, the Fleep renderer
can translate the protocol URL into its own route:

```js
const unsubscribe = window.fleepDesktop.onDeepLink((url) => {
  // Route this URL using the web app's own navigation API.
  console.log('Fleep deep link:', url);
});
```

The local titlebar renderer uses these window actions and state notifications
through its isolated preload bridge (no raw `ipcRenderer`):

```js
window.electronAPI.minimize();
window.electronAPI.maximize();
window.electronAPI.close();
window.electronAPI.hideToTray();
const unsubscribe = window.electronAPI.onStateChange((maximized) => {
  // Update the maximize/restore icon.
});
```

The window is frameless. A local titlebar bar, separate from the hosted Fleep
page, displays an SVG Fleep wordmark on the left and native minimize,
maximize/restore, and close controls on the right. The Fleep app is displayed
in an embedded `<webview>` below it; no UI is injected into or moved around
inside the website. Keeping both surfaces in the same renderer prevents the
Fleep page from covering the titlebar's hitboxes. The bar can be dragged and
the controls remain clickable. Closing the window hides it to the tray on
Windows and Linux; the tray menu provides a full Quit action.
Development builds register `fleep://` against the local Electron executable
and app entry point; packaged builds register the scheme through installer
metadata and at startup. Linux desktop launchers and macOS app bundles receive
the same protocol metadata when packaged.

The desktop label is reported by changing only the browser field of outbound
Gateway IDENTIFY (`op: 2`) messages to `Discord Client`. This is a
client-reported classification and does not verify that the client is a native
desktop application. Other WebSocket frames and the web app's OS value are left
unchanged.

When Fleep requests screen sharing, the app presents a native menu of available
screens and windows. The user must choose a source for capture to begin.
System-audio loopback is included when requested on Windows; other platforms
share video only through this handler.
