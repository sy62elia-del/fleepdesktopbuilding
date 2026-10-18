const minimizeButton = document.getElementById('minimize');
const maximizeButton = document.getElementById('maximize');
const closeButton = document.getElementById('close');
const fleepContainer = document.getElementById('fleep-container');

const fleepApp = document.createElement('webview');
fleepApp.id = 'fleep-app';
fleepApp.src = 'https://fleep.space/app';
fleepContainer.appendChild(fleepApp);

minimizeButton.addEventListener('click', () => window.electronAPI.minimize());
maximizeButton.addEventListener('click', () => window.electronAPI.maximize());
closeButton.addEventListener('click', () => window.electronAPI.close());

window.electronAPI.onStateChange((maximized) => {
  maximizeButton.title = maximized ? 'Restore' : 'Maximize';
  maximizeButton.setAttribute('aria-label', maximizeButton.title);
  maximizeButton.innerHTML = maximized
    ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M8 4H2v6h6z"/></svg>'
    : '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.75" y="1.75" width="8.5" height="8.5"/></svg>';
});
