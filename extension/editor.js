// Monaco UI that lives inside the extension iframe. It talks to content.js via
// postMessage: content.js owns the cPanel session and does the actual reads, writes
// and directory listings. This side keeps the tabs, the explorer and quick open.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    name: $('name'),
    dirty: $('dirty'),
    path: $('path'),
    language: $('language'),
    wrap: $('wrap'),
    theme: $('theme'),
    classic: $('classic'),
    save: $('save'),
    sidebarToggle: $('sidebar-toggle'),
    sidebar: $('sidebar'),
    resizer: $('resizer'),
    rootName: $('root-name'),
    rootUp: $('root-up'),
    treeRefresh: $('tree-refresh'),
    quickOpenBtn: $('quick-open-btn'),
    tree: $('tree'),
    tabs: $('tabs'),
    editor: $('editor'),
    empty: $('empty'),
    overlay: $('overlay'),
    overlayText: $('overlay-text'),
    overlayClassic: $('overlay-classic'),
    quick: $('quick-open'),
    quickInput: $('quick-input'),
    quickList: $('quick-list'),
    quickStatus: $('quick-status'),
    message: $('message'),
    cursor: $('cursor'),
    eol: $('eol'),
    charset: $('charset'),
    trust: $('trust'),
    trustMore: $('trust-more'),
    trustClose: $('trust-close'),
    trustStatus: $('trust-status'),
    trustDialog: $('trust-dialog'),
    trustDialogClose: $('trust-dialog-close'),
    review: $('review'),
    history: $('history'),
    viewFiles: $('view-files'),
    viewSearch: $('view-search'),
    filesView: $('files-view'),
    searchView: $('search-view'),
    newFile: $('new-file'),
    newFolder: $('new-folder'),
    searchInput: $('search-input'),
    searchCase: $('search-case'),
    searchWord: $('search-word'),
    searchRegex: $('search-regex'),
    searchInclude: $('search-include'),
    searchStatus: $('search-status'),
    searchResults: $('search-results'),
    notice: $('notice'),
    noticeText: $('notice-text'),
    noticeActions: $('notice-actions'),
    diff: $('diff'),
    diffTitle: $('diff-title'),
    diffLegend: $('diff-legend'),
    diffActions: $('diff-actions'),
    diffEditor: $('diff-editor'),
    menu: $('menu'),
    ask: $('ask'),
    askForm: $('ask-form'),
    askTitle: $('ask-title'),
    askText: $('ask-text'),
    askInput: $('ask-input'),
    askError: $('ask-error'),
    askButtons: $('ask-buttons'),
    historyDialog: $('history-dialog'),
    historyTitle: $('history-title'),
    historyList: $('history-list'),
    historyClose: $('history-close'),
    historyClear: $('history-clear'),
    clearLocal: $('clear-local'),
  };

  // Extensions Monaco doesn't map (or maps poorly) on its own.
  const LANGUAGE_OVERRIDES = {
    htaccess: 'shell',
    conf: 'ini',
    env: 'ini',
    vue: 'html',
    svelte: 'html',
    phtml: 'php',
    tpl: 'html',
  };

  // Files that can't be edited as text. SVG is text, so it's not listed.
  const BINARY_EXTENSIONS = new Set((
    'png jpg jpeg gif webp avif ico bmp tif tiff psd heic zip gz tgz bz2 xz rar 7z tar jar war ' +
    'pdf doc docx xls xlsx ppt pptx odt ods mp3 mp4 m4a wav ogg oga webm mov avi mkv flac ' +
    'woff woff2 ttf otf eot exe dll so bin dat db sqlite iso dmg class pyc swf'
  ).split(' '));
  const LARGE_FILE = 5 * 1024 * 1024;

  // Quick open walks the folder tree through the same UAPI call as the explorer, so it
  // stays away from folders that are huge or never hold code, and stops at a fixed size.
  const SKIP_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', '.cache', 'cache', '.trash']);
  const SKIP_HOME_DIRS = new Set([
    'mail', 'logs', 'tmp', 'ssl', 'etc', 'access-logs', '.cpanel', '.cagefs', '.caldav', '.htpasswds',
    '.softaculous', '.spamassassin', '.npm', '.composer', '.razor', '.subaccounts', '.cphorde', '.trash',
  ]);
  const HOME_PATTERN = /^\/home\d*\/[^/]+/;
  const INDEX_MAX_FILES = 20000;
  const INDEX_MAX_DIRS = 2500;
  const INDEX_CONCURRENCY = 6;
  const QUICK_MAX_RESULTS = 60;

  // Must match PROTOCOL in content.js.
  const PROTOCOL = 2;
  const CODE_FONT = '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace';
  const DRAFT_DELAY = 800;
  const HISTORY_MAX = 20;
  const HISTORY_DAYS = 30;
  const HISTORY_MAX_SIZE = 2 * 1024 * 1024;
  const SESSION_MAX_TABS = 12;
  // Find in files downloads each file once and keeps it in memory, within these limits.
  const SEARCH_MAX_FILE_SIZE = 1024 * 1024;
  const SEARCH_MAX_FILES = 5000;
  const SEARCH_MAX_RESULTS = 2000;
  const SEARCH_MAX_PER_FILE = 200;
  const SEARCH_CACHE_CHARS = 50 * 1024 * 1024;

  const THEMES = window.CPM_THEMES;
  // Material Icon Theme tables, generated at build time (monaco/file-icons/icons.js).
  const FILE_ICONS = window.CPM_FILE_ICONS || null;
  const iconCache = new Map();
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const prefs = loadPrefs();
  let editor = null;
  let parentOrigin = null;
  let lastState = '';
  let nextRequestId = 1;
  const pending = new Map();

  // Each tab: { path, dir, file, model, charset, savedVersion, saving, viewState, shownDirty, lastUsed }
  const tabs = [];
  let active = null;
  const opening = new Set();

  let rootDir = null;
  const expanded = new Set();
  // dir -> { status: 'loading' | 'ok' | 'error', entries, error, promise }
  const listings = new Map();

  const quick = { files: [], crawling: false, done: false, truncated: false, generation: 0, results: [], selected: 0, frame: 0, promise: null };

  // The cPanel host, so drafts, history and open tabs from different servers never mix.
  let server = '';
  let sessionKey = '';
  const diff = { editor: null, temp: [] };
  const search = { generation: 0, timer: 0, cache: new Map(), cacheChars: 0, groups: [], total: 0, collapsed: new Set(), renderTimer: 0, matchList: [] };
  let lastTreeRow = null;

  setupThemePicker();
  applyTheme();
  setupTrust();
  setupSidebar();
  setupQuickOpen();
  setupFileOps();
  setupSearch();
  setupHistory();
  ui.wrap.setAttribute('aria-pressed', String(prefs.wrap));
  darkQuery.addEventListener('change', () => {
    if (prefs.theme === 'system') applyTheme();
  });
  window.addEventListener('keydown', onGlobalKey, true);

  // Monaco's default worker setup uses blob: URLs for chrome-extension:// pages, which the
  // extension CSP blocks. Point it at the bundled worker file instead (same origin, allowed).
  self.MonacoEnvironment = {
    getWorkerUrl: () => 'monaco/vs/base/worker/workerMain.js',
  };

  require.config({ paths: { vs: 'monaco/vs' } });
  // If Monaco stalls (slow host, blocked script), say so instead of loading forever.
  const loadWatchdog = setTimeout(() => {
    showOverlay('Monaco is taking too long to load.\nOpen DevTools (F12) for details, or switch to the cPanel editor.', true);
  }, 20000);

  require(['vs/editor/editor.main'], () => {
    clearTimeout(loadWatchdog);
    try {
      init();
    } catch (err) {
      console.error('cPanel Monaco: start-up failed', err);
      showOverlay(`The editor failed to start.\n${err?.message || err}`, true);
    }
  }, (err) => {
    clearTimeout(loadWatchdog);
    showOverlay(`Monaco failed to load.\n${err?.message || err}`, true);
  });

  function init() {
    // Files are edited standalone, so imports/globals can't be resolved. Only report syntax errors.
    const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics);
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics);

    // Emmet abbreviations (ul>li*3, .card, m10…) show up as suggestions; Tab or Enter expands them.
    if (window.emmetMonaco) {
      emmetMonaco.emmetHTML(monaco, ['html', 'php', 'twig', 'handlebars']);
      emmetMonaco.emmetCSS(monaco, ['css', 'scss', 'less']);
    }

    for (const theme of THEMES) {
      if (theme.palette) monaco.editor.defineTheme(monacoThemeId(theme), buildMonacoTheme(theme));
    }

    editor = monaco.editor.create(ui.editor, {
      model: null,
      theme: monacoThemeId(resolveTheme()),
      automaticLayout: true,
      fontFamily: CODE_FONT,
      fontSize: 14,
      wordWrap: prefs.wrap ? 'on' : 'off',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      stickyScroll: { enabled: true },
      fixedOverflowWidgets: true,
    });

    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, toggleWrap);
    editor.onDidChangeCursorPosition(updateCursor);
    editor.onDidChangeCursorSelection(updateCursor);

    const languages = monaco.languages.getLanguages()
      .map((lang) => ({ id: lang.id, label: lang.aliases?.[0] || lang.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    for (const lang of languages) ui.language.add(new Option(lang.label, lang.id));

    ui.language.addEventListener('change', () => {
      if (active) monaco.editor.setModelLanguage(active.model, ui.language.value);
    });
    ui.wrap.addEventListener('click', toggleWrap);
    ui.save.addEventListener('click', () => save());
    ui.review.addEventListener('click', review);
    ui.history.addEventListener('click', openHistory);
    ui.classic.addEventListener('click', backToClassic);
    ui.overlayClassic.addEventListener('click', () => send({ type: 'classic' }));
    setupTabs();

    // Drafts are written shortly after typing stops; make sure the last one lands.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDrafts();
    });
    window.addEventListener('pagehide', flushDrafts);
    quiet(db.prune(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000));

    window.addEventListener('message', onMessage);
    showOverlay('Loading file…');
    // No content in this message, so a wildcard target is fine; the reply tells us the real origin.
    window.parent.postMessage({ source: 'cpm', type: 'ready' }, '*');
  }

  function onMessage(event) {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.source !== 'cpm') return;
    if (parentOrigin && event.origin !== parentOrigin) return;

    // After the extension is reloaded or updated, Chrome keeps running the old content
    // script in tabs that were already open, and it doesn't speak this version's protocol.
    if ((msg.type === 'load' || msg.type === 'error') && msg.protocol !== PROTOCOL) {
      parentOrigin = event.origin;
      showOverlay('The extension was just updated.\nReload this page to finish updating it.', true);
      return;
    }

    switch (msg.type) {
      case 'load': {
        parentOrigin = event.origin;
        server = msg.server;
        setupWorkspace(msg.dir);
        const previous = readSession();
        const tab = addTab(msg);
        activate(tab);
        restoreSession(previous, tab);
        break;
      }
      case 'error':
        parentOrigin = event.origin;
        server = msg.server;
        // The explorer still works, so other files can be opened from it.
        setupWorkspace(msg.dir);
        showOverlay(`Couldn't load ${msg.file}.\n${msg.message}`, true);
        break;
      case 'response': {
        const request = pending.get(msg.id);
        if (!request) break;
        pending.delete(msg.id);
        if (msg.ok) request.resolve(msg.data);
        else request.reject(new Error(msg.error));
        break;
      }
    }
  }

  function send(message) {
    if (parentOrigin) window.parent.postMessage({ source: 'cpm', ...message }, parentOrigin);
  }

  function request(message) {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pending.set(id, { resolve, reject });
      send({ type: 'request', id, ...message });
    });
  }

  function onGlobalKey(event) {
    if (document.querySelector('dialog[open]')) return;
    const action = shortcutFor(event);
    if (!action) return;
    // Capture phase, so Monaco and the browser (print, bookmarks) never see these.
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  function shortcutFor(event) {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      return event.shiftKey
        ? { f: openSearch, p: openCommandPalette }[key]
        : { s: () => save(), p: openQuickOpen, b: toggleSidebar }[key];
    }
    // Chrome never passes Ctrl+W, Ctrl+Tab or Ctrl+PageUp/PageDown to a page, so tab
    // shortcuts use Alt. Matched by physical key, so Option works on a Mac as well.
    if (event.altKey && !mod && !event.shiftKey) {
      // Monaco's find widget uses Alt+C/W/R for its own toggles.
      if (event.target.closest?.('.find-widget')) return null;
      if (event.code === 'KeyW') return active ? () => closeTab(active) : null;
      if (event.code === 'PageDown') return () => cycleTab(1);
      if (event.code === 'PageUp') return () => cycleTab(-1);
      const digit = event.code.match(/^Digit([1-9])$/)?.[1];
      if (digit) return () => openTabAt(Number(digit));
    }
    return null;
  }

  function cycleTab(step) {
    if (tabs.length < 2) return;
    const index = tabs.indexOf(active);
    activate(tabs[(index + step + tabs.length) % tabs.length]);
  }

  // Alt+1…8 open that tab; Alt+9 the last one, as in VS Code.
  function openTabAt(position) {
    const tab = position === 9 ? tabs[tabs.length - 1] : tabs[position - 1];
    if (tab && tab !== active) activate(tab);
  }

  function openCommandPalette() {
    if (!editor) return;
    editor.focus();
    editor.trigger('keyboard', 'editor.action.quickCommand', null);
  }

  // ---- Tabs ----

  // `base` is the file's text on the server as of the last load or save: the reference for
  // conflict checks, drafts and the "before your edits" history entry.
  function addTab({ dir, file, content, charset }, append = false) {
    const path = joinPath(dir, file);
    // No file URI: a tab's path can change on rename, and a model's URI can't.
    const model = monaco.editor.createModel(content, guessLanguage(file));
    const tab = {
      path, dir, file, model, charset,
      base: content,
      openedAt: Date.now(),
      savedVersion: model.getAlternativeVersionId(),
      saving: false,
      viewState: null,
      shownDirty: false,
      lastUsed: 0,
      notice: null,
      draftOffer: null,
      draftTimer: 0,
      historyStarted: false,
    };
    model.onDidChangeContent(() => {
      refreshDirty();
      scheduleDraft(tab);
    });
    tabs.splice(append || !active ? tabs.length : tabs.indexOf(active) + 1, 0, tab);
    checkDraft(tab);
    saveSession();
    return tab;
  }

  function activate(tab) {
    closeDiff(false);
    if (active && active !== tab) active.viewState = editor.saveViewState();
    active = tab;
    tab.lastUsed = Date.now();
    editor.setModel(tab.model);
    if (tab.viewState) editor.restoreViewState(tab.viewState);
    hideOverlay();
    updateChrome();
    revealInTree(tab.path);
    editor.focus();
  }

  function closeTab(tab) {
    const dirty = isDirty(tab);
    if (dirty && !confirm(`${tab.file} has unsaved changes. Close it and lose them?`)) return;
    clearTimeout(tab.draftTimer);
    // Discarding on purpose also discards the draft, unless it's a recovered one not yet looked at.
    if (dirty && !tab.draftOffer) quiet(db.deleteDraft(fileKey(tab.path)));
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);
    saveSession();
    if (tab === active) {
      closeDiff(false);
      active = null;
      const next = tabs[index] || tabs[index - 1];
      if (next) {
        activate(next);
      } else {
        editor.setModel(null);
        updateChrome();
        markActiveRow();
      }
    } else {
      renderTabs();
      sendState();
    }
    tab.model.dispose();
  }

  function setupTabs() {
    ui.tabs.addEventListener('click', (event) => {
      const el = event.target.closest('.tab');
      const tab = el && tabs.find((t) => t.path === el.dataset.path);
      if (!tab) return;
      if (event.target.closest('.tab-close')) closeTab(tab);
      else if (tab !== active) activate(tab);
    });
    // Middle-click closes, as in VS Code and browsers.
    ui.tabs.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
    ui.tabs.addEventListener('auxclick', (event) => {
      const el = event.target.closest('.tab');
      const tab = el && tabs.find((t) => t.path === el.dataset.path);
      if (tab && event.button === 1) closeTab(tab);
    });
    ui.tabs.addEventListener('keydown', (event) => {
      const el = event.target.closest('.tab');
      const tab = el && tabs.find((t) => t.path === el.dataset.path);
      if (!tab) return;
      if (event.key === 'Enter' || event.key === ' ') activate(tab);
      else if (event.key === 'Delete') closeTab(tab);
      else if (event.key === 'ArrowRight') el.nextElementSibling?.focus();
      else if (event.key === 'ArrowLeft') el.previousElementSibling?.focus();
      else return;
      event.preventDefault();
    });
  }

  function renderTabs() {
    // Same file name open from two folders: show the folder name too.
    const counts = {};
    for (const tab of tabs) counts[tab.file] = (counts[tab.file] || 0) + 1;

    ui.tabs.replaceChildren(...tabs.map((tab) => {
      const dirty = isDirty(tab);
      tab.shownDirty = dirty;
      const el = document.createElement('div');
      el.className = `tab${tab === active ? ' active' : ''}${dirty ? ' unsaved' : ''}`;
      el.dataset.path = tab.path;
      el.title = tab.path;
      el.tabIndex = tab === active ? 0 : -1;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab === active));

      const label = document.createElement('span');
      label.className = 'tab-name';
      label.textContent = tab.file;
      el.append(fileIcon(tab.file), label);
      if (counts[tab.file] > 1) {
        const hint = document.createElement('span');
        hint.className = 'tab-hint';
        hint.textContent = baseName(tab.dir);
        el.append(hint);
      }

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.tabIndex = -1;
      close.title = dirty ? 'Unsaved changes. Click to close (Alt+W).' : 'Close (Alt+W)';
      close.setAttribute('aria-label', `Close ${tab.file}`);
      close.append(icon('i-x'));
      el.append(close);
      return el;
    }));
    ui.tabs.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // The toolbar, status bar and tab strip all describe the active tab.
  function updateChrome() {
    renderTabs();
    ui.empty.hidden = Boolean(active);
    ui.language.disabled = !active;
    ui.review.disabled = !active;
    ui.history.disabled = !active;
    renderNotice();
    if (active) {
      const { file, path, model, charset } = active;
      document.title = file;
      ui.name.textContent = file;
      // LRM marks keep slashes in place while the RTL trick truncates the start of long paths.
      ui.path.textContent = `‎${path}‎`;
      ui.path.title = path;
      ui.language.value = model.getLanguageId();
      ui.charset.textContent = charset.toUpperCase();
      ui.eol.textContent = model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
    } else {
      document.title = 'Monaco Editor';
      ui.name.textContent = 'No file open';
      ui.path.textContent = '';
      ui.path.title = '';
      ui.charset.textContent = '';
      ui.eol.textContent = '';
      ui.cursor.textContent = '';
    }
    updateCursor();
    refreshDirty();
  }

  function isDirty(tab) {
    return !tab.model.isDisposed() && tab.model.getAlternativeVersionId() !== tab.savedVersion;
  }

  function refreshDirty() {
    if (tabs.some((tab) => isDirty(tab) !== tab.shownDirty)) renderTabs();
    ui.dirty.hidden = !active || !isDirty(active);
    ui.save.disabled = !active || active.saving;
    sendState();
  }

  // Tells content.js what to put in the page title and whether to warn before unload.
  function sendState() {
    const state = { file: active?.file || '', dirty: tabs.some(isDirty) };
    const key = JSON.stringify(state);
    if (key === lastState) return;
    lastState = key;
    send({ type: 'state', ...state });
  }

  function guessLanguage(file) {
    const lower = file.toLowerCase();
    const ext = extensionOf(lower);
    if (lower.startsWith('.env')) return 'ini';
    if (LANGUAGE_OVERRIDES[ext]) return LANGUAGE_OVERRIDES[ext];

    const languages = monaco.languages.getLanguages();
    const byName = languages.find((l) => l.filenames?.some((n) => n.toLowerCase() === lower));
    if (byName) return byName.id;
    const byExt = ext && languages.find((l) => l.extensions?.includes(`.${ext}`));
    return byExt ? byExt.id : 'plaintext';
  }

  // Resolves to true once the file is on the server. Unless `force` is set, it first checks
  // that nobody changed the file since it was opened, and shows the differences if they did.
  async function save({ force = false } = {}) {
    const tab = active;
    if (!tab || tab.saving) return false;
    tab.saving = true;
    refreshDirty();
    setMessage(`Saving ${tab.file}…`);
    const version = tab.model.getAlternativeVersionId();
    const content = tab.model.getValue();
    const target = { dir: tab.dir, file: tab.file, charset: tab.charset };
    try {
      if (!force) {
        // A file that can't be read (e.g. deleted meanwhile) is simply written again.
        const current = await request({ op: 'read', ...target }).then((r) => r.content, () => null);
        if (current !== null && current !== tab.base && current !== content) {
          showConflict(tab, current);
          return false;
        }
      }
      await request({ op: 'write', ...target, content });
      const before = tab.base;
      tab.base = content;
      tab.savedVersion = version;
      updateSearchCache(tab.path, content);
      recordHistory(tab, before, content);
      if (!isDirty(tab) && !tab.draftOffer) {
        clearTimeout(tab.draftTimer);
        tab.draftTimer = 0;
        quiet(db.deleteDraft(fileKey(tab.path)));
      }
      if (tab.notice?.kind === 'trashed') setNotice(tab, null);
      // Converting to a legacy charset can be lossy; compare future saves with what's really there.
      if (tab.charset.toLowerCase() !== 'utf-8') {
        request({ op: 'read', ...target }).then((r) => {
          if (tab.base === content) tab.base = r.content;
        }, () => {});
      }
      setMessage(`Saved ${tab.file} at ${new Date().toLocaleTimeString()}`, 'ok');
      return true;
    } catch (err) {
      setMessage(`Save failed: ${err.message}`, 'error');
      return false;
    } finally {
      tab.saving = false;
      refreshDirty();
    }
  }

  function backToClassic() {
    const unsaved = tabs.filter(isDirty).length;
    if (unsaved && !confirm(`You have unsaved changes in ${unsaved === 1 ? '1 file' : `${unsaved} files`}. Discard them and switch to the cPanel editor?`)) return;
    flushDrafts();
    send({ type: 'classic' });
  }

  function toggleWrap() {
    prefs.wrap = !prefs.wrap;
    savePrefs();
    editor.updateOptions({ wordWrap: prefs.wrap ? 'on' : 'off' });
    ui.wrap.setAttribute('aria-pressed', String(prefs.wrap));
  }

  // ---- Opening files ----

  async function openFile(dir, file, { size = 0, line = 0, column = 1, length = 0 } = {}) {
    const path = joinPath(dir, file);
    const open = tabs.find((t) => t.path === path);
    if (open) {
      if (open !== active) activate(open);
      goToLine(line, column, length);
      return;
    }
    if (BINARY_EXTENSIONS.has(extensionOf(file.toLowerCase()))) {
      setMessage(`${file} is a binary file, so it can't be edited as text.`, 'error');
      return;
    }
    if (size > LARGE_FILE && !confirm(`${file} is ${formatSize(size)}. Very large files can make the editor slow. Open it anyway?`)) return;
    if (opening.has(path)) return;

    opening.add(path);
    setMessage(`Opening ${file}…`);
    try {
      const { content, charset } = await request({ op: 'read', dir, file });
      activate(tabs.find((t) => t.path === path) || addTab({ dir, file, content, charset }));
      setMessage('');
      goToLine(line, column, length);
    } catch (err) {
      setMessage(`Couldn't open ${file}: ${err.message}`, 'error');
    } finally {
      opening.delete(path);
    }
  }

  function goToLine(line, column = 1, length = 0) {
    if (!line || !active) return;
    const lineNumber = Math.min(line, active.model.getLineCount());
    const range = new monaco.Range(lineNumber, column, lineNumber, column + length);
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    editor.focus();
  }

  // ---- Explorer ----

  function setupWorkspace(dir) {
    // Start at the account's home folder when the path shows it, with the file's folder opened.
    const home = dir.match(HOME_PATTERN)?.[0];
    setRoot(home || dir);
    sessionKey = `${server}|${home || dir}`;
    for (let d = dir; isInside(d, rootDir); d = parentOf(d)) expanded.add(d);
    renderTree();
    // Some hosts lay out home folders differently; fall back to the file's own folder.
    listDir(rootDir).catch(() => {
      if (rootDir !== dir) {
        setRoot(dir);
        renderTree();
      }
    });
  }

  function setRoot(dir) {
    rootDir = dir;
    ui.rootName.textContent = baseName(dir);
    ui.rootName.title = dir;
    ui.rootUp.disabled = dir === '/';
    resetIndex();
  }

  function setupSidebar() {
    applySidebar();
    ui.sidebarToggle.addEventListener('click', toggleSidebar);
    ui.rootUp.addEventListener('click', () => {
      if (!rootDir || rootDir === '/') return;
      expanded.add(rootDir);
      setRoot(parentOf(rootDir));
      renderTree();
    });
    ui.treeRefresh.addEventListener('click', refreshTree);
    ui.quickOpenBtn.addEventListener('click', openQuickOpen);

    ui.tree.addEventListener('click', (event) => {
      const row = event.target.closest('.row');
      if (!row) return;
      if (row.dataset.type === 'dir') toggleDir(row.dataset.path);
      else openFile(row.dataset.dir, row.dataset.name, { size: Number(row.dataset.size) });
    });
    ui.tree.addEventListener('keydown', onTreeKey);
    ui.tree.addEventListener('focusin', (event) => {
      if (!event.target.classList.contains('row')) return;
      setTreeTabStop(event.target);
      const { path, type, dir } = event.target.dataset;
      lastTreeRow = { path, type, dir };
    });

    // Drag (or arrow keys on) the divider to resize the explorer.
    const resize = (width) => {
      prefs.sidebarWidth = Math.round(Math.min(Math.max(width, 160), Math.min(600, innerWidth - 240)));
      ui.sidebar.style.width = `${prefs.sidebarWidth}px`;
    };
    ui.resizer.tabIndex = 0;
    ui.resizer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      ui.resizer.setPointerCapture(event.pointerId);
      ui.resizer.classList.add('dragging');
      const left = ui.sidebar.getBoundingClientRect().left;
      const move = (e) => resize(e.clientX - left);
      const stop = () => {
        ui.resizer.classList.remove('dragging');
        ui.resizer.removeEventListener('pointermove', move);
        ui.resizer.removeEventListener('pointerup', stop);
        ui.resizer.removeEventListener('pointercancel', stop);
        savePrefs();
      };
      ui.resizer.addEventListener('pointermove', move);
      ui.resizer.addEventListener('pointerup', stop);
      ui.resizer.addEventListener('pointercancel', stop);
    });
    ui.resizer.addEventListener('keydown', (event) => {
      const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
      if (!step) return;
      event.preventDefault();
      resize(prefs.sidebarWidth + step);
      savePrefs();
    });
  }

  function toggleSidebar() {
    prefs.sidebar = !prefs.sidebar;
    savePrefs();
    applySidebar();
    if (prefs.sidebar) (ui.tree.querySelector('.row[tabindex="0"]') || ui.tree).focus();
    else editor?.focus();
  }

  function applySidebar() {
    ui.sidebar.hidden = !prefs.sidebar;
    ui.resizer.hidden = !prefs.sidebar;
    ui.sidebar.style.width = `${prefs.sidebarWidth}px`;
    ui.sidebarToggle.setAttribute('aria-pressed', String(prefs.sidebar));
  }

  function listDir(dir) {
    let listing = listings.get(dir);
    if (!listing) {
      listing = { status: 'loading', entries: [], error: '' };
      listing.promise = request({ op: 'list', dir }).then((entries) => {
        listing.status = 'ok';
        listing.entries = entries.sort((a, b) =>
          (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || collator.compare(a.name, b.name));
        return listing.entries;
      }, (err) => {
        listing.status = 'error';
        listing.error = err.message;
        throw err;
      });
      listings.set(dir, listing);
    }
    return listing.promise;
  }

  function toggleDir(path) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    renderTree();
  }

  // The tree is a flat list of rows, indented by depth, rebuilt whenever it changes.
  function renderTree() {
    if (!rootDir) return;
    const focused = document.activeElement?.closest?.('.row')?.dataset.path;
    const rows = document.createDocumentFragment();
    appendRows(rows, rootDir, 0);
    ui.tree.replaceChildren(rows);
    const row = focused && findRow(focused);
    if (row) row.focus();
    setTreeTabStop(row);
  }

  function appendRows(parent, dir, depth) {
    const listing = listings.get(dir);
    if (!listing || listing.status === 'loading') {
      // The listing may already be in flight for quick open; either way, redraw once it lands.
      const pendingListing = listing || (listDir(dir), listings.get(dir));
      if (!pendingListing.redraws) {
        pendingListing.redraws = true;
        pendingListing.promise.catch(() => {}).finally(renderTree);
      }
      parent.append(noteRow('Loading…', depth));
      return;
    }
    if (listing.status === 'error') {
      parent.append(noteRow(listing.error, depth, true));
      return;
    }
    if (!listing.entries.length) {
      parent.append(noteRow('Empty folder', depth));
      return;
    }
    for (const entry of listing.entries) {
      const path = joinPath(dir, entry.name);
      const isDir = entry.type === 'dir';
      const open = isDir && expanded.has(path);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `row${active?.path === path ? ' active' : ''}`;
      row.tabIndex = -1;
      row.title = path;
      row.style.paddingLeft = `${8 + depth * 12}px`;
      Object.assign(row.dataset, { path, dir, name: entry.name, type: entry.type, size: entry.size });
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      if (isDir) row.setAttribute('aria-expanded', String(open));
      else row.setAttribute('aria-selected', String(active?.path === path));

      const chevron = icon('i-chevron', 'chevron');
      if (!isDir) chevron.style.visibility = 'hidden';
      const label = document.createElement('span');
      label.textContent = entry.name;
      row.append(chevron, isDir ? folderIcon(entry.name, open) : fileIcon(entry.name), label);
      parent.append(row);

      if (open) appendRows(parent, path, depth + 1);
    }
  }

  function noteRow(text, depth, isError = false) {
    const note = document.createElement('div');
    note.className = `note${isError ? ' error' : ''}`;
    note.style.paddingLeft = `${30 + depth * 12}px`;
    note.textContent = text;
    return note;
  }

  function findRow(path) {
    return ui.tree.querySelector(`.row[data-path="${CSS.escape(path)}"]`);
  }

  // Only one row is in the Tab order; arrow keys move between rows.
  function setTreeTabStop(row) {
    const target = row || ui.tree.querySelector('.row.active') || ui.tree.querySelector('.row');
    for (const r of ui.tree.querySelectorAll('.row[tabindex="0"]')) r.tabIndex = -1;
    if (target) target.tabIndex = 0;
  }

  function onTreeKey(event) {
    const row = event.target.closest('.row');
    if (!row) return;
    const rows = [...ui.tree.querySelectorAll('.row')];
    const index = rows.indexOf(row);
    const { path, type } = row.dataset;
    const open = row.getAttribute('aria-expanded') === 'true';
    let target = null;
    switch (event.key) {
      case 'ArrowDown': target = rows[index + 1]; break;
      case 'ArrowUp': target = rows[index - 1]; break;
      case 'Home': target = rows[0]; break;
      case 'End': target = rows[rows.length - 1]; break;
      case 'ArrowRight':
        if (type === 'dir' && !open) toggleDir(path);
        else if (type === 'dir') target = rows[index + 1];
        break;
      case 'ArrowLeft':
        if (type === 'dir' && open) toggleDir(path);
        else target = findRow(parentOf(path));
        break;
      case 'F2':
        renameEntry(path, type);
        break;
      case 'Delete':
        trashEntry(path, type);
        break;
      case 'F10':
        if (!event.shiftKey) return;
        showRowMenu(row);
        break;
      case 'ContextMenu':
        showRowMenu(row);
        break;
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  }

  function markActiveRow() {
    for (const row of ui.tree.querySelectorAll('.row')) {
      const isActive = row.dataset.path === active?.path;
      row.classList.toggle('active', isActive);
      if (row.dataset.type === 'file') row.setAttribute('aria-selected', String(isActive));
    }
    if (!ui.tree.contains(document.activeElement)) setTreeTabStop(null);
  }

  // Opens the folders above a file so it shows in the explorer.
  function revealInTree(path) {
    if (!rootDir || !isInside(path, rootDir)) return markActiveRow();
    let changed = false;
    for (let d = parentOf(path); isInside(d, rootDir); d = parentOf(d)) {
      if (!expanded.has(d)) {
        expanded.add(d);
        changed = true;
      }
    }
    if (changed) renderTree();
    else markActiveRow();
    findRow(path)?.scrollIntoView({ block: 'nearest' });
  }

  // ---- Quick open (Ctrl+P) ----

  function setupQuickOpen() {
    ui.quickInput.addEventListener('input', () => {
      quick.selected = 0;
      updateQuickResults();
    });
    ui.quickInput.addEventListener('keydown', (event) => {
      const count = quick.results.length;
      switch (event.key) {
        case 'ArrowDown':
          if (count) quick.selected = (quick.selected + 1) % count;
          break;
        case 'ArrowUp':
          if (count) quick.selected = (quick.selected - 1 + count) % count;
          break;
        case 'Enter':
          chooseQuickResult(quick.selected);
          break;
        case 'Escape':
          closeQuickOpen();
          break;
        default:
          return;
      }
      event.preventDefault();
      renderQuickResults();
    });
    // Keep focus in the input while clicking a result.
    ui.quickList.addEventListener('mousedown', (event) => event.preventDefault());
    ui.quickList.addEventListener('click', (event) => {
      const item = event.target.closest('li');
      if (item) chooseQuickResult(Number(item.dataset.index));
    });
    ui.quick.addEventListener('focusout', (event) => {
      if (!ui.quick.contains(event.relatedTarget)) closeQuickOpen(false);
    });
  }

  function openQuickOpen() {
    if (!rootDir || !editor) return;
    ui.quick.hidden = false;
    ui.quickInput.value = '';
    quick.selected = 0;
    updateQuickResults();
    ui.quickInput.focus();
    buildIndex();
  }

  function closeQuickOpen(refocus = true) {
    if (ui.quick.hidden) return;
    ui.quick.hidden = true;
    if (refocus) editor?.focus();
  }

  function chooseQuickResult(index) {
    const result = quick.results[index];
    if (!result) return;
    const { line } = parseQuery();
    closeQuickOpen();
    openFile(result.dir, result.file, { size: result.size, line });
  }

  function resetIndex() {
    quick.generation++;
    quick.files = [];
    quick.crawling = quick.done = quick.truncated = false;
    quick.promise = null;
  }

  // Resolves when the file list for the current root is complete (or was reset meanwhile).
  function buildIndex() {
    quick.promise ||= crawlIndex();
    return quick.promise;
  }

  // Breadth-first walk from the explorer's root, a few folders at a time.
  async function crawlIndex() {
    const generation = quick.generation;
    const root = rootDir;
    quick.crawling = true;
    let level = [root];
    let dirCount = 0;

    crawl: while (level.length) {
      const next = [];
      for (let i = 0; i < level.length; i += INDEX_CONCURRENCY) {
        const batch = level.slice(i, i + INDEX_CONCURRENCY);
        const listed = await Promise.all(batch.map((dir) =>
          listDir(dir).then((entries) => [dir, entries], () => [dir, []])));
        if (generation !== quick.generation) return;

        for (const [dir, entries] of listed) {
          const atHome = dir.match(HOME_PATTERN)?.[0] === dir;
          for (const entry of entries) {
            if (entry.type === 'dir') {
              if (!SKIP_DIRS.has(entry.name) && !(atHome && SKIP_HOME_DIRS.has(entry.name))) next.push(joinPath(dir, entry.name));
            } else if (!BINARY_EXTENSIONS.has(extensionOf(entry.name.toLowerCase()))) {
              quick.files.push({ dir, file: entry.name, size: entry.size, rel: relativePath(joinPath(dir, entry.name), root) });
            }
          }
        }
        dirCount += batch.length;
        scheduleQuickUpdate();
        if (quick.files.length >= INDEX_MAX_FILES || dirCount >= INDEX_MAX_DIRS) {
          quick.truncated = true;
          break crawl;
        }
      }
      level = next;
    }
    quick.crawling = false;
    quick.done = true;
    scheduleQuickUpdate();
  }

  function scheduleQuickUpdate() {
    if (ui.quick.hidden || quick.frame) return;
    quick.frame = requestAnimationFrame(() => {
      quick.frame = 0;
      updateQuickResults();
    });
  }

  // "index.php:42" opens index.php at line 42. Spaces are ignored, as in VS Code.
  function parseQuery() {
    const raw = ui.quickInput.value.replace(/\s+/g, '');
    const lineMatch = raw.match(/^(.*?):(\d+)$/);
    return lineMatch
      ? { text: lineMatch[1].toLowerCase(), line: Number(lineMatch[2]) }
      : { text: raw.toLowerCase(), line: 0 };
  }

  function updateQuickResults() {
    const { text } = parseQuery();
    if (!text) {
      // Nothing typed yet: offer the other open files, most recently used first.
      quick.results = tabs
        .filter((tab) => tab !== active)
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .map((tab) => ({ dir: tab.dir, file: tab.file, size: 0, rel: relativePath(tab.path, rootDir), name: [], where: [] }));
    } else {
      const scored = [];
      for (const item of quick.files) {
        const result = scoreFile(text, item);
        if (result) scored.push(result);
      }
      scored.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);
      quick.results = scored.slice(0, QUICK_MAX_RESULTS);
    }
    quick.selected = Math.min(quick.selected, Math.max(quick.results.length - 1, 0));
    renderQuickResults();

    const count = quick.files.length.toLocaleString();
    ui.quickStatus.textContent = quick.crawling
      ? `Indexing ${baseName(rootDir)}… ${count} files so far`
      : quick.truncated
        ? `Searched the first ${count} files. To search everything, browse to a smaller folder in the explorer.`
        : !text && !quick.results.length
          ? `Type to search ${count} files in ${baseName(rootDir)}.`
          : text && !quick.results.length ? 'No matching files.' : '';
  }

  function renderQuickResults() {
    ui.quickList.replaceChildren(...quick.results.map((result, index) => {
      const item = document.createElement('li');
      item.id = `quick-${index}`;
      item.dataset.index = index;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === quick.selected));
      const where = parentOf(result.rel) === '/' || !result.rel.includes('/') ? '' : parentOf(result.rel);
      item.append(
        fileIcon(result.file),
        highlight(result.file, result.name, 'q-name'),
        highlight(where, result.where, 'q-dir'),
      );
      return item;
    }));
    const selected = ui.quickList.children[quick.selected];
    ui.quickInput.setAttribute('aria-activedescendant', selected ? selected.id : '');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  // Matches against the file name first (ranked higher), then the whole relative path.
  function scoreFile(text, item) {
    const nameMatch = fuzzyMatch(text, item.file);
    if (nameMatch) return { ...item, score: nameMatch.score + 1000, name: nameMatch.positions, where: [] };
    if (!text.includes('/') && text.length < 2) return null;
    const pathMatch = fuzzyMatch(text, item.rel);
    if (!pathMatch) return null;
    const nameStart = item.rel.length - item.file.length;
    return {
      ...item,
      score: pathMatch.score,
      name: pathMatch.positions.filter((p) => p >= nameStart).map((p) => p - nameStart),
      where: pathMatch.positions.filter((p) => p < nameStart - 1),
    };
  }

  function fuzzyMatch(query, text) {
    const lower = text.toLowerCase();
    const isBoundary = (i) => i === 0 || '/._- '.includes(text[i - 1]);
    const at = lower.indexOf(query);
    if (at !== -1) {
      return {
        score: 200 + (isBoundary(at) ? 50 : 0) - at,
        positions: Array.from({ length: query.length }, (_, k) => at + k),
      };
    }
    const positions = [];
    let score = 0;
    let from = 0;
    for (let k = 0; k < query.length; k++) {
      const i = lower.indexOf(query[k], from);
      if (i === -1) return null;
      score += (positions.length && i === positions[positions.length - 1] + 1 ? 6 : 1) + (isBoundary(i) ? 4 : 0);
      positions.push(i);
      from = i + 1;
    }
    return { score, positions };
  }

  function highlight(text, positions, className) {
    const span = document.createElement('span');
    span.className = className;
    let last = 0;
    for (const p of positions) {
      if (p < last || p >= text.length) continue;
      if (p > last) span.append(text.slice(last, p));
      const mark = document.createElement('mark');
      mark.textContent = text[p];
      span.append(mark);
      last = p + 1;
    }
    span.append(text.slice(last));
    return span;
  }

  // ---- Local data: drafts and history (IndexedDB), open tabs (localStorage) ----

  // Lives in the extension's own origin, so nothing here leaves this browser.
  const db = (() => {
    let connection = null;
    const done = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    function open() {
      connection ||= new Promise((resolve, reject) => {
        const req = indexedDB.open('cpm', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('drafts', { keyPath: 'key' });
          req.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true }).createIndex('key', 'key');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return connection;
    }
    async function store(name, mode = 'readonly') {
      return (await open()).transaction(name, mode).objectStore(name);
    }
    return {
      getDraft: async (key) => done((await store('drafts')).get(key)),
      putDraft: async (draft) => done((await store('drafts', 'readwrite')).put(draft)),
      deleteDraft: async (key) => done((await store('drafts', 'readwrite')).delete(key)),
      history: async (key) => done((await store('history')).index('key').getAll(key)),
      addHistory: async (entry) => done((await store('history', 'readwrite')).add(entry)),
      deleteHistory: async (ids) => {
        const s = await store('history', 'readwrite');
        await Promise.all(ids.map((id) => done(s.delete(id))));
      },
      // Drops drafts and history older than `before` (a timestamp).
      prune: async (before) => {
        for (const name of ['drafts', 'history']) {
          const s = await store(name, 'readwrite');
          await new Promise((resolve, reject) => {
            const req = s.openCursor();
            req.onsuccess = () => {
              const cursor = req.result;
              if (!cursor) return resolve();
              if (cursor.value.savedAt < before) cursor.delete();
              cursor.continue();
            };
            req.onerror = () => reject(req.error);
          });
        }
      },
      clear: async () => {
        await done((await store('drafts', 'readwrite')).clear());
        await done((await store('history', 'readwrite')).clear());
      },
    };
  })();

  // Local data is a safety net; if storage is unavailable, editing carries on without it.
  function quiet(promise) {
    return promise.catch(() => null);
  }

  function fileKey(path) {
    return `${server}|${path}`;
  }

  // ---- Drafts ----

  function scheduleDraft(tab) {
    // Don't overwrite a recovered draft before the user has decided what to do with it.
    if (tab.draftOffer) return;
    clearTimeout(tab.draftTimer);
    tab.draftTimer = setTimeout(() => writeDraft(tab), DRAFT_DELAY);
  }

  function writeDraft(tab) {
    tab.draftTimer = 0;
    if (tab.model.isDisposed() || tab.draftOffer) return;
    const key = fileKey(tab.path);
    if (!isDirty(tab)) {
      quiet(db.deleteDraft(key));
      return;
    }
    const content = tab.model.getValue();
    if (content.length > LARGE_FILE) return;
    quiet(db.putDraft({ key, content, baseHash: hash(tab.base), savedAt: Date.now() }));
  }

  function flushDrafts() {
    for (const tab of tabs) {
      if (!tab.draftTimer) continue;
      clearTimeout(tab.draftTimer);
      writeDraft(tab);
    }
  }

  async function checkDraft(tab) {
    const draft = await quiet(db.getDraft(fileKey(tab.path)));
    if (!draft || tab.model.isDisposed() || !tabs.includes(tab)) return;
    if (draft.content === tab.base) {
      quiet(db.deleteDraft(draft.key));
      return;
    }
    tab.draftOffer = draft;
    const serverChanged = draft.baseHash !== hash(tab.base);
    setNotice(tab, {
      kind: 'draft',
      text: `Unsaved changes to ${tab.file} from ${timeAgo(draft.savedAt)} were recovered.`
        + (serverChanged ? ' The file has also changed on the server since then, so compare before restoring.' : ''),
      actions: [
        { label: 'Restore', primary: true, run: () => restoreDraft(tab) },
        { label: 'Compare', run: () => compareDraft(tab) },
        { label: 'Discard', run: () => discardDraft(tab) },
      ],
    });
    renderTabs();
  }

  function restoreDraft(tab) {
    const draft = tab.draftOffer;
    if (!draft) return;
    tab.draftOffer = null;
    setNotice(tab, null);
    if (tab !== active) activate(tab);
    closeDiff(false);
    replaceContent(tab, draft.content);
    setMessage(`Restored your unsaved changes to ${tab.file}. Save to write them to the server.`, 'ok');
    editor.focus();
  }

  function discardDraft(tab) {
    if (!tab.draftOffer) return;
    tab.draftOffer = null;
    setNotice(tab, null);
    closeDiff();
    quiet(db.deleteDraft(fileKey(tab.path)));
    if (isDirty(tab)) scheduleDraft(tab);
    renderTabs();
  }

  function compareDraft(tab) {
    if (!tab.draftOffer) return;
    if (tab !== active) activate(tab);
    openDiff({
      title: `Recovered changes: ${tab.file}`,
      legend: 'Left: on the server · Right: your unsaved changes',
      original: tab.base,
      modified: tab.draftOffer.content,
      readOnly: true,
      actions: [
        { label: 'Restore', primary: true, run: () => restoreDraft(tab) },
        { label: 'Discard', run: () => discardDraft(tab) },
        { label: 'Close', run: () => closeDiff() },
      ],
    });
  }

  // Replaces a tab's whole text as a single step that Undo can take back.
  function replaceContent(tab, text) {
    tab.model.pushStackElement();
    tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text }], () => null);
    tab.model.pushStackElement();
  }

  // ---- Notices (a bar above the editor, per tab) ----

  function setNotice(tab, notice) {
    tab.notice = notice;
    if (tab === active) renderNotice();
  }

  function renderNotice() {
    const notice = active?.notice;
    ui.notice.hidden = !notice;
    if (!notice) return;
    ui.noticeText.textContent = notice.text;
    ui.noticeActions.replaceChildren(...notice.actions.map(actionButton));
  }

  function actionButton({ label, primary, danger, run }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (primary) button.classList.add('primary');
    if (danger) button.classList.add('danger');
    button.addEventListener('click', run);
    return button;
  }

  // ---- Diff view: review, conflicts, drafts and history all use it ----

  // `original` is text; `modified` is either text (shown read-only) or a tab's live model.
  function openDiff({ title, legend, original, modified, readOnly = false, actions }) {
    closeDiff(false);
    const language = active?.model.getLanguageId() || 'plaintext';
    if (!diff.editor) {
      diff.editor = monaco.editor.createDiffEditor(ui.diffEditor, {
        automaticLayout: true,
        originalEditable: false,
        fontFamily: CODE_FONT,
        fontSize: 14,
        scrollBeyondLastLine: false,
        ignoreTrimWhitespace: false,
        renderMarginRevertIcon: false,
        fixedOverflowWidgets: true,
      });
    }
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = typeof modified === 'string' ? monaco.editor.createModel(modified, language) : modified;
    diff.temp = typeof modified === 'string' ? [originalModel, modifiedModel] : [originalModel];
    ui.diff.hidden = false;
    diff.editor.setModel({ original: originalModel, modified: modifiedModel });
    diff.editor.getModifiedEditor().updateOptions({ readOnly, wordWrap: prefs.wrap ? 'on' : 'off' });
    diff.editor.getOriginalEditor().updateOptions({ wordWrap: prefs.wrap ? 'on' : 'off' });
    ui.diffTitle.textContent = title;
    ui.diffLegend.textContent = legend;
    ui.diffActions.replaceChildren(...actions.map(actionButton));
    diff.editor.getModifiedEditor().focus();
  }

  function closeDiff(refocus = true) {
    if (ui.diff.hidden) return;
    ui.diff.hidden = true;
    diff.editor.setModel(null);
    for (const model of diff.temp) model.dispose();
    diff.temp = [];
    if (refocus) editor?.focus();
  }

  async function review() {
    const tab = active;
    if (!tab) return;
    setMessage(`Getting the server's copy of ${tab.file}…`);
    let current;
    try {
      ({ content: current } = await request({ op: 'read', dir: tab.dir, file: tab.file, charset: tab.charset }));
    } catch (err) {
      setMessage(`Couldn't get ${tab.file} from the server: ${err.message}`, 'error');
      return;
    }
    if (tab !== active) return;
    if (current === tab.model.getValue()) {
      setMessage(`No differences: ${tab.file} matches the server.`, 'ok');
      return;
    }
    setMessage('');
    openDiff({
      title: `Review changes: ${tab.file}`,
      legend: 'Left: on the server · Right: your version (editable)',
      original: current,
      modified: tab.model,
      actions: [
        { label: 'Save', primary: true, run: async () => { if (await save()) closeDiff(); } },
        { label: 'Close', run: () => closeDiff() },
      ],
    });
  }

  function showConflict(tab, current) {
    setMessage(`Not saved: ${tab.file} was changed on the server after you opened it.`, 'error');
    openDiff({
      title: `${tab.file} changed on the server`,
      legend: 'Left: current server version · Right: your version (editable)',
      original: current,
      modified: tab.model,
      actions: [
        { label: 'Overwrite server version', danger: true, run: async () => { if (await save({ force: true })) closeDiff(); } },
        {
          label: 'Use server version',
          run: () => {
            closeDiff();
            replaceContent(tab, current);
            tab.base = current;
            tab.savedVersion = tab.model.getAlternativeVersionId();
            refreshDirty();
            setMessage(`Loaded the server's version of ${tab.file}. Undo (Ctrl+Z) brings your changes back.`, 'ok');
          },
        },
        { label: 'Cancel', run: () => closeDiff() },
      ],
    });
  }

  // ---- History ----

  async function recordHistory(tab, before, after) {
    if (after.length > HISTORY_MAX_SIZE) return;
    const key = fileKey(tab.path);
    try {
      // The first save also keeps what was on the server before, unless history already has it.
      if (!tab.historyStarted && before !== after && before.length <= HISTORY_MAX_SIZE) {
        const latest = (await db.history(key)).sort((a, b) => b.savedAt - a.savedAt)[0];
        if (latest?.content !== before) await db.addHistory({ key, content: before, savedAt: tab.openedAt, kind: 'opened' });
      }
      tab.historyStarted = true;
      await db.addHistory({ key, content: after, savedAt: Date.now(), kind: 'saved' });
      const all = (await db.history(key)).sort((a, b) => b.savedAt - a.savedAt);
      if (all.length > HISTORY_MAX) await db.deleteHistory(all.slice(HISTORY_MAX).map((entry) => entry.id));
    } catch {
      // History is best-effort.
    }
  }

  function setupHistory() {
    ui.historyClose.addEventListener('click', () => ui.historyDialog.close());
    ui.historyDialog.addEventListener('click', (event) => {
      if (event.target === ui.historyDialog) ui.historyDialog.close();
    });
    ui.historyClear.addEventListener('click', async () => {
      const tab = active;
      if (!tab) return;
      const entries = (await quiet(db.history(fileKey(tab.path)))) || [];
      await quiet(db.deleteHistory(entries.map((entry) => entry.id)));
      ui.historyDialog.close();
      setMessage(`Cleared the history of ${tab.file}.`, 'ok');
    });
    ui.clearLocal.addEventListener('click', async () => {
      ui.trustDialog.close();
      const ok = await ask({
        title: 'Delete all drafts and history?',
        text: 'This removes every unsaved draft and earlier version kept by the extension in this browser, for all servers. Files on your servers are not affected.',
        confirm: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await quiet(db.clear());
      try {
        localStorage.removeItem('cpm-sessions');
      } catch {
        // Nothing stored.
      }
      for (const tab of tabs) {
        tab.draftOffer = null;
        if (tab.notice?.kind === 'draft') setNotice(tab, null);
      }
      setMessage('Deleted all drafts and history kept in this browser.', 'ok');
    });
  }

  async function openHistory() {
    const tab = active;
    if (!tab) return;
    const entries = ((await quiet(db.history(fileKey(tab.path)))) || []).sort((a, b) => b.savedAt - a.savedAt);
    if (tab !== active) return;
    ui.historyTitle.textContent = `History: ${tab.file}`;
    ui.historyClear.hidden = !entries.length;
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No earlier versions yet. Each time you save this file, a copy is kept here.';
      ui.historyList.replaceChildren(empty);
    } else {
      ui.historyList.replaceChildren(...entries.map((entry) => {
        const item = document.createElement('li');
        const meta = document.createElement('div');
        const what = document.createElement('strong');
        what.textContent = entry.kind === 'opened' ? 'Before your edits' : 'Saved';
        const when = document.createElement('span');
        when.textContent = `${formatDate(entry.savedAt)} · ${timeAgo(entry.savedAt)} · ${lineCount(entry.content)}`;
        meta.append(what, when);
        item.append(
          meta,
          actionButton({ label: 'Compare', run: () => compareVersion(tab, entry) }),
          actionButton({ label: 'Restore', run: () => restoreVersion(tab, entry) }),
        );
        return item;
      }));
    }
    ui.historyDialog.showModal();
  }

  function compareVersion(tab, entry) {
    ui.historyDialog.close();
    if (tab !== active) activate(tab);
    openDiff({
      title: `${tab.file}: version from ${formatDate(entry.savedAt)}`,
      legend: 'Left: earlier version · Right: your current version (editable)',
      original: entry.content,
      modified: tab.model,
      actions: [
        { label: 'Restore this version', primary: true, run: () => restoreVersion(tab, entry) },
        { label: 'Close', run: () => closeDiff() },
      ],
    });
  }

  function restoreVersion(tab, entry) {
    ui.historyDialog.close();
    if (tab !== active) activate(tab);
    closeDiff(false);
    replaceContent(tab, entry.content);
    setMessage(`Restored the version from ${formatDate(entry.savedAt)}. Save to write it to the server, or Undo (Ctrl+Z) to go back.`, 'ok');
    editor.focus();
  }

  // ---- Open tabs, remembered per server ----

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem('cpm-sessions') || '{}')[sessionKey]?.tabs;
      return Array.isArray(saved) ? saved.filter((path) => typeof path === 'string') : [];
    } catch {
      return [];
    }
  }

  function saveSession() {
    if (!sessionKey) return;
    try {
      const all = JSON.parse(localStorage.getItem('cpm-sessions') || '{}');
      all[sessionKey] = { tabs: tabs.map((tab) => tab.path), savedAt: Date.now() };
      // Only the 20 most recently used servers/accounts are kept.
      const keys = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
      for (const key of keys.slice(20)) delete all[key];
      localStorage.setItem('cpm-sessions', JSON.stringify(all));
    } catch {
      // Remembering tabs is a convenience.
    }
  }

  // Reopens last time's tabs around the file that was just opened, in their old order.
  async function restoreSession(saved, current) {
    const paths = saved.filter((path) => path !== current.path).slice(0, SESSION_MAX_TABS);
    if (!paths.length) return;
    const loaded = await Promise.all(paths.map((path) => {
      const dir = parentOf(path);
      const file = baseName(path);
      return request({ op: 'read', dir, file }).then(({ content, charset }) => ({ dir, file, content, charset }), () => null);
    }));
    for (const data of loaded) {
      if (data && !tabs.some((tab) => tab.path === joinPath(data.dir, data.file))) addTab(data, true);
    }
    const rank = (tab) => {
      const index = saved.indexOf(tab.path);
      return index === -1 ? Infinity : index;
    };
    tabs.sort((a, b) => rank(a) - rank(b));
    renderTabs();
    saveSession();
  }

  // ---- File operations ----

  function setupFileOps() {
    ui.newFile.addEventListener('click', () => createEntry('file', targetDir()));
    ui.newFolder.addEventListener('click', () => createEntry('dir', targetDir()));
    ui.tree.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const row = event.target.closest('.row');
      row?.focus();
      showMenu(event.clientX, event.clientY, menuItems(row));
    });
    ui.menu.addEventListener('keydown', (event) => {
      const items = [...ui.menu.querySelectorAll('button')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') items[(index + 1) % items.length].focus();
      else if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length].focus();
      else if (event.key === 'Escape' || event.key === 'Tab') hideMenu(true);
      else return;
      event.preventDefault();
    });
    document.addEventListener('mousedown', (event) => {
      if (!ui.menu.hidden && !ui.menu.contains(event.target)) hideMenu();
    }, true);
    window.addEventListener('blur', () => hideMenu());
  }

  // New files and folders go into the folder last selected in the explorer.
  function targetDir() {
    if (lastTreeRow && findRow(lastTreeRow.path)) {
      return lastTreeRow.type === 'dir' ? lastTreeRow.path : lastTreeRow.dir;
    }
    return rootDir;
  }

  function menuItems(row) {
    if (!row) {
      return [
        { label: 'New file…', run: () => createEntry('file', rootDir) },
        { label: 'New folder…', run: () => createEntry('dir', rootDir) },
        '-',
        { label: 'Refresh', run: refreshTree },
      ];
    }
    const { path, type, dir, name, size } = row.dataset;
    const inside = type === 'dir' ? path : dir;
    return [
      ...(type === 'file' ? [{ label: 'Open', run: () => openFile(dir, name, { size: Number(size) }) }, '-'] : []),
      { label: 'New file…', run: () => createEntry('file', inside) },
      { label: 'New folder…', run: () => createEntry('dir', inside) },
      '-',
      { label: 'Rename…', hint: 'F2', run: () => renameEntry(path, type) },
      { label: 'Move to trash', hint: 'Del', danger: true, run: () => trashEntry(path, type) },
      '-',
      { label: 'Copy path', run: () => copyText(path) },
    ];
  }

  function showRowMenu(row) {
    const rect = row.getBoundingClientRect();
    showMenu(rect.left + 24, rect.bottom, menuItems(row));
  }

  function showMenu(x, y, items) {
    ui.menu.returnFocus = document.activeElement;
    ui.menu.replaceChildren(...items.map((item) => {
      if (item === '-') {
        const separator = document.createElement('div');
        separator.className = 'menu-sep';
        separator.setAttribute('role', 'separator');
        return separator;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'menuitem');
      if (item.danger) button.className = 'danger';
      const label = document.createElement('span');
      label.textContent = item.label;
      button.append(label);
      if (item.hint) {
        const hint = document.createElement('kbd');
        hint.textContent = item.hint;
        button.append(hint);
      }
      button.addEventListener('click', () => {
        hideMenu();
        item.run();
      });
      return button;
    }));
    ui.menu.hidden = false;
    const { width, height } = ui.menu.getBoundingClientRect();
    ui.menu.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 4))}px`;
    ui.menu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 4))}px`;
    ui.menu.querySelector('button')?.focus();
  }

  function hideMenu(refocus = false) {
    if (ui.menu.hidden) return;
    ui.menu.hidden = true;
    if (refocus) ui.menu.returnFocus?.focus?.();
  }

  function validateName(name, dir) {
    if (!name) return 'Enter a name.';
    if (name.includes('/')) return 'Names can’t contain “/”.';
    if (name === '.' || name === '..') return 'That name isn’t allowed.';
    if (listings.get(dir)?.entries.some((entry) => entry.name === name)) return `“${name}” already exists here.`;
    return '';
  }

  async function createEntry(type, dir) {
    if (!dir) return;
    const isDir = type === 'dir';
    // Load the folder first so the prompt can flag names that are already taken.
    await listDir(dir).catch(() => {});
    const name = await ask({
      title: isDir ? 'New folder' : 'New file',
      text: `In ${dir}`,
      value: '',
      confirm: 'Create',
      validate: (value) => validateName(value, dir),
    });
    if (!name) return;
    try {
      await request({ op: isDir ? 'mkdir' : 'mkfile', dir, file: name });
    } catch (err) {
      setMessage(`Couldn't create ${name}: ${err.message}`, 'error');
      return;
    }
    if (dir !== rootDir) expanded.add(dir);
    refreshDir(dir);
    if (isDir) setMessage(`Created the folder ${name}.`, 'ok');
    else openFile(dir, name);
  }

  async function renameEntry(path, type) {
    const dir = parentOf(path);
    const old = baseName(path);
    const dot = old.lastIndexOf('.');
    await listDir(dir).catch(() => {});
    const name = await ask({
      title: `Rename ${type === 'dir' ? 'folder' : 'file'}`,
      text: `In ${dir}`,
      value: old,
      // Select the name without its extension, as VS Code does.
      select: type === 'file' && dot > 0 ? [0, dot] : null,
      confirm: 'Rename',
      validate: (value) => (value === old ? '' : validateName(value, dir)),
    });
    if (!name || name === old) return;
    try {
      await request({ op: 'rename', dir, file: old, newName: name });
    } catch (err) {
      setMessage(`Couldn't rename ${old}: ${err.message}`, 'error');
      return;
    }
    const target = joinPath(dir, name);
    const moved = (p) => p === path || isInside(p, path);
    const movedPath = (p) => target + p.slice(path.length);
    for (const tab of tabs.filter((t) => moved(t.path))) {
      // Drafts follow the file to its new name.
      quiet(db.deleteDraft(fileKey(tab.path)));
      tab.path = movedPath(tab.path);
      tab.dir = parentOf(tab.path);
      tab.file = baseName(tab.path);
      if (type === 'file') monaco.editor.setModelLanguage(tab.model, guessLanguage(tab.file));
      if (isDirty(tab)) scheduleDraft(tab);
    }
    for (const p of [...expanded].filter(moved)) {
      expanded.delete(p);
      expanded.add(movedPath(p));
    }
    for (const p of [...listings.keys()].filter(moved)) listings.delete(p);
    if (lastTreeRow && moved(lastTreeRow.path)) lastTreeRow = null;
    dropSearchCache(path);
    refreshDir(dir);
    updateChrome();
    saveSession();
    setMessage(`Renamed ${old} to ${name}.`, 'ok');
  }

  async function trashEntry(path, type) {
    const name = baseName(path);
    const ok = await ask({
      title: `Move ${name} to the trash?`,
      text: `${type === 'dir' ? 'The folder and everything in it go' : 'It goes'} to your cPanel trash. You can restore it from File Manager with View Trash.`,
      confirm: 'Move to trash',
      danger: true,
    });
    if (!ok) return;
    try {
      await request({ op: 'trash', dir: parentOf(path), file: name });
    } catch (err) {
      setMessage(`Couldn't move ${name} to the trash: ${err.message}`, 'error');
      return;
    }
    const removed = (p) => p === path || isInside(p, path);
    for (const tab of tabs.filter((t) => removed(t.path))) {
      // Keep tabs with unsaved work open: saving would put the file back.
      if (isDirty(tab)) setNotice(tab, { kind: 'trashed', text: `${tab.file} was moved to the trash. Saving creates it again.`, actions: [] });
      else closeTab(tab);
    }
    for (const p of [...expanded].filter(removed)) expanded.delete(p);
    for (const p of [...listings.keys()].filter(removed)) listings.delete(p);
    if (lastTreeRow && removed(lastTreeRow.path)) lastTreeRow = null;
    dropSearchCache(path);
    refreshDir(parentOf(path));
    setMessage(`Moved ${name} to the trash.`, 'ok');
  }

  function refreshDir(dir) {
    listings.delete(dir);
    resetIndex();
    renderTree();
  }

  function refreshTree() {
    if (!rootDir) return;
    listings.clear();
    resetIndex();
    search.cache.clear();
    search.cacheChars = 0;
    renderTree();
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(
      () => setMessage('Path copied.', 'ok'),
      () => setMessage('Couldn’t copy to the clipboard.', 'error'),
    );
  }

  // A small modal for confirmations and name prompts. Resolves to the entered text,
  // true (confirmed, no input) or null (cancelled).
  function ask({ title, text = '', value = null, select = null, confirm = 'OK', danger = false, validate = () => '' }) {
    return new Promise((resolve) => {
      let result = null;
      const hasInput = value !== null;
      ui.askTitle.textContent = title;
      ui.askText.textContent = text;
      ui.askText.hidden = !text;
      ui.askInput.hidden = !hasInput;
      ui.askInput.value = value ?? '';
      ui.askError.textContent = '';

      const ok = document.createElement('button');
      ok.type = 'submit';
      ok.className = danger ? 'primary danger' : 'primary';
      ok.textContent = confirm;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => ui.ask.close());
      ui.askButtons.replaceChildren(cancel, ok);

      const onSubmit = (event) => {
        event.preventDefault();
        const input = ui.askInput.value.trim();
        if (hasInput) {
          const error = validate(input);
          if (error) {
            ui.askError.textContent = error;
            ui.askInput.focus();
            return;
          }
        }
        result = hasInput ? input : true;
        ui.ask.close();
      };
      const onInput = () => {
        ui.askError.textContent = '';
      };
      ui.askForm.addEventListener('submit', onSubmit);
      ui.askInput.addEventListener('input', onInput);
      ui.ask.addEventListener('close', () => {
        ui.askForm.removeEventListener('submit', onSubmit);
        ui.askInput.removeEventListener('input', onInput);
        resolve(result);
      }, { once: true });

      ui.ask.showModal();
      if (hasInput) {
        ui.askInput.focus();
        if (select) ui.askInput.setSelectionRange(...select);
        else ui.askInput.select();
      } else {
        ok.focus();
      }
    });
  }

  // ---- Find in files (Ctrl+Shift+F) ----

  function setupSearch() {
    ui.viewFiles.addEventListener('click', () => showView('files'));
    ui.viewSearch.addEventListener('click', () => {
      showView('search');
      ui.searchInput.focus();
    });
    for (const toggle of [ui.searchCase, ui.searchWord, ui.searchRegex]) {
      toggle.addEventListener('click', () => {
        toggle.setAttribute('aria-pressed', String(!isPressed(toggle)));
        runSearch();
      });
    }
    for (const input of [ui.searchInput, ui.searchInclude]) {
      input.addEventListener('input', () => {
        clearTimeout(search.timer);
        search.timer = setTimeout(runSearch, 400);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        runSearch();
      });
    }
    ui.searchResults.addEventListener('click', (event) => {
      const line = event.target.closest('.sr-line');
      if (line) {
        const { group, match } = search.matchList[Number(line.dataset.index)];
        openFile(group.dir, group.file, { line: match.line, column: match.column, length: match.length });
        return;
      }
      const head = event.target.closest('.sr-file');
      if (!head) return;
      const { path } = head.dataset;
      if (search.collapsed.has(path)) search.collapsed.delete(path);
      else search.collapsed.add(path);
      renderSearchResults();
      ui.searchResults.querySelector(`.sr-file[data-path="${CSS.escape(path)}"]`)?.focus();
    });
  }

  function showView(view) {
    const isSearch = view === 'search';
    ui.filesView.hidden = isSearch;
    ui.searchView.hidden = !isSearch;
    ui.viewFiles.setAttribute('aria-selected', String(!isSearch));
    ui.viewSearch.setAttribute('aria-selected', String(isSearch));
  }

  function openSearch() {
    if (!prefs.sidebar) toggleSidebar();
    showView('search');
    // Start from the selected text, as VS Code does.
    const selection = active && editor.getSelection();
    if (selection && !selection.isEmpty() && selection.startLineNumber === selection.endLineNumber) {
      ui.searchInput.value = active.model.getValueInRange(selection);
      runSearch();
    }
    ui.searchInput.focus();
    ui.searchInput.select();
  }

  function isPressed(button) {
    return button.getAttribute('aria-pressed') === 'true';
  }

  function buildMatcher() {
    const text = ui.searchInput.value;
    if (!text) return null;
    let source = isPressed(ui.searchRegex) ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (isPressed(ui.searchWord)) source = `\\b(?:${source})\\b`;
    return new RegExp(source, isPressed(ui.searchCase) ? 'g' : 'gi');
  }

  // "*.php, wp-content/themes": globs match the path's end, plain text matches anywhere in it.
  function includeFilter() {
    const patterns = ui.searchInclude.value.split(',').map((p) => p.trim()).filter(Boolean);
    if (!patterns.length) return () => true;
    const tests = patterns.map((pattern) => {
      if (/[*?]/.test(pattern)) {
        const source = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*\/?/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')
          .replace(/\u0000/g, '(?:.*/)?');
        const re = new RegExp(`(^|/)${source}$`, 'i');
        return (rel) => re.test(rel);
      }
      const needle = pattern.replace(/^\.?\//, '').toLowerCase();
      return (rel) => rel.toLowerCase().includes(needle);
    });
    return (rel) => tests.some((test) => test(rel));
  }

  async function runSearch() {
    clearTimeout(search.timer);
    const generation = ++search.generation;
    search.groups = [];
    search.total = 0;
    let matcher;
    try {
      matcher = buildMatcher();
    } catch (err) {
      renderSearchResults();
      setSearchStatus(`That regular expression isn’t valid: ${err.message}`, true);
      return;
    }
    renderSearchResults();
    if (!matcher || !rootDir) {
      setSearchStatus('');
      return;
    }

    setSearchStatus(`Listing files in ${baseName(rootDir)}…`);
    await buildIndex();
    if (generation !== search.generation) return;
    const include = includeFilter();
    const candidates = quick.files.filter((item) =>
      item.size <= SEARCH_MAX_FILE_SIZE && !/\.(min\.(js|css)|map)$/i.test(item.file) && include(item.rel));
    const files = candidates.slice(0, SEARCH_MAX_FILES);
    const queue = files.slice();
    let searched = 0;
    let failed = 0;
    let full = false;

    const worker = async () => {
      while (queue.length && !full) {
        const item = queue.shift();
        let text = null;
        try {
          text = await fileText(item);
        } catch {
          failed++;
        }
        if (generation !== search.generation) return;
        searched++;
        if (text !== null && scanText(item, text, matcher)) full = true;
        setSearchStatus(`Searching… ${searched.toLocaleString()} of ${files.length.toLocaleString()} files`);
        scheduleSearchRender();
      }
    };
    await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker));
    if (generation !== search.generation) return;

    renderSearchResults();
    const notes = [];
    if (full) notes.push(`Stopped at ${SEARCH_MAX_RESULTS.toLocaleString()} results.`);
    if (candidates.length > files.length) notes.push(`Only the first ${SEARCH_MAX_FILES.toLocaleString()} files were searched; narrow it with “Files to include”.`);
    if (quick.truncated) notes.push('The folder is too big to list completely; browse to a smaller one in the explorer.');
    if (failed) notes.push(`${failed} file${failed === 1 ? '' : 's'} couldn’t be read.`);
    const fileCount = search.groups.length;
    const summary = search.total
      ? `${search.total.toLocaleString()} result${search.total === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}.`
      : `No results in ${searched.toLocaleString()} files.`;
    setSearchStatus([summary, ...notes].join(' '));
  }

  // Open tabs are searched as edited; other files are downloaded once and kept in memory.
  async function fileText(item) {
    const path = joinPath(item.dir, item.file);
    const tab = tabs.find((t) => t.path === path);
    if (tab) return tab.model.getValue();
    if (search.cache.has(path)) return search.cache.get(path);
    const { content } = await request({ op: 'read', dir: item.dir, file: item.file });
    if (search.cacheChars + content.length <= SEARCH_CACHE_CHARS) {
      search.cache.set(path, content);
      search.cacheChars += content.length;
    }
    return content;
  }

  function updateSearchCache(path, content) {
    if (!search.cache.has(path)) return;
    search.cacheChars += content.length - search.cache.get(path).length;
    search.cache.set(path, content);
  }

  function dropSearchCache(path) {
    for (const [p, content] of search.cache) {
      if (p !== path && !isInside(p, path)) continue;
      search.cache.delete(p);
      search.cacheChars -= content.length;
    }
  }

  // Returns true once the overall result limit is reached.
  function scanText(item, text, matcher) {
    matcher.lastIndex = 0;
    if (!matcher.test(text)) return false;
    let group = null;
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      matcher.lastIndex = 0;
      let match;
      while ((match = matcher.exec(line))) {
        if (!match[0].length) {
          matcher.lastIndex++;
          continue;
        }
        if (!group) {
          group = { dir: item.dir, file: item.file, rel: item.rel, path: joinPath(item.dir, item.file), matches: [] };
          search.groups.push(group);
        }
        if (group.matches.length >= SEARCH_MAX_PER_FILE) break;
        group.matches.push({ line: i + 1, column: match.index + 1, length: match[0].length, text: line });
        if (++search.total >= SEARCH_MAX_RESULTS) return true;
      }
    }
    return false;
  }

  function setSearchStatus(text, isError = false) {
    ui.searchStatus.textContent = text;
    ui.searchStatus.classList.toggle('error', isError);
  }

  function scheduleSearchRender() {
    if (search.renderTimer) return;
    search.renderTimer = setTimeout(() => {
      search.renderTimer = 0;
      renderSearchResults();
    }, 150);
  }

  function renderSearchResults() {
    const rows = document.createDocumentFragment();
    search.matchList = [];
    for (const group of search.groups) {
      const collapsed = search.collapsed.has(group.path);
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'sr-file';
      head.dataset.path = group.path;
      head.title = group.path;
      head.setAttribute('aria-expanded', String(!collapsed));
      const name = document.createElement('span');
      name.className = 'sr-name';
      name.textContent = group.file;
      const where = document.createElement('span');
      where.className = 'sr-dir';
      where.textContent = group.rel.includes('/') ? parentOf(group.rel) : '';
      const count = document.createElement('span');
      count.className = 'sr-count';
      count.textContent = group.matches.length;
      head.append(icon('i-chevron', 'chevron'), fileIcon(group.file), name, where, count);
      rows.append(head);
      if (collapsed) continue;

      for (const match of group.matches) {
        const index = search.matchList.push({ group, match }) - 1;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'sr-line';
        row.dataset.index = index;
        row.title = `Line ${match.line}`;
        // Show a little context before the match and more after it.
        const startAt = match.column - 1;
        const from = Math.max(0, startAt - 30);
        const before = (from ? '…' : '') + match.text.slice(from, startAt).trimStart();
        const mark = document.createElement('mark');
        mark.textContent = match.text.substr(startAt, match.length);
        row.append(before, mark, match.text.slice(startAt + match.length, startAt + match.length + 120));
        rows.append(row);
      }
    }
    ui.searchResults.replaceChildren(rows);
  }

  // ---- Helpers ----

  function joinPath(dir, name) {
    return `${dir.replace(/\/+$/, '')}/${name}`;
  }

  function parentOf(path) {
    return path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
  }

  function baseName(path) {
    return path.replace(/\/+$/, '').split('/').pop() || '/';
  }

  // True when `path` is strictly inside `dir`.
  function isInside(path, dir) {
    return path !== dir && path.startsWith(dir === '/' ? '/' : `${dir}/`);
  }

  function relativePath(path, dir) {
    return dir && isInside(path, dir) ? path.slice(dir === '/' ? 1 : dir.length + 1) : path;
  }

  function extensionOf(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1);
  }

  function timeAgo(time) {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  function formatDate(time) {
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function lineCount(text) {
    const count = text ? text.split('\n').length : 0;
    return `${count.toLocaleString()} line${count === 1 ? '' : 's'}`;
  }

  // A short fingerprint (FNV-1a plus length) to tell whether a draft's server text has changed.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `${(h >>> 0).toString(36)}:${text.length}`;
  }

  function formatSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  // VS Code's matching order: exact file name, then the longest known extension
  // ("blade.php" before "php"), then the language the editor detected.
  function fileIconFile(name) {
    const lower = name.toLowerCase();
    const light = document.documentElement.dataset.mode === 'light' ? FILE_ICONS.light : null;
    const pick = (table, key) => light?.[table]?.[key] || FILE_ICONS[table]?.[key];
    let file = pick('fileNames', lower);
    const parts = lower.split('.');
    for (let i = 1; !file && i < parts.length; i++) file = pick('fileExtensions', parts.slice(i).join('.'));
    if (!file && window.monaco) {
      const language = guessLanguage(name);
      file = pick('languageIds', language === 'shell' ? 'shellscript' : language);
    }
    return file || FILE_ICONS.file;
  }

  function folderIconFile(name, open) {
    const lower = name.toLowerCase();
    const table = open ? 'folderNamesExpanded' : 'folderNames';
    const light = document.documentElement.dataset.mode === 'light' ? FILE_ICONS.light : null;
    return light?.[table]?.[lower] || FILE_ICONS[table]?.[lower] || (open ? FILE_ICONS.folderExpanded : FILE_ICONS.folder);
  }

  function iconImage(key, resolve) {
    const cacheKey = `${document.documentElement.dataset.mode}|${key}`;
    let file = iconCache.get(cacheKey);
    if (!file) {
      file = resolve();
      iconCache.set(cacheKey, file);
    }
    const img = document.createElement('img');
    img.className = 'file-icon';
    img.src = `monaco/file-icons/${file}`;
    img.alt = '';
    img.width = 16;
    img.height = 16;
    img.draggable = false;
    return img;
  }

  function fileIcon(name) {
    if (!FILE_ICONS) return icon('i-file', 'kind');
    return iconImage(`f|${name}`, () => fileIconFile(name));
  }

  function folderIcon(name, open) {
    if (!FILE_ICONS) return icon('i-folder', 'kind');
    return iconImage(`d|${open ? 1 : 0}|${name}`, () => folderIconFile(name, open));
  }

  function icon(id, className = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `icon ${className}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  // ---- Theme ----

  function setupThemePicker() {
    ui.theme.add(new Option('Match system', 'system'));
    for (const mode of ['light', 'dark']) {
      const group = document.createElement('optgroup');
      group.label = mode === 'light' ? 'Light' : 'Dark';
      for (const theme of THEMES.filter((t) => t.mode === mode)) group.append(new Option(theme.label, theme.id));
      ui.theme.append(group);
    }
    if (prefs.theme !== 'system' && !THEMES.some((t) => t.id === prefs.theme)) prefs.theme = 'system';
    ui.theme.value = prefs.theme;
    ui.theme.addEventListener('change', () => {
      prefs.theme = ui.theme.value;
      savePrefs();
      applyTheme();
      editor?.focus();
    });
  }

  function resolveTheme() {
    const id = prefs.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : prefs.theme;
    return THEMES.find((t) => t.id === id) || THEMES[0];
  }

  function monacoThemeId(theme) {
    return theme.palette ? `cpm-${theme.id}` : theme.monaco;
  }

  function applyTheme() {
    const theme = resolveTheme();
    const colors = { bg: theme.palette?.bg, text: theme.palette?.fg, ...theme.ui };
    const root = document.documentElement;
    const modeChanged = root.dataset.mode !== theme.mode;
    root.dataset.mode = theme.mode;
    if (modeChanged && rootDir) {
      renderTree();
      renderTabs();
      renderSearchResults();
    }
    for (const [name, value] of Object.entries(colors)) {
      root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
    }
    if (editor) monaco.editor.setTheme(monacoThemeId(theme));
  }

  function buildMonacoTheme(theme) {
    const p = theme.palette;
    const rule = (token, color, fontStyle) => ({ token, foreground: color.slice(1), ...(fontStyle && { fontStyle }) });
    return {
      base: theme.mode === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        rule('', p.fg),
        rule('identifier', p.fg),
        rule('comment', p.comment, 'italic'),
        rule('keyword', p.keyword),
        rule('keyword.json', p.constant),
        rule('metatag', p.keyword),
        rule('string', p.string),
        rule('string.key.json', p.attr),
        rule('attribute.value', p.string),
        rule('number', p.number),
        rule('constant', p.constant),
        rule('type', p.type),
        rule('variable', p.variable),
        rule('tag', p.tag),
        rule('attribute.name', p.attr),
        rule('regexp', p.regexp),
        rule('delimiter', p.delimiter),
      ],
      colors: {
        'editor.background': p.bg,
        'editor.foreground': p.fg,
        'editorCursor.foreground': p.cursor || p.fg,
        'editor.lineHighlightBackground': p.lineHighlight,
        'editor.lineHighlightBorder': p.lineHighlight,
        'editor.selectionBackground': p.selection,
        'editorLineNumber.foreground': p.comment,
        'editorLineNumber.activeForeground': p.fg,
        'editorGutter.background': p.bg,
        'minimap.background': p.bg,
        'editorWidget.background': theme.ui.bar,
        'editorSuggestWidget.background': theme.ui.bar,
        'editorHoverWidget.background': theme.ui.bar,
      },
    };
  }

  function setupTrust() {
    ui.trust.hidden = Boolean(prefs.trustDismissed);
    ui.trustClose.addEventListener('click', () => {
      ui.trust.hidden = true;
      prefs.trustDismissed = true;
      savePrefs();
      editor?.focus();
    });
    ui.trustMore.addEventListener('click', () => ui.trustDialog.showModal());
    ui.trustStatus.addEventListener('click', () => ui.trustDialog.showModal());
    ui.trustDialogClose.addEventListener('click', () => ui.trustDialog.close());
    // The dialog has no padding, so a click on the element itself is a click on the backdrop.
    ui.trustDialog.addEventListener('click', (event) => {
      if (event.target === ui.trustDialog) ui.trustDialog.close();
    });
    ui.trustDialog.addEventListener('close', () => editor?.focus());
  }

  function updateCursor() {
    if (!active) return;
    const pos = editor.getPosition();
    const selection = editor.getSelection();
    if (!pos) return;
    const selected = selection && !selection.isEmpty() ? active.model.getValueInRange(selection).length : 0;
    ui.cursor.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}${selected ? ` (${selected} selected)` : ''}`;
  }

  function setMessage(text, kind = '') {
    ui.message.textContent = text;
    ui.message.className = kind;
  }

  function showOverlay(text, isError = false) {
    ui.overlayText.textContent = text;
    ui.overlay.classList.toggle('error', isError);
    ui.overlayClassic.hidden = !isError;
    ui.overlay.hidden = false;
  }

  function hideOverlay() {
    ui.overlay.hidden = true;
  }

  function loadPrefs() {
    const defaults = { theme: 'system', wrap: false, trustDismissed: false, sidebar: true, sidebarWidth: 240 };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('cpm-prefs') || '{}') };
    } catch {
      return defaults;
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem('cpm-prefs', JSON.stringify(prefs));
    } catch {
      // Preferences are a convenience; ignore storage failures.
    }
  }
})();
