// Shows the installed version under the extension name.
const { version } = chrome.runtime.getManifest();
document.getElementById('version').textContent = `Version ${version} · The VS Code editor, inside cPanel`;
