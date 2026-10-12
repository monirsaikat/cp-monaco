// Browsers never pass Ctrl+W to a page, but an extension command bound to it does fire.
// It has no default key: the user binds it on the browser's extension shortcuts page.
// The binding applies to the whole browser, so anywhere but the editor it closes the
// browser tab, as Ctrl+W always did.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'close-tab') return;
  tab ||= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return;
  let handled = false;
  try {
    handled = await chrome.tabs.sendMessage(tab.id, { source: 'cpm', type: 'close-tab' }, { frameId: 0 });
  } catch {
    // No editor on this page.
  }
  if (!handled) chrome.tabs.remove(tab.id);
});
