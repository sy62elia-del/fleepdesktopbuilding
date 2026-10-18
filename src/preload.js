const { contextBridge, ipcRenderer, webFrame } = require('electron');

const deepLinkListeners = new Set();
const pendingDeepLinks = [];

function installDesktopGatewayIdentity() {
  const originalSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === 'string') {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        // Non-JSON frames pass through unchanged.
      }

      const properties = message?.op === 2 &&
        message.d &&
        (message.d.properties || message.d.$properties);
      if (properties && typeof properties === 'object') {
        properties.browser = 'Discord Client';
        if ('$browser' in properties) properties.$browser = 'Discord Client';
        data = JSON.stringify(message);
      }
    }

    return originalSend.call(this, data);
  };
}

const currentUrl = new URL(location.href);
const isFleepPage = currentUrl.protocol === 'https:' &&
  (currentUrl.hostname === 'fleep.space' ||
    currentUrl.hostname.endsWith('.fleep.space'));

if (process.isMainFrame && isFleepPage) {
  webFrame.executeJavaScript(`(${installDesktopGatewayIdentity.toString()})()`)
    .catch((error) => {
      console.error('Unable to install the desktop Gateway IDENTIFY patch:', error);
    });
}

ipcRenderer.on('fleep:deep-link', (_event, url) => {
  if (deepLinkListeners.size === 0) {
    pendingDeepLinks.push(url);
    return;
  }
  deepLinkListeners.forEach((callback) => callback(url));
});

contextBridge.exposeInMainWorld('fleepDesktop', {
  onDeepLink(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onDeepLink requires a callback');
    }
    deepLinkListeners.add(callback);
    while (pendingDeepLinks.length > 0) callback(pendingDeepLinks.shift());
    return () => deepLinkListeners.delete(callback);
  }
});
