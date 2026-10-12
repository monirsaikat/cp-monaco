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
  const PROTOCOL = 5;
  const editorUrl = chrome.runtime.getURL('editor.html');
  const editorOrigin = new URL(editorUrl).origin;
  const requestedCharset = params.get('file_charset') || params.get('charset') || 'utf-8';
  const ARCHIVE_FORMATS = ['zip', 'tar', 'tar.gz', 'tar.bz2'];
  const TAIL_WHOLE_MAX = 8 * 1024 * 1024;

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

  // The close-tab command from background.js. Answering false lets it close the browser tab.
  let closeReply = null;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.source !== 'cpm' || msg.type !== 'close-tab') return false;
    if (!frame) {
      sendResponse(false);
      return false;
    }
    closeReply?.(false);
    const timer = setTimeout(() => closeReply?.(false), 500);
    closeReply = (handled) => {
      clearTimeout(timer);
      closeReply = null;
      sendResponse(handled);
    };
    post({ type: 'close-tab' });
    return true;
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
      case 'close-tab':
        closeReply?.(Boolean(msg.handled));
        break;
      case 'classic':
        unmount();
        break;
    }
  }

  async function handleRequest({ op, dir: d, file: f, content, charset, newName, dest, mode, format, bytes, mime, overwrite, files, existingOk, limit, size }) {
    if (op === 'domains') return listDomains();
    checkDir(d);
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
      case 'mkdir': {
        const taken = (await listDir(d, true)).find((entry) => entry.name === f);
        // Uploading a folder goes into the folder of that name when there already is one.
        if (taken && existingOk && taken.type === 'dir') return {};
        if (taken) throw new Error(`“${f}” already exists in this folder.`);
        await api2('mkdir', { path: d, name: f, permissions: '0755' });
        return {};
      }
      case 'rename':
        checkName(newName);
        await assertFree(d, newName);
        await api2('fileop', { op: 'rename', sourcefiles: joinPath(d, f), destfiles: joinPath(d, newName), doubledecode: 0 });
        return {};
      case 'trash':
        // Moves to ~/.trash, where File Manager's "View Trash" can restore it.
        await api2('fileop', { op: 'trash', sourcefiles: joinPath(d, f), doubledecode: 0 });
        return {};
      case 'copy':
      case 'move':
        checkDir(dest);
        if (newName) checkName(newName);
        await assertFree(dest, newName || f);
        // cPanel copies or moves into `destfiles` when it's a folder, and to that exact path otherwise.
        await api2('fileop', { op, sourcefiles: joinPath(d, f), destfiles: newName ? joinPath(dest, newName) : dest, doubledecode: 0 });
        return {};
      case 'chmod':
        if (!/^[0-7]{3,4}$/.test(mode)) throw new Error('Permissions are three or four digits from 0 to 7, such as 644.');
        await api2('fileop', { op: 'chmod', sourcefiles: joinPath(d, f), metadata: mode.padStart(4, '0'), doubledecode: 0 });
        return {};
      case 'compress':
        checkName(newName);
        if (!ARCHIVE_FORMATS.includes(format)) throw new Error('That archive format isn\u2019t supported.');
        await assertFree(d, newName);
        await api2('fileop', { op: 'compress', sourcefiles: sourceList(d, Array.isArray(files) ? files : [f]), destfiles: joinPath(d, newName), metadata: format, doubledecode: 0 });
        return {};
      case 'extract':
        checkDir(dest);
        await api2('fileop', { op: 'extract', sourcefiles: joinPath(d, f), destfiles: dest, doubledecode: 0 });
        return {};
      case 'upload': {
        // The file arrives as plain bytes. A File object handed over from the editor's frame
        // can't always be read on this side, and the upload then fails before it is sent.
        if (!bytes || typeof bytes.byteLength !== 'number') throw new Error('Nothing to upload.');
        const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
        const body = new FormData();
        body.append('dir', d);
        if (overwrite) body.append('overwrite', '1');
        body.append('file-1', blob, f);
        const data = await uapi('upload_files', body, true);
        const failed = (data.uploads || []).find((item) => !Number(item.status));
        if (failed) throw new Error(failed.reason || 'cPanel rejected the file.');
        return {};
      }
      case 'download': {
        // cPanel answers with an attachment, so the browser saves it and this page stays put.
        const link = document.createElement('a');
        link.href = downloadUrl(d, f);
        link.download = f;
        document.body.append(link);
        link.click();
        link.remove();
        return {};
      }
      case 'blob': {
        // The raw bytes, for previewing images.
        const res = await fetch(downloadUrl(d, f), { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`cPanel returned HTTP ${res.status}.`);
        return { bytes: await res.arrayBuffer() };
      }
      case 'tail': {
        // The end of a file that may be far too big to read whole, such as an error log.
        const max = Math.min(Math.max(Number(limit) || 0, 1024), 1024 * 1024);
        const res = await fetch(downloadUrl(d, f), { credentials: 'same-origin', headers: { Range: `bytes=-${max}` } });
        if (!res.ok) throw new Error(`cPanel returned HTTP ${res.status}.`);
        // A server that ignores Range sends everything; don't pull a huge file in for its last lines.
        const whole = res.status !== 206;
        const length = Number(res.headers.get('content-length')) || Number(size) || 0;
        if (whole && length > TAIL_WHOLE_MAX) {
          res.body?.cancel();
          throw new Error(`The file is ${Math.round(length / 1024 / 1024)} MB and this server only sends it whole. Empty or rotate it first.`);
        }
        const buffer = await res.arrayBuffer();
        const cut = buffer.byteLength > max;
        return { text: new TextDecoder().decode(cut ? buffer.slice(-max) : buffer), partial: !whole || cut };
      }
      default:
        throw new Error(`Unknown request: ${op}`);
    }
  }

  // Every domain of the account with the folder it serves, to turn a file into its address.
  async function listDomains() {
    const data = await uapi('domains_data', { format: 'hash' }, false, `${session[0]}/execute/DomainInfo`);
    return [data.main_domain, ...(data.addon_domains || []), ...(data.sub_domains || [])]
      .filter((item) => item && item.domain && item.documentroot)
      .map((item) => ({ domain: item.domain, root: item.documentroot.replace(/\/+$/, '') }));
  }

  function checkName(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\0]/.test(name)) {
      throw new Error('That name isn\u2019t allowed. Names can\u2019t be empty or contain a slash.');
    }
  }

  // cPanel takes several files as one comma-separated list.
  function sourceList(d, names) {
    for (const name of names) {
      checkName(name);
      if (names.length > 1 && name.includes(',')) throw new Error(`“${name}” has a comma in its name, so it can’t be compressed together with other items.`);
    }
    return names.map((name) => joinPath(d, name)).join(',');
  }

  function checkDir(d) {
    if (typeof d !== 'string' || !d.startsWith('/')) throw new Error('Missing folder.');
  }

  function downloadUrl(d, f) {
    return `${session[0]}/download?skipencode=1&file=${encodeURIComponent(joinPath(d, f))}`;
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
        mode: entry.nicemode || '',
      }));
  }

  // Most file operations (new folder, rename, copy, move, permissions, archives, trash) only
  // exist in cPanel's older API 2, which File Manager itself still uses.
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

  async function uapi(fn, fields, usePost = false, base = api) {
    const body = fields instanceof FormData ? fields : new URLSearchParams(fields);
    let res;
    try {
      res = usePost
        ? await fetch(`${base}/${fn}`, { method: 'POST', body, credentials: 'same-origin' })
        : await fetch(`${base}/${fn}?${body}`, { credentials: 'same-origin' });
    } catch {
      // fetch only says "Failed to fetch"; say what that means.
      throw new Error('The request never got an answer from cPanel. The connection dropped, or the server refused it (for an upload: often a size limit or a security rule).');
    }

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
