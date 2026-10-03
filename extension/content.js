// Runs on cPanel's File Manager editor page. Hides the stock editor, mounts Monaco
// (in an extension iframe so cPanel's CSP can't interfere), and loads/saves the
// file through cPanel's own UAPI using the current session.
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const file = params.get('file');
  const dir = params.get('dir');
  const session = location.pathname.match(/^\/cpsess\d+/);
  if (!file || !dir || !session) return;

  const api = `${session[0]}/execute/Fileman`;
  const editorUrl = chrome.runtime.getURL('editor.html');
  const editorOrigin = new URL(editorUrl).origin;
  const requestedCharset = params.get('file_charset') || params.get('charset') || 'utf-8';

  let charset = 'utf-8';
  let dirty = false;
  let baseTitle = '';
  let root = null;
  let frame = null;
  let filePromise = loadFile();

  document.documentElement.classList.add('cpm-active');
  whenBody(mount);

  window.addEventListener('beforeunload', (event) => {
    if (root && dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  function whenBody(callback) {
    if (document.body) return callback();
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        callback();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  }

  function mount() {
    root = document.createElement('div');
    root.id = 'cpm-root';
    frame = document.createElement('iframe');
    frame.src = editorUrl;
    frame.title = 'Monaco editor';
    root.append(frame);
    document.body.append(root);
    window.addEventListener('message', onMessage);
  }

  function unmount() {
    window.removeEventListener('message', onMessage);
    root.remove();
    root = frame = null;
    dirty = false;
    document.documentElement.classList.remove('cpm-active');
    if (baseTitle) document.title = baseTitle;
    // Let the stock editor recalculate its size now that it is visible again.
    window.dispatchEvent(new Event('resize'));
  }

  function post(message) {
    frame?.contentWindow?.postMessage({ source: 'cpm', ...message }, editorOrigin);
  }

  async function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== editorOrigin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'cpm') return;

    switch (msg.type) {
      case 'ready': {
        // Use the prefetched content the first time; fetch fresh if the frame ever reloads.
        const pending = filePromise || loadFile();
        filePromise = null;
        try {
          const content = await pending;
          post({ type: 'load', content, file, path: joinPath(dir, file), charset });
        } catch (err) {
          post({ type: 'error', message: err.message });
        }
        break;
      }
      case 'save':
        try {
          await uapi('save_file_content', {
            dir,
            file,
            content: msg.content,
            from_charset: 'utf-8',
            to_charset: charset,
          }, true);
          post({ type: 'saved', ok: true, version: msg.version });
        } catch (err) {
          post({ type: 'saved', ok: false, error: err.message, version: msg.version });
        }
        break;
      case 'dirty':
        dirty = Boolean(msg.dirty);
        updateTitle();
        break;
      case 'classic':
        unmount();
        break;
    }
  }

  function updateTitle() {
    if (!baseTitle) baseTitle = document.title;
    document.title = `${dirty ? '● ' : ''}${file} — cPanel`;
  }

  async function loadFile() {
    const candidates = requestedCharset.toLowerCase() === 'utf-8'
      ? ['utf-8']
      : [requestedCharset, 'utf-8'];
    let lastError;
    for (const from of candidates) {
      try {
        const data = await uapi('get_file_content', {
          dir,
          file,
          from_charset: from,
          to_charset: 'utf-8',
        });
        const detected = data.from_charset && data.from_charset !== '_DETECT_' ? data.from_charset : null;
        charset = detected || (from === '_DETECT_' ? 'utf-8' : from);
        updateTitle();
        return data.content ?? '';
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function uapi(fn, fields, usePost = false) {
    const body = new URLSearchParams(fields);
    const res = usePost
      ? await fetch(`${api}/${fn}`, { method: 'POST', body, credentials: 'same-origin' })
      : await fetch(`${api}/${fn}?${body}`, { credentials: 'same-origin' });

    let json;
    try {
      json = JSON.parse(await res.text());
    } catch {
      throw new Error(res.ok
        ? 'cPanel sent an unexpected response. Your session may have expired, so reload the page and log in again.'
        : `cPanel returned HTTP ${res.status}.`);
    }
    if (!json.status) {
      throw new Error((json.errors || []).join('\n') || 'cPanel reported an unknown error.');
    }
    return json.data || {};
  }

  function joinPath(directory, name) {
    return `${directory.replace(/\/+$/, '')}/${name}`;
  }
})();
