// "Format Document" for PHP (Shift+Alt+F, or the command palette). Prettier's PHP plugin does the
// work in a Web Worker that is started on first use, given a time limit, and stopped when idle,
// so formatting can never freeze the page. Syntax errors are reported with their line number.
(() => {
  'use strict';

  const MAX_SIZE = 1.5 * 1024 * 1024;
  const TIME_LIMIT = 20000;
  const IDLE_LIMIT = 60000;

  let worker = null;
  let nextId = 1;
  let idleTimer = 0;
  const pending = new Map();

  function start() {
    worker = new Worker('format-worker.js');
    worker.onmessage = ({ data }) => {
      const waiting = pending.get(data.id);
      if (waiting) waiting(data);
    };
    worker.onerror = () => stop('The formatter could not be started.');
  }

  function stop(reason = 'The formatter was stopped.') {
    clearTimeout(idleTimer);
    if (worker) worker.terminate();
    worker = null;
    for (const resolve of [...pending.values()]) resolve({ ok: false, message: reason });
    pending.clear();
  }

  function run(code, options) {
    return new Promise((resolve) => {
      if (!worker) start();
      const id = nextId++;
      const timer = setTimeout(() => stop('Formatting took too long.'), TIME_LIMIT);
      pending.set(id, (result) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(result);
      });
      worker.postMessage({ id, code, options });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!pending.size) stop(); }, IDLE_LIMIT);
    });
  }

  // Newer syntax means the server already runs PHP 8, so modern output (trailing commas in
  // parameter lists) is safe. Otherwise stay conservative so older servers keep working.
  function phpVersionFor(code) {
    const modern = /\bmatch\s*\(|\benum\s+\w+|\breadonly\b|#\[|\?->|:\s*(?:static|never|mixed)\b|\bstr_contains\s*\(|\b(?:public|protected|private)\s+(?:readonly\s+)?\??[\w\\|]+\s+\$\w+\s*[,)]/.test(code);
    return modern ? '8.3' : '7.4';
  }

  // Replaces only the part of the text that changed, so the cursor, folds and scroll stay put.
  function minimalEdit(model, before, after) {
    if (before === after) return [];
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
      endBefore--;
      endAfter--;
    }
    const from = model.getPositionAt(start);
    const to = model.getPositionAt(endBefore);
    return [{
      range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column },
      text: after.slice(start, endAfter),
    }];
  }

  // notify(text, kind) shows a message in the status bar.
  function register(monaco, notify) {
    monaco.languages.registerDocumentFormattingEditProvider('php', {
      displayName: 'Prettier (PHP)',
      async provideDocumentFormattingEdits(model, options) {
        const code = model.getValue();
        if (code.length > MAX_SIZE) {
          notify('This file is too large to format.', 'error');
          return [];
        }
        notify('Formatting…');
        const version = model.getVersionId();
        const result = await run(code, {
          tabWidth: options.tabSize,
          useTabs: !options.insertSpaces,
          phpVersion: phpVersionFor(code),
          trailingCommaPHP: true,
        });
        if (!result.ok) {
          notify(`Can't format${result.line ? ` (line ${result.line})` : ''}: ${result.message}`, 'error');
          return [];
        }
        if (model.isDisposed() || model.getVersionId() !== version) {
          notify('Formatting skipped because the file changed meanwhile.');
          return [];
        }
        notify(result.code === code ? 'Already formatted.' : 'Formatted.', 'ok');
        return minimalEdit(model, code, result.code);
      },
    });
  }

  window.CPM_FORMAT = { register, phpVersionFor };
})();
