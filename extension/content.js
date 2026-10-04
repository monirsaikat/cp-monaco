// Runs on cPanel's File Manager editor page. Hides the stock editor, mounts Monaco
// (in an extension iframe so cPanel's CSP can't interfere), and reads, writes and
// lists files through cPanel's own UAPI using the current session.
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const file = params.get('file');
  const dir = params.get('dir');
  const session = location.pathname.match(/^\/cpsess\d+/);
  if (!file || !dir || !session) return;

  const api = `${session[0]}/execute/Fileman`;
  const api2Url = `${session[0]}/json-api/cpanel`;
  // Bumped whenever the messages between this script and editor.js change, so a stale
  // script left in an open tab after an update is detected instead of misbehaving.
  const PROTOCOL = 2;
  const editorUrl = chrome.runtime.getURL('editor.html');
  const editorOrigin = new URL(editorUrl).origin;
  const requestedCharset = params.get('file_charset') || params.get('charset') || 'utf-8';

  let dirty = false;
  let title = file;
  let baseTitle = '';
  let root = null;
  let frame = null;
  let filePromise = readFile(dir, file, requestedCharset);

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
    frame.allow = 'clipboard-write';
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
        const pending = filePromise || readFile(dir, file, requestedCharset);
        filePromise = null;
        try {
          const { content, charset } = await pending;
          post({ type: 'load', protocol: PROTOCOL, server: location.host, content, dir, file, charset });
        } catch (err) {
          post({ type: 'error', protocol: PROTOCOL, server: location.host, message: err.message, dir, file });
        }
        break;
      }
      case 'request':
        try {
          post({ type: 'response', id: msg.id, ok: true, data: await handleRequest(msg) });
        } catch (err) {
          post({ type: 'response', id: msg.id, ok: false, error: err.message });
        }
        break;
      case 'state':
        dirty = Boolean(msg.dirty);
        title = msg.file || 'Editor';
        updateTitle();
        break;
      case 'classic':
        unmount();
        break;
    }
  }

  async function handleRequest({ op, dir: d, file: f, content, charset, newName }) {
    if (typeof d !== 'string' || !d.startsWith('/')) throw new Error('Missing folder.');
    if (op !== 'list') checkName(f);
    switch (op) {
      case 'read':
        return readFile(d, f, charset || 'utf-8');
      case 'write':
        await uapi('save_file_content', {
          dir: d,
          file: f,
          content,
          from_charset: 'utf-8',
          to_charset: charset || 'utf-8',
        }, true);
        return {};
      case 'list':
        return listDir(d);
      case 'mkfile':
        await assertFree(d, f);
        try {
          await uapi('save_file_content', { dir: d, file: f, content: '', from_charset: 'utf-8', to_charset: 'utf-8' }, true);
        } catch {
          await api2('mkfile', { path: d, name: f });
        }
        return {};
      case 'mkdir':
        await assertFree(d, f);
        await api2('mkdir', { path: d, name: f, permissions: '0755' });
        return {};
      case 'rename':
        checkName(newName);
        await assertFree(d, newName);
        await api2('fileop', { op: 'rename', sourcefiles: joinPath(d, f), destfiles: joinPath(d, newName), doubledecode: 0 });
        return {};
      case 'trash':
        // Moves to ~/.trash, where File Manager's "View Trash" can restore it.
        await api2('fileop', { op: 'trash', sourcefiles: joinPath(d, f), doubledecode: 0 });
        return {};
      default:
        throw new Error(`Unknown request: ${op}`);
    }
  }

  function checkName(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\0]/.test(name)) {
      throw new Error('That name isn\u2019t allowed. Names can\u2019t be empty or contain a slash.');
    }
  }

  async function assertFree(d, name) {
    const entries = await listDir(d, true);
    if (entries.some((entry) => entry.name === name)) throw new Error(`\u201c${name}\u201d already exists in this folder.`);
  }

  function joinPath(directory, name) {
    return `${directory.replace(/\/+$/, '')}/${name}`;
  }

  function updateTitle() {
    if (!baseTitle) baseTitle = document.title;
    document.title = `${dirty ? '● ' : ''}${title} — cPanel`;
  }

  async function readFile(d, f, wanted) {
    const candidates = wanted.toLowerCase() === 'utf-8' ? ['utf-8'] : [wanted, 'utf-8'];
    let lastError;
    for (const from of candidates) {
      try {
        const data = await uapi('get_file_content', {
          dir: d,
          file: f,
          from_charset: from,
          to_charset: 'utf-8',
        });
        const detected = data.from_charset && data.from_charset !== '_DETECT_' ? data.from_charset : null;
        const charset = detected || (from === '_DETECT_' ? 'utf-8' : from);
        return { content: data.content ?? '', charset };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function listDir(d, includeAll = false) {
    const data = await uapi('list_files', {
      dir: d,
      show_hidden: 1,
      include_mime: 0,
    });
    // Symlinks, sockets and the like are left out: they can't be opened as text.
    return (Array.isArray(data) ? data : [])
      .filter((entry) => includeAll || entry.type === 'dir' || entry.type === 'file')
      .map((entry) => ({
        name: entry.file,
        type: entry.type,
        size: Number(entry.size) || 0,
        mtime: Number(entry.mtime) || 0,
      }));
  }

  // A few file operations (new folder, rename, move to trash) only exist in cPanel's
  // older API 2, which File Manager itself still uses.
  async function api2(fn, fields) {
    const body = new URLSearchParams({
      cpanel_jsonapi_apiversion: 2,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: fn,
      ...fields,
    });
    const res = await fetch(api2Url, { method: 'POST', body, credentials: 'same-origin' });
    let result;
    try {
      result = JSON.parse(await res.text()).cpanelresult;
    } catch {
      // Falls through to the error below.
    }
    if (!result) {
      throw new Error(res.ok
        ? 'cPanel sent an unexpected response. Your session may have expired, so reload the page and log in again.'
        : `cPanel returned HTTP ${res.status}.`);
    }
    if (result.error) throw new Error(result.error);
    const failed = (result.data || []).find((item) => item && String(item.result) === '0');
    if (failed) throw new Error(failed.reason || failed.err || failed.output || 'cPanel reported an error.');
    if (result.event && String(result.event.result) === '0') throw new Error(result.event.reason || 'cPanel reported an error.');
    return result.data;
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
})();
