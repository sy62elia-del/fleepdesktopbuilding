const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  dialog,
  session,
  shell,
  Tray
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FLEEP_URL = 'https://fleep.space/app';
const FLEEP_HOST = 'fleep.space';
const DEEP_LINK_SCHEME = 'fleep:';
const isFleepUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === FLEEP_HOST || url.hostname.endsWith(`.${FLEEP_HOST}`));
  } catch {
    return false;
  }
};

const parseDeepLink = (value) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === DEEP_LINK_SCHEME && url.host ? url.href : null;
  } catch {
    return null;
  }
};

let mainWindow;
let loadingWindow;
let fleepContents;
let tray;
let quitting = false;
let fleepReady = false;
const pendingDeepLinks = [];

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId('space.fleep.desktop');
  registerProtocolClient();

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.map(parseDeepLink).find(Boolean);
    if (deepLink) handleDeepLink(deepLink);
    showMainWindow();
  });

  app.whenReady().then(() => {
    configurePermissions();
    createLoadingWindow();
    createWindow();
    createTray();
    createApplicationMenu();
    registerWindowControlIpc();
    checkForUpdates();

    const initialDeepLink = process.argv.map(parseDeepLink).find(Boolean);
    if (initialDeepLink) handleDeepLink(initialDeepLink);

    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
  });
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  loadingWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.show();
  });
  loadingWindow.on('closed', () => {
    loadingWindow = null;
  });
  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
}

function closeLoadingWindow() {
  if (!loadingWindow || loadingWindow.isDestroyed()) return;
  loadingWindow.close();
  loadingWindow = null;
}

function checkForUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => {
    console.error('Unable to check for or download Fleep updates:', error);
  });
  autoUpdater.checkForUpdates().catch((error) => {
    console.error('Unable to start the Fleep update check:', error);
  });
}

function registerProtocolClient() {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('fleep');
  } else if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('fleep', process.execPath, [
      path.resolve(process.argv[1])
    ]);
  }
}

function handleDeepLink(value) {
  const deepLink = parseDeepLink(value);
  if (!deepLink) return;

  pendingDeepLinks.push(deepLink);
  if (!mainWindow && app.isReady()) createWindow();
  showMainWindow();
  flushPendingDeepLinks();
}

function flushPendingDeepLinks() {
  if (!fleepReady || !fleepContents || fleepContents.isDestroyed()) return;
  while (pendingDeepLinks.length > 0) {
    fleepContents.send('fleep:deep-link', pendingDeepLinks.shift());
  }
}

function showMainWindow() {
  if (!mainWindow) {
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    mainWindow.isMaximized() ? 'window-is-maximized' : 'window-is-unmaximized'
  );
}

function registerWindowControlIpc() {
  const isTitlebarSender = (event) =>
    mainWindow && !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents;

  ipcMain.on('window-minimize', (event) => {
    if (isTitlebarSender(event)) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    if (!isTitlebarSender(event)) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('window-close', (event) => {
    if (isTitlebarSender(event)) mainWindow.close();
  });

  ipcMain.on('window-hide-to-tray', (event) => {
    if (isTitlebarSender(event)) mainWindow.hide();
  });
}

function configurePermissions() {
  const fleepSession = session.defaultSession;
  const canUseNotifications = (origin) => isFleepUrl(origin);

  fleepSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!webContents || !isFleepUrl(webContents.getURL())) return false;
    if (permission === 'notifications') return canUseNotifications(requestingOrigin);
    return permission === 'display-capture' && isFleepUrl(requestingOrigin);
  });

  fleepSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(
      (permission === 'notifications' || permission === 'display-capture') &&
      isFleepUrl(webContents.getURL()) &&
      isFleepUrl(requestingUrl)
    );
  });

  fleepSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (
      !request.videoRequested ||
      !request.frame ||
      !isFleepUrl(request.securityOrigin) ||
      !isFleepUrl(request.frame.url) ||
      !mainWindow ||
      mainWindow.isDestroyed()
    ) {
      callback(null);
      return;
    }

    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });
    } catch (error) {
      console.error('Unable to enumerate screen-sharing sources:', error);
      callback(null);
      return;
    }

    if (sources.length === 0 || !mainWindow || mainWindow.isDestroyed()) {
      callback(null);
      return;
    }

    let settled = false;
    const selectSource = (source) => {
      if (settled) return;
      settled = true;
      const streams = { video: source };
      if (request.audioRequested && process.platform === 'win32') {
        streams.audio = 'loopback';
      }
      callback(streams);
    };
    const cancelRequest = () => {
      if (settled) return;
      settled = true;
      callback(null);
    };

    const screens = sources.filter((source) => source.id.startsWith('screen:'));
    const windows = sources.filter((source) => source.id.startsWith('window:'));
    const template = [];

    if (screens.length > 0) {
      template.push({ label: 'Screens', enabled: false });
      screens.forEach((source) => {
        template.push({
          label: source.name,
          click: () => selectSource(source)
        });
      });
    }

    if (screens.length > 0 && windows.length > 0) {
      template.push({ type: 'separator' });
    }

    if (windows.length > 0) {
      template.push({ label: 'Windows', enabled: false });
      windows.forEach((source) => {
        template.push({
          label: source.name,
          click: () => selectSource(source)
        });
      });
    }

    if (template.length === 0) {
      callback(null);
      return;
    }

    Menu.buildFromTemplate(template).popup({
      window: mainWindow,
      callback: cancelRequest
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#17191c',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true
    }
  });

  fleepReady = false;

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    closeLoadingWindow();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    sendWindowState();
  });
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const shellUrl = pathToFileURL(path.join(__dirname, 'titlebar.html')).href;
    if (url !== shellUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.src !== FLEEP_URL) {
      event.preventDefault();
      return;
    }

    webPreferences.preload = path.join(__dirname, 'preload.js');
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    fleepContents = webContents;
    fleepReady = false;

    webContents.on('did-start-navigation', (_navigationEvent, url, _inPlace, isMainFrame) => {
      if (isMainFrame) fleepReady = false;
      if (isMainFrame && !isFleepUrl(url) && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    });
    webContents.on('did-finish-load', () => {
      fleepReady = true;
      flushPendingDeepLinks();
    });
    webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    webContents.on('will-navigate', (event, url) => {
      if (!isFleepUrl(url)) {
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      }
    });
  });

  mainWindow.on('close', (event) => {
    if (!quitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    fleepContents = null;
    fleepReady = false;
  });

  mainWindow.loadFile(path.join(__dirname, 'titlebar.html'));
}

function toggleMainWindow() {
  if (!mainWindow) {
    showMainWindow();
  } else if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'fleep-tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('Fleep');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Fleep',
      click: showMainWindow
    },
    {
      label: 'Toggle Window',
      click: toggleMainWindow
    },
    { type: 'separator' },
    {
      label: 'Quit Fleep',
      click: () => app.quit()
    }
  ]));
  tray.on('double-click', showMainWindow);
}

function createApplicationMenu() {
  const launchAtLogin = app.getLoginItemSettings().openAtLogin;
  const template = [
    {
      label: 'Fleep',
      submenu: [
        {
          label: 'Launch at Login',
          type: 'checkbox',
          checked: launchAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Fleep' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
