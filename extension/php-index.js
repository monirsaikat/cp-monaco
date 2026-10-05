// Project-wide PHP symbol index. Files are read a few at a time in the background (yielding to
// the browser between files), parsed with php-symbols.js, and remembered by size and modified
// time so later visits only re-read what changed.
(() => {
  'use strict';

  const MAX_FILES = 800;
  const MAX_FILE_SIZE = 300 * 1024;
  const CONCURRENCY = 3;
  const SKIP_PATH = /\/(tests?|migrations|seeders|storage|node_modules|\.git|bootstrap\/cache|resources\/views|lang)\//i;

  const files = new Map(); // path -> { size, mtime, classes }
  let byFqn = new Map();
  let byName = new Map();
  let version = 0;

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function rebuild() {
    byFqn = new Map();
    byName = new Map();
    for (const [path, entry] of files) {
      for (const cls of entry.classes) {
        cls.file = path;
        byFqn.set(cls.f.toLowerCase(), cls);
        const key = cls.n.toLowerCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(cls);
      }
    }
    version++;
  }

  // Finds a class by the name as written in a file (short, qualified or aliased).
  function find(name, context) {
    if (!name) return null;
    const clean = name.replace(/^\?/, '');
    if (clean.startsWith('\\')) return byFqn.get(clean.slice(1).toLowerCase()) || null;
    const resolved = context?.resolve ? context.resolve(clean) : clean;
    const exact = byFqn.get(resolved.toLowerCase());
    if (exact) return exact;
    const candidates = byName.get(clean.split('\\').pop().toLowerCase());
    if (candidates) return candidates[0];
    const docs = window.CPM_PHP_DOCS;
    return (docs && (docs.stubClass(resolved) || docs.stubClass(clean))) || null;
  }

  // All members of a class, including inherited and trait members. `local` classes (from the
  // file being edited) are checked first, since the index may not have them yet.
  function members(cls, local = []) {
    const result = new Map();
    const visited = new Set();
    const lookup = (fqn) => local.find((c) => c.f.toLowerCase() === fqn.toLowerCase()) || byFqn.get(fqn.toLowerCase())
      || (window.CPM_PHP_DOCS && window.CPM_PHP_DOCS.stubClass(fqn));
    const visit = (current, depth, inherited) => {
      if (!current || visited.has(current.f) || depth > 10) return;
      visited.add(current.f);
      for (const member of current.m) {
        if (inherited && member.v === 'private') continue;
        const key = `${member.k === 'm' ? 'm' : member.k === 'p' ? 'p' : 'c'}:${member.n}`;
        if (!result.has(key)) result.set(key, { ...member, from: current.n, fromFqn: current.f });
      }
      for (const trait of current.t) visit(lookup(trait), depth + 1, false);
      if (current.x) visit(lookup(current.x), depth + 1, true);
      for (const parent of current.i) visit(lookup(parent), depth + 1, true);
    };
    visit(cls, 0, false);
    return [...result.values()];
  }

  function add(path, size, mtime, text) {
    let classes = [];
    try {
      classes = window.CPM_PHP_SYMBOLS.parse(text).classes.map((cls) => {
        const { r, ...rest } = cls;
        return rest;
      });
    } catch {
      // A file the scanner can't make sense of simply contributes nothing.
    }
    files.set(path, { size, mtime, classes });
  }

  function update(path, text) {
    add(path, text.length, 0, text);
    rebuild();
  }

  function priority(path) {
    return /\/(app|src|core\/app|includes|classes|lib)\//.test(path) ? 0 : 1;
  }

  // candidates: [{ path, size, mtime }] for the PHP files of the project.
  // Returns when everything is parsed; `onProgress(done, total)` is called along the way.
  async function build(candidates, { read, onProgress, onSave }) {
    const wanted = candidates
      .filter((c) => c.size <= MAX_FILE_SIZE && !SKIP_PATH.test(c.path) && !/\.blade\.php$/.test(c.path))
      .sort((a, b) => priority(a.path) - priority(b.path) || a.size - b.size)
      .slice(0, MAX_FILES);
    const wantedPaths = new Set(wanted.map((c) => c.path));
    const stale = wanted.filter((c) => {
      const known = files.get(c.path);
      return !known || known.size !== c.size || (c.mtime && known.mtime !== c.mtime);
    });
    let done = 0;
    let sinceSave = 0;
    let next = 0;

    const worker = async () => {
      while (next < stale.length) {
        const item = stale[next++];
        try {
          const { content } = await read(item.path);
          add(item.path, item.size, item.mtime, content);
        } catch {
          files.set(item.path, { size: item.size, mtime: item.mtime, classes: [] });
        }
        done++;
        sinceSave++;
        if (done % 10 === 0 || done === stale.length) {
          rebuild();
          onProgress?.(done, stale.length);
        }
        if (sinceSave >= 60) {
          sinceSave = 0;
          onSave?.();
        }
        await tick();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Files that no longer exist (or fell out of the project) are dropped.
    let removed = false;
    for (const path of [...files.keys()]) {
      if (!wantedPaths.has(path)) {
        files.delete(path);
        removed = true;
      }
    }
    if (stale.length || removed) rebuild();
    onSave?.();
  }

  function serialize() {
    return [...files].map(([path, entry]) => [path, entry.size, entry.mtime, entry.classes]);
  }

  function restore(rows) {
    files.clear();
    for (const [path, size, mtime, classes] of rows || []) files.set(path, { size, mtime, classes });
    rebuild();
  }

  window.CPM_PHP_INDEX = {
    build,
    find,
    members,
    update,
    serialize,
    restore,
    get size() { return files.size; },
    get version() { return version; },
    all: () => [...byFqn.values()],
  };
})();
