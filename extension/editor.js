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
    indexStatus: $('index-status'),
    settingsBtn: $('settings-btn'),
    settingsDialog: $('settings-dialog'),
    stage: $('stage'),
    viewer: $('viewer'),
    splitBtn: $('split-btn'),
    previewBtn: $('preview-btn'),
    splitResizer: $('split-resizer'),
    side: $('side'),
    sideName: $('side-name'),
    sideKind: $('side-kind'),
    sideClose: $('side-close'),
    sideEditor: $('side-editor'),
    sideViewer: $('side-viewer'),
    sidePreview: $('side-preview'),
    upload: $('upload'),
    uploadInput: $('upload-input'),
    uploadFolderInput: $('upload-folder-input'),
    replaceInput: $('replace-input'),
    replaceAll: $('replace-all'),
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
  // Pictures are shown, not edited. SVG is both: text in the editor, a picture in the preview.
  const IMAGE_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  };
  const IMAGE_MAX = 25 * 1024 * 1024;
  const PREVIEWABLE = /\.(md|markdown|mdown|mkd|svg)$/i;
  const ARCHIVE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2?|gz|bz2)$/i;

  // Quick open walks the folder tree through the same UAPI call as the explorer, so it
  // stays away from folders that are huge or never hold code, and stops at a fixed size.
  const SKIP_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', 'vendor', '.cache', 'cache', '.trash', '__pycache__', '.next', '.venv', 'venv']);
  const SKIP_HOME_DIRS = new Set([
    'mail', 'logs', 'tmp', 'ssl', 'etc', 'access-logs', '.cpanel', '.cagefs', '.caldav', '.htpasswds',
    '.softaculous', '.spamassassin', '.npm', '.composer', '.razor', '.subaccounts', '.cphorde', '.trash',
    'perl5', 'lscache', '.local', '.config', '.cl.selector', '.nvm', '.pki', 'public_ftp', 'cgi-bin',
  ]);
  const HOME_PATTERN = /^\/home\d*\/[^/]+/;
  const INDEX_MAX_FILES = 10000;
  const INDEX_MAX_DIRS = 1500;
  // Browsers allow about six connections to one server. Background listing stays under that,
  // so opening and saving files never has to queue behind it.
  const INDEX_CONCURRENCY = 4;
  const QUICK_MAX_RESULTS = 60;

  // Must match PROTOCOL in content.js.
  const PROTOCOL = 3;
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
  const UPLOAD_MAX_FILES = 2000;
  // Indexing, searching and other bulk work is sent a few requests at a time, and held back
  // while anything the user asked for is on its way (see request()).
  const BACKGROUND_MAX = 4;

  const THEMES = window.CPM_THEMES;
  // Material Icon Theme tables, generated at build time (monaco/file-icons/icons.js).
  const FILE_ICONS = window.CPM_FILE_ICONS || null;
  const iconCache = new Map();
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const prefs = loadPrefs();
  // Everything the user can change lives in settings.js; prefs keeps only layout state.
  const settings = window.CPM_SETTINGS;
  settings.setThemes(THEMES);
  settings.migrate(prefs);
  let editor = null;
  let parentOrigin = null;
  let lastState = '';
  let nextRequestId = 1;
  const pending = new Map();
  const background = { queue: [], running: 0, urgent: 0 };

  // Each tab: { path, dir, file, model, charset, savedVersion, saving, viewState, shownDirty, lastUsed }
  // A picture's tab also has `image` ({ url, size }); its model stays empty and is never saved.
  const tabs = [];
  let active = null;
  const opening = new Set();

  let rootDir = null;
  const expanded = new Set();
  // dir -> { status: 'loading' | 'ok' | 'error', entries, error, promise }
  const listings = new Map();

  const quick = { files: [], crawling: false, done: false, truncated: false, generation: 0, results: [], selected: 0, frame: 0, promise: null, wantAll: false, resume: null, markReady: null };

  // The cPanel host, so drafts, history and open tabs from different servers never mix.
  let server = '';
  let sessionKey = '';
  const diff = { editor: null, temp: [] };
  const search = { generation: 0, timer: 0, cache: new Map(), cacheChars: 0, groups: [], total: 0, collapsed: new Set(), renderTimer: 0, matchList: [], matcher: null, regex: false, limited: false };
  let lastTreeRow = null;
  // The second pane, beside the editor: another editor on a tab's file ('editor'), a rendered
  // preview of it ('preview') or a picture ('image').
  const split = { tab: null, mode: '', editor: null, focused: false, timer: 0, images: new Map() };
  // What Cut or Copy in the explorer picked up: { items: [{ path, type }], cut }.
  let clip = null;
  // Rows picked with Ctrl+click or Shift+click: path -> type.
  const selected = new Map();
  let selectAnchor = null;
  let dragged = null;
  let uploadDir = null;

  setupThemePicker();
  applyTheme();
  setupTrust();
  setupSidebar();
  setupQuickOpen();
  setupFileOps();
  setupDragAndDrop();
  setupSearch();
  setupHistory();
  ui.wrap.setAttribute('aria-pressed', String(wrapMode() !== 'off'));
  darkQuery.addEventListener('change', () => {
    if (settings.get('workbench.colorTheme') === 'system') applyTheme();
  });
  settings.onChange(applySettings);
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
    applyEmmet();

    // Laravel: Blade templates, and view, route and config names in PHP and Blade files.
    window.CPM_BLADE?.register(monaco);
    window.CPM_LARAVEL?.register(monaco, {
      enabled: () => settings.get('laravel.enabled'),
      files: () => indexReady().then(() => quick.files),
      read: (dir, file) => request({ op: 'read', dir, file, charset: 'utf-8' }, { background: true }).then((result) => result.content),
      pathOf: (model) => tabs.find((tab) => tab.model === model)?.path || '',
    });

    window.CPM_WORDPRESS?.register(monaco, {
      mode: () => (settings.get('php.builtins.enabled') ? settings.get('wordpress.support') : 'off'),
      files: () => indexReady().then(() => quick.files),
    });

    // PHP has syntax highlighting in Monaco but no completions, so add our own.
    window.CPM_PHP?.register(monaco);
    // Go to definition (F12, Ctrl+click) and the outline (Ctrl+Shift+O) for PHP.
    monaco.languages.registerDefinitionProvider(['php', 'blade'], { provideDefinition });
    monaco.editor.registerEditorOpener({ openCodeEditor: openDefinition });
    monaco.languages.registerDocumentSymbolProvider('php', {
      displayName: 'PHP',
      provideDocumentSymbols: (model) => window.CPM_PHP_MEMBERS.outline(model, monaco),
    });
    window.CPM_FORMAT?.register(monaco, setMessage, () => settings.get('php.format.phpVersion'));

    for (const theme of THEMES) {
      if (theme.palette) monaco.editor.defineTheme(monacoThemeId(theme), buildMonacoTheme(theme));
    }

    editor = monaco.editor.create(ui.editor, {
      model: null,
      theme: monacoThemeId(resolveTheme()),
      automaticLayout: true,
      fixedOverflowWidgets: true,
      ...monacoOptions(),
    });

    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, toggleWrap);
    editor.onDidChangeCursorPosition(updateCursor);
    editor.onDidChangeCursorSelection(updateCursor);

    const languages = monaco.languages.getLanguages()
      .map((lang) => ({ id: lang.id, label: lang.aliases?.[0] || lang.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    for (const lang of languages) ui.language.add(new Option(lang.label, lang.id));

    ui.language.addEventListener('change', () => {
      if (active && !active.image) monaco.editor.setModelLanguage(active.model, ui.language.value);
      if (active) scheduleLint(active);
    });
    ui.wrap.addEventListener('click', toggleWrap);
    setupSettings();
    ui.save.addEventListener('click', () => save());
    ui.review.addEventListener('click', review);
    ui.history.addEventListener('click', openHistory);
    ui.classic.addEventListener('click', backToClassic);
    ui.overlayClassic.addEventListener('click', () => send({ type: 'classic' }));
    setupTabs();
    setupSplit();

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
        settings.setServer(server);
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
        settings.setServer(server);
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

  function dispatch(message) {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pending.set(id, { resolve, reject });
      send({ type: 'request', id, ...message });
    });
  }

  // Requests the user is waiting for are sent at once. Background ones wait in a queue, and
  // their promise has promote() for when the user turns out to need the answer after all.
  function request(message, { background: low = false } = {}) {
    if (!low) return urgent(dispatch(message));
    const job = { message };
    const promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
    promise.promote = () => {
      const at = background.queue.indexOf(job);
      if (at === -1) return;
      background.queue.splice(at, 1);
      urgent(dispatch(message)).then(job.resolve, job.reject);
    };
    background.queue.push(job);
    pump();
    return promise;
  }

  function urgent(promise) {
    background.urgent++;
    const done = () => {
      background.urgent--;
      pump();
    };
    promise.then(done, done);
    return promise;
  }

  function pump() {
    while (background.queue.length && background.running < BACKGROUND_MAX && !background.urgent) {
      const job = background.queue.shift();
      background.running++;
      dispatch(job.message).then(job.resolve, job.reject).finally(() => {
        background.running--;
        pump();
      });
    }
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
        ? { f: openSearch, p: openCommandPalette, v: active && canPreview(active) ? togglePreview : null }[key]
        : { s: () => save(), p: openQuickOpen, b: toggleSidebar, ',': () => openSettings(), '\\': toggleSplit }[key];
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
  function addTab({ dir, file, content, charset, image = null }, append = false) {
    const path = joinPath(dir, file);
    // No file URI: a tab's path can change on rename, and a model's URI can't.
    const model = monaco.editor.createModel(content, image ? 'plaintext' : guessLanguage(file));
    applyModelOptions(model);
    const tab = {
      path, dir, file, model, charset, image,
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
      scheduleAutoSave(tab);
      scheduleLint(tab);
      if (split.tab === tab && split.mode === 'preview') schedulePreview();
    });
    tabs.splice(append || !active ? tabs.length : tabs.indexOf(active) + 1, 0, tab);
    if (!image) checkDraft(tab);
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
    if (/\.php$/i.test(tab.file)) {
      loadPhpDocs();
      schedulePhpIndex();
      window.CPM_WORDPRESS?.check(tab.path);
    }
    scheduleLint(tab);
  }

  function closeTab(tab) {
    const dirty = isDirty(tab);
    if (dirty && !confirm(`${tab.file} has unsaved changes. Close it and lose them?`)) return;
    clearTimeout(tab.draftTimer);
    clearTimeout(tab.lintTimer);
    // Discarding on purpose also discards the draft, unless it's a recovered one not yet looked at.
    if (dirty && !tab.draftOffer) quiet(db.deleteDraft(fileKey(tab.path)));
    if (split.tab === tab) closeSide(false);
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
    ui.tabs.addEventListener('contextmenu', (event) => {
      const el = event.target.closest('.tab');
      const tab = el && tabs.find((t) => t.path === el.dataset.path);
      if (!tab) return;
      event.preventDefault();
      showMenu(event.clientX, event.clientY, [
        { label: 'Open to the side', run: () => openSide(tab) },
        ...(canPreview(tab) ? [{ label: 'Open preview to the side', run: () => openSide(tab, 'preview') }] : []),
        '-',
        { label: 'Close', hint: 'Alt+W', run: () => closeTab(tab) },
        { label: 'Close others', run: () => tabs.filter((t) => t !== tab).forEach(closeTab) },
        '-',
        { label: 'Copy path', run: () => copyText(tab.path) },
      ]);
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
      el.className = `tab${tab === active ? ' active' : ''}${dirty ? ' unsaved' : ''}${tab === split.tab ? ' in-side' : ''}`;
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
    const text = Boolean(active) && !active.image;
    ui.empty.hidden = Boolean(active);
    ui.language.disabled = !text;
    ui.review.disabled = !text;
    ui.history.disabled = !text;
    renderNotice();
    updateSideChrome();
    if (active?.image) {
      showImage(ui.viewer, active);
    } else {
      ui.viewer.hidden = true;
      ui.viewer.replaceChildren();
    }
    if (active) {
      const { file, path, model, charset } = active;
      document.title = file;
      ui.name.textContent = file;
      // LRM marks keep slashes in place while the RTL trick truncates the start of long paths.
      ui.path.textContent = `‎${path}‎`;
      ui.path.title = path;
      ui.language.value = model.getLanguageId();
      ui.charset.textContent = text ? charset.toUpperCase() : '';
      ui.eol.textContent = !text ? '' : model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
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
    ui.save.disabled = !active || active.saving || Boolean(active.image);
    const busy = Boolean(active?.saving);
    ui.save.classList.toggle('busy', busy);
    ui.save.setAttribute('aria-busy', String(busy));
    $('save-label').textContent = busy ? 'Saving…' : 'Save';
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
    if (lower.endsWith('.blade.php')) return 'blade';
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
  // With the editor split, it saves the file in the pane that was used last.
  async function save({ force = false, auto = false, tab = focusedTab() } = {}) {
    if (!tab || tab.saving || tab.image) return false;
    tab.saving = true;
    refreshDirty();
    setMessage(`Saving ${tab.file}…`);
    await prepareForSave(tab, auto).catch(() => {});
    const version = tab.model.getAlternativeVersionId();
    const content = tab.model.getValue();
    const target = { dir: tab.dir, file: tab.file, charset: tab.charset };
    try {
      if (!force) {
        // A file that can't be read (e.g. deleted meanwhile) is simply written again.
        const current = await request({ op: 'read', ...target }).then((r) => r.content, () => null);
        if (current !== null && current !== tab.base && current !== content) {
          if (auto) {
            setMessage('Auto save skipped: the file changed on the server. Press Ctrl+S to review the differences.', 'error');
            return false;
          }
          showConflict(tab, current);
          return false;
        }
      }
      await request({ op: 'write', ...target, content });
      const before = tab.base;
      tab.base = content;
      tab.savedVersion = version;
      updateSearchCache(tab.path, content);
      if (phpIndex.promise && /\.php$/i.test(tab.file)) window.CPM_PHP_INDEX.update(tab.path, content);
      window.CPM_LARAVEL?.changed(tab.path);
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
    settings.setEffective('editor.wordWrap', wrapMode() === 'off' ? 'on' : 'off');
  }

  // ---- Opening files ----

  async function openFile(dir, file, { size = 0, line = 0, column = 1, length = 0, word = '', side = false } = {}) {
    const path = joinPath(dir, file);
    // "Open to the side" puts the file in the second pane and leaves the main one alone.
    const show = (tab) => {
      if (side && active) return openSide(tab);
      if (tab !== active) activate(tab);
      // `word` is a name to select on that line (a declaration), wherever in the line it is.
      const at = line && word ? tab.model.getLineContent(Math.min(line, tab.model.getLineCount())).indexOf(word) : -1;
      if (at === -1) goToLine(line, column, length);
      else goToLine(line, at + 1, word.length);
    };
    const open = tabs.find((t) => t.path === path);
    if (open) return show(open);
    const image = isImage(file);
    if (!image && BINARY_EXTENSIONS.has(extensionOf(file.toLowerCase()))) {
      setMessage(`${file} is a binary file, so it can't be edited as text.`, 'error');
      return;
    }
    if (image && size > IMAGE_MAX) {
      setMessage(`${file} is ${formatSize(size)}, which is too large to preview.`, 'error');
      return;
    }
    if (!image && size > LARGE_FILE && !confirm(`${file} is ${formatSize(size)}. Very large files can make the editor slow. Open it anyway?`)) return;
    if (opening.has(path)) return;

    opening.add(path);
    setMessage(`Opening ${file}…`);
    try {
      const data = image
        ? { content: '', charset: 'utf-8', image: await loadImage(dir, file) }
        : await request({ op: 'read', dir, file });
      show(tabs.find((t) => t.path === path) || addTab({ dir, file, ...data }));
      setMessage('');
    } catch (err) {
      setMessage(`Couldn't open ${file}: ${err.message}`, 'error');
    } finally {
      opening.delete(path);
    }
  }

  function isImage(file) {
    const ext = extensionOf(file.toLowerCase());
    return ext !== 'svg' && Boolean(IMAGE_TYPES[ext]);
  }

  // This page may only show pictures that are part of the extension or data: URLs, so the
  // bytes are fetched by content.js (from your cPanel) and inlined.
  async function loadImage(dir, file) {
    const { blob } = await request({ op: 'blob', dir, file });
    const type = IMAGE_TYPES[extensionOf(file.toLowerCase())];
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([blob], { type }));
    });
    return { url, size: blob.size };
  }

  function showImage(container, tab) {
    const img = document.createElement('img');
    img.alt = tab.file;
    img.draggable = false;
    const info = document.createElement('p');
    info.textContent = formatSize(tab.image.size);
    img.addEventListener('load', () => {
      info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${formatSize(tab.image.size)}`;
    });
    img.addEventListener('error', () => {
      info.textContent = 'This picture couldn’t be displayed. Your session may have expired.';
    });
    // A click switches between fitting the pane and the picture's real size.
    img.addEventListener('click', () => container.classList.toggle('actual'));
    img.src = tab.image.url;
    const frame = document.createElement('div');
    frame.className = 'viewer-frame';
    frame.append(img);
    container.classList.remove('actual');
    container.replaceChildren(frame, info);
    container.hidden = false;
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
    warmTree();
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
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        selectRow(row, event.shiftKey);
        return;
      }
      clearSelection();
      selectAnchor = row.dataset.path;
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
    onDrag(ui.resizer, (x) => resize(x - ui.sidebar.getBoundingClientRect().left), savePrefs);
    ui.resizer.addEventListener('keydown', (event) => {
      const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
      if (!step) return;
      event.preventDefault();
      resize(prefs.sidebarWidth + step);
      savePrefs();
    });
  }

  // Calls `move` with the pointer's x position while a divider is dragged, then `done`.
  function onDrag(handle, move, done) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      const drag = (e) => move(e.clientX);
      const stop = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', drag);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        done();
      };
      handle.addEventListener('pointermove', drag);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
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

  function listDir(dir, low = false) {
    let listing = listings.get(dir);
    if (!listing) {
      listing = { status: 'loading', entries: [], error: '' };
      listings.set(dir, listing);
      fetchListing(dir, listing, low);
    } else if (!low) {
      // The explorer needs a folder that indexing had only queued: send it now.
      listing.sent?.promote?.();
    }
    return listing.promise;
  }

  function fetchListing(dir, listing, low = false) {
    listing.sent = request({ op: 'list', dir }, { background: low });
    listing.promise = listing.sent.then((entries) => {
      entries.sort((a, b) =>
        (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || collator.compare(a.name, b.name));
      const changed = listing.stale && !sameEntries(listing.entries, entries);
      Object.assign(listing, { status: 'ok', entries, error: '', stale: false });
      // Only what the explorer shows is worth remembering, not every folder quick open walks.
      if (dir === rootDir || expanded.has(dir)) storeListing(dir, entries);
      if (changed) renderTree();
      return entries;
    }, (err) => {
      const wasStale = listing.stale;
      Object.assign(listing, { status: 'error', error: err.message, stale: false });
      if (wasStale) renderTree();
      throw err;
    });
  }

  function sameEntries(a, b) {
    return a.length === b.length && a.every((entry, i) =>
      entry.name === b[i].name && entry.type === b[i].type && entry.size === b[i].size);
  }

  // Folder listings from the last visit, so the explorer paints at once and is corrected
  // when the real listing arrives. Only used when the editor opens; after that, listings are fresh.
  const LISTING_CACHE_KEY = 'cpm-listings';
  const LISTING_CACHE_DIRS = 40;
  const LISTING_CACHE_ENTRIES = 3000;
  let listingCache = null;
  let listingCacheTimer = 0;

  function readListingCache() {
    if (!listingCache) {
      try {
        listingCache = JSON.parse(localStorage.getItem(LISTING_CACHE_KEY) || '{}');
      } catch {
        listingCache = {};
      }
    }
    return listingCache;
  }

  function storeListing(dir, entries) {
    if (entries.length > LISTING_CACHE_ENTRIES) return;
    readListingCache()[`${server}|${dir}`] = { t: Date.now(), entries };
    clearTimeout(listingCacheTimer);
    listingCacheTimer = setTimeout(() => {
      const cache = readListingCache();
      const keys = Object.keys(cache).sort((x, y) => cache[y].t - cache[x].t);
      for (const key of keys.slice(LISTING_CACHE_DIRS)) delete cache[key];
      try {
        localStorage.setItem(LISTING_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // A convenience only; ignore quota errors.
      }
    }, 1000);
  }

  // Starts listing every folder the explorer is about to show at once, rather than one
  // level after another, and paints cached listings straight away.
  function warmTree() {
    const cache = readListingCache();
    for (const dir of [rootDir, ...expanded]) {
      if (listings.has(dir) || (dir !== rootDir && !isInside(dir, rootDir))) continue;
      const cached = cache[`${server}|${dir}`];
      if (cached) {
        const listing = { status: 'ok', entries: cached.entries, error: '', stale: true };
        listings.set(dir, listing);
        fetchListing(dir, listing);
        listing.promise.catch(() => {});
      } else {
        listDir(dir).catch(() => {});
      }
    }
  }

  function toggleDir(path) {
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
      const listing = listings.get(path);
      if (listing?.status === 'ok') storeListing(path, listing.entries);
    }
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
    const entries = settings.get('explorer.showHiddenFiles')
      ? listing.entries
      : listing.entries.filter((entry) => !entry.name.startsWith('.'));
    if (!entries.length) {
      parent.append(noteRow(listing.entries.length ? 'Only hidden files here' : 'Empty folder', depth));
      return;
    }
    for (const entry of entries) {
      const path = joinPath(dir, entry.name);
      const isDir = entry.type === 'dir';
      const open = isDir && expanded.has(path);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `row${active?.path === path ? ' active' : ''}${selected.has(path) ? ' selected' : ''}${clip?.cut && clip.items.some((item) => item.path === path) ? ' cut' : ''}`;
      row.tabIndex = -1;
      row.draggable = true;
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
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      const run = {
        c: () => setClip(selectionFor(path, type), false),
        x: () => setClip(selectionFor(path, type), true),
        v: () => pasteEntry(type === 'dir' ? path : row.dataset.dir),
      }[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      run();
      return;
    }
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
        trashEntries(selectionFor(path, type));
        break;
      case 'Escape':
        if (!selected.size) return;
        clearSelection();
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

  // Ctrl+click adds or removes a row; Shift+click selects from the row clicked before to this one.
  function selectRow(row, range) {
    const rows = [...ui.tree.querySelectorAll('.row')];
    const { path, type } = row.dataset;
    const anchor = selectAnchor ? rows.find((r) => r.dataset.path === selectAnchor) : null;
    if (range && anchor) {
      const from = rows.indexOf(anchor);
      const to = rows.indexOf(row);
      selected.clear();
      for (const r of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) selected.set(r.dataset.path, r.dataset.type);
    } else {
      if (selected.has(path)) selected.delete(path);
      else selected.set(path, type);
      selectAnchor = path;
    }
    paintSelection();
  }

  function paintSelection() {
    for (const row of ui.tree.querySelectorAll('.row')) row.classList.toggle('selected', selected.has(row.dataset.path));
  }

  function clearSelection() {
    if (!selected.size) return;
    selected.clear();
    paintSelection();
  }

  // What an action on a row applies to: the whole selection when the row is part of one,
  // without anything that sits inside a folder that is selected too.
  function selectionFor(path, type) {
    if (selected.size < 2 || !selected.has(path)) return [{ path, type }];
    const items = [...selected].map(([p, t]) => ({ path: p, type: t }));
    return items.filter((item) => !items.some((other) => isInside(item.path, other.path)));
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
    wantAllFiles();
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
    openFile(result.dir, result.file, { size: result.size, line: result.line || line, word: result.word });
  }

  function resetIndex() {
    quick.generation++;
    quick.files = [];
    quick.crawling = quick.done = quick.truncated = quick.refreshing = false;
    quick.promise = quick.ready = quick.markReady = null;
    // Lets a paused walk notice that it's out of date and stop.
    quick.resume?.();
    quick.resume = null;
  }

  // Go to file and Find in files need every folder, not just the open file's project.
  function wantAllFiles() {
    quick.wantAll = true;
    quick.resume?.();
    quick.resume = null;
  }

  // After the folder structure changed (create, rename, delete) the saved list is out of date:
  // it still shows at once next time, but is always refreshed.
  function forgetIndexCache() {
    if (rootDir) {
      quiet(db.getCache(indexCacheKey()).then((record) => record && db.putCache(indexCacheKey(), { ...record, t: 0 })));
    }
    resetIndex();
    quick.stale = true;
  }

  const indexCacheKey = () => `index|${server}|${rootDir}`;
  // A saved list younger than this is used as is; an older one is shown at once and refreshed.
  const INDEX_FRESH_MS = 5 * 60 * 1000;

  // Resolves when the file list for the current root is complete (or was reset meanwhile).
  // The list saved on the last visit is available straight away, long before that.
  function buildIndex() {
    if (!quick.promise) {
      const generation = quick.generation;
      let ready;
      quick.ready = new Promise((resolve) => { ready = resolve; });
      quick.markReady = ready;
      quick.promise = (async () => {
        try {
          const age = await loadIndexCache();
          if (generation !== quick.generation) return;
          if (age !== null) ready();
          if (age !== null && age < INDEX_FRESH_MS && !quick.stale) {
            quick.done = true;
            scheduleQuickUpdate();
          } else {
            await crawlIndex(age !== null);
          }
        } finally {
          ready();
        }
      })();
    }
    return quick.promise;
  }

  // Resolves as soon as there is a usable file list, which may still be refreshing.
  function indexReady() {
    buildIndex();
    return quick.ready;
  }

  async function loadIndexCache() {
    const generation = quick.generation;
    const root = rootDir;
    let record = null;
    try {
      record = await db.getCache(indexCacheKey());
    } catch {
      return null;
    }
    if (!record || generation !== quick.generation) return null;
    quick.files = record.rows.map(([d, file, size, mtime]) => {
      const dir = record.dirs[d];
      return { dir, file, size, mtime, rel: relativePath(joinPath(dir, file), root) };
    });
    quick.truncated = Boolean(record.truncated);
    scheduleQuickUpdate();
    return Date.now() - record.t;
  }

  function saveIndexCache() {
    const dirs = [];
    const positions = new Map();
    const rows = quick.files.map((item) => {
      let position = positions.get(item.dir);
      if (position === undefined) {
        position = dirs.push(item.dir) - 1;
        positions.set(item.dir, position);
      }
      return [position, item.file, item.size, item.mtime || 0];
    });
    quiet(db.putCache(indexCacheKey(), { t: Date.now(), truncated: quick.truncated, dirs, rows }));
  }

  // Breadth-first walk, a few folders at a time. The folder holding the open file's project
  // (e.g. public_html) is walked first, so useful results appear before the rest of the
  // account has been listed. When a saved list is on screen, the new one is built on the side
  // and swapped in at the end, so results never flicker.
  async function crawlIndex(refreshing = false) {
    const generation = quick.generation;
    const root = rootDir;
    quick.crawling = true;
    quick.refreshing = refreshing;
    const state = { dirCount: 0, full: false, files: refreshing ? [] : quick.files };

    const first = projectFolder(root);
    if (first) await walk([first], new Set(), generation, root, state);
    if (generation !== quick.generation) return;
    if (first && !state.full && !quick.wantAll) {
      // The open file's project is all that completion needs. The rest of the account is only
      // listed once Go to file or Find in files asks for it, which spares an account with many
      // files hundreds of requests on every visit.
      const project = state.files.slice();
      if (refreshing) quick.files = [...project, ...quick.files.filter((item) => !isInside(joinPath(item.dir, item.file), first))];
      quick.markReady?.();
      await new Promise((resolve) => { quick.resume = resolve; });
      if (generation !== quick.generation) return;
      if (refreshing) state.files = project;
    }
    if (!state.full) await walk([root], new Set(first ? [first] : []), generation, root, state);
    if (generation !== quick.generation) return;

    quick.files = state.files;
    quick.truncated = state.full;
    quick.crawling = quick.refreshing = quick.stale = false;
    quick.done = true;
    saveIndexCache();
    scheduleQuickUpdate();
  }

  // The top-level folder under the explorer root that contains the open file, if any.
  function projectFolder(root) {
    if (root.match(HOME_PATTERN)?.[0] !== root || !active) return null;
    const rest = active.dir.startsWith(root + '/') ? active.dir.slice(root.length + 1) : '';
    const top = rest.split('/')[0];
    return top && !SKIP_HOME_DIRS.has(top) ? joinPath(root, top) : null;
  }

  async function walk(start, skip, generation, root, state) {
    let level = start;
    while (level.length) {
      const next = [];
      for (let i = 0; i < level.length; i += INDEX_CONCURRENCY) {
        const batch = level.slice(i, i + INDEX_CONCURRENCY);
        const listed = await Promise.all(batch.map((dir) =>
          listDir(dir, true).then((entries) => [dir, entries], () => [dir, []])));
        if (generation !== quick.generation) return;

        for (const [dir, entries] of listed) {
          const atHome = dir.match(HOME_PATTERN)?.[0] === dir;
          for (const entry of entries) {
            if (entry.type === 'dir') {
              const path = joinPath(dir, entry.name);
              if (!SKIP_DIRS.has(entry.name) && !(atHome && SKIP_HOME_DIRS.has(entry.name)) && !skip.has(path)) next.push(path);
            } else if (!BINARY_EXTENSIONS.has(extensionOf(entry.name.toLowerCase()))) {
              state.files.push({ dir, file: entry.name, size: entry.size, mtime: entry.mtime, rel: relativePath(joinPath(dir, entry.name), root) });
            }
          }
        }
        state.dirCount += batch.length;
        if (state.files === quick.files) scheduleQuickUpdate();
        if (state.files.length >= INDEX_MAX_FILES || state.dirCount >= INDEX_MAX_DIRS) {
          state.full = true;
          return;
        }
      }
      level = next;
    }
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

  // "#name" in Go to file lists the project's classes, methods and functions instead of files.
  function updateSymbolResults(query) {
    if (settings.get('php.index.enabled')) ensurePhpIndex();
    const index = window.CPM_PHP_INDEX;
    const scored = [];
    for (const symbol of index.symbols()) {
      const match = query ? fuzzyMatch(query, symbol.name) : { score: 0, positions: [] };
      if (match) scored.push({ symbol, ...match });
    }
    scored.sort((a, b) => b.score - a.score || a.symbol.name.length - b.symbol.name.length);
    quick.results = scored.slice(0, QUICK_MAX_RESULTS).map(({ symbol, positions }) => ({
      dir: parentOf(symbol.file),
      file: baseName(symbol.file),
      size: 0,
      label: symbol.name,
      detail: `${symbol.kind} · ${relativePath(symbol.file, rootDir)}`,
      line: symbol.line,
      word: symbol.word || symbol.name,
      name: positions,
      where: [],
    }));
    quick.selected = Math.min(quick.selected, Math.max(quick.results.length - 1, 0));
    renderQuickResults();
    ui.quickStatus.textContent = quick.results.length
      ? ''
      : index.size ? 'No matching classes or functions.' : 'No PHP classes or functions are indexed yet. Open a PHP file of the project first.';
  }

  function updateQuickResults() {
    const typed = ui.quickInput.value.trim();
    if (typed.startsWith('#')) {
      updateSymbolResults(typed.slice(1).replace(/\s+/g, '').toLowerCase());
      return;
    }
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
      ? quick.refreshing
        ? `${count} files from your last visit. Checking for changes…`
        : `Indexing ${baseName(rootDir)}… ${count} files so far`
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
      const where = result.detail ?? (parentOf(result.rel) === '/' || !result.rel.includes('/') ? '' : parentOf(result.rel));
      item.append(
        fileIcon(result.file),
        highlight(result.label ?? result.file, result.name, 'q-name'),
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

  // ---- Settings: applying them to Monaco and the page ----

  function wrapMode() {
    return settings.get('editor.wordWrap');
  }

  function monacoOptions() {
    const get = (key) => settings.get(key);
    const rulers = String(get('editor.rulers')).split(',').map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0);
    return {
      fontFamily: get('editor.fontFamily').trim() || settings.codeFont,
      fontSize: get('editor.fontSize'),
      fontLigatures: get('editor.fontLigatures'),
      fontWeight: get('editor.fontWeight'),
      lineHeight: get('editor.lineHeight'),
      cursorStyle: get('editor.cursorStyle'),
      cursorBlinking: get('editor.cursorBlinking'),
      cursorSmoothCaretAnimation: get('editor.cursorSmoothCaretAnimation'),
      multiCursorModifier: get('editor.multiCursorModifier'),
      wordWrap: get('editor.wordWrap'),
      wordWrapColumn: get('editor.wordWrapColumn'),
      lineNumbers: get('editor.lineNumbers'),
      minimap: { enabled: get('editor.minimap.enabled') },
      renderWhitespace: get('editor.renderWhitespace'),
      renderLineHighlight: get('editor.renderLineHighlight'),
      rulers,
      bracketPairColorization: { enabled: get('editor.bracketPairColorization.enabled') },
      matchBrackets: get('editor.matchBrackets'),
      guides: { indentation: get('editor.guides.indentation') },
      stickyScroll: { enabled: get('editor.stickyScroll.enabled') },
      folding: get('editor.folding'),
      smoothScrolling: get('editor.smoothScrolling'),
      scrollBeyondLastLine: get('editor.scrollBeyondLastLine'),
      mouseWheelZoom: get('editor.mouseWheelZoom'),
      formatOnPaste: get('editor.formatOnPaste'),
      formatOnType: get('editor.formatOnType'),
      autoClosingBrackets: get('editor.autoClosingBrackets'),
      autoClosingQuotes: get('editor.autoClosingQuotes'),
      autoIndent: get('editor.autoIndent'),
      quickSuggestions: get('editor.quickSuggestions') ? { other: true, comments: false, strings: true } : false,
      suggestOnTriggerCharacters: get('editor.suggestOnTriggerCharacters'),
      acceptSuggestionOnEnter: get('editor.acceptSuggestionOnEnter'),
      tabCompletion: get('editor.tabCompletion'),
      snippetSuggestions: get('editor.snippetSuggestions'),
      wordBasedSuggestions: get('editor.wordBasedSuggestions'),
      suggest: { preview: get('editor.suggest.preview') },
      parameterHints: { enabled: get('editor.parameterHints.enabled') },
    };
  }

  function diffFontOptions() {
    const { fontFamily, fontSize, fontLigatures, fontWeight, lineHeight } = monacoOptions();
    return { fontFamily, fontSize, fontLigatures, fontWeight, lineHeight };
  }

  // Indentation belongs to each file's model, not to the editor.
  function applyModelOptions(model) {
    const tabSize = settings.get('editor.tabSize');
    const insertSpaces = settings.get('editor.insertSpaces');
    model.updateOptions({ tabSize, insertSpaces });
    if (settings.get('editor.detectIndentation')) model.detectIndentation(insertSpaces, tabSize);
  }

  const emmet = { disposers: [] };
  function applyEmmet() {
    const enabled = settings.get('emmet.enabled');
    if (enabled && !emmet.disposers.length && window.emmetMonaco) {
      emmet.disposers = [
        emmetMonaco.emmetHTML(monaco, ['html', 'php', 'blade', 'twig', 'handlebars']),
        emmetMonaco.emmetCSS(monaco, ['css', 'scss', 'less']),
      ];
    } else if (!enabled && emmet.disposers.length) {
      for (const dispose of emmet.disposers) dispose();
      emmet.disposers = [];
    }
  }

  // Runs whenever a setting changes (keys = which ones).
  function applySettings(keys) {
    const changed = (...names) => keys.some((key) => names.some((name) => key === name || key.startsWith(name)));
    if (changed('workbench.colorTheme')) {
      ui.theme.value = settings.get('workbench.colorTheme');
      applyTheme();
    }
    if (!editor) return;
    editor.updateOptions(monacoOptions());
    split.editor?.updateOptions(monacoOptions());
    if (changed('editor.tabSize', 'editor.insertSpaces', 'editor.detectIndentation')) {
      for (const tab of tabs) applyModelOptions(tab.model);
    }
    if (changed('editor.wordWrap')) {
      ui.wrap.setAttribute('aria-pressed', String(wrapMode() !== 'off'));
      if (diff.editor) {
        diff.editor.getModifiedEditor().updateOptions({ wordWrap: wrapMode() });
        diff.editor.getOriginalEditor().updateOptions({ wordWrap: wrapMode() });
      }
    }
    if (diff.editor && changed('editor.font', 'editor.lineHeight')) diff.editor.updateOptions(diffFontOptions());
    if (changed('emmet.enabled')) applyEmmet();
    if (changed('explorer.showHiddenFiles')) renderTree();
    if (changed('php.builtins.enabled') && window.CPM_PHP_DOCS) {
      window.CPM_PHP_DOCS.setEnabled(settings.get('php.builtins.enabled'));
      if (settings.get('php.builtins.enabled') && active && /\.php$/i.test(active.file)) loadPhpDocs();
    }
    if (changed('php.index.enabled') && active && /\.php$/i.test(active.file)) schedulePhpIndex();
    if (changed('php.validate.enabled')) for (const tab of tabs) scheduleLint(tab);
    if (changed('wordpress.support', 'php.builtins.enabled') && active && /\.php$/i.test(active.file)) window.CPM_WORDPRESS?.check(active.path);
    if (changed('files.autoSave')) for (const tab of tabs) scheduleAutoSave(tab);
  }

  // ---- Auto save, and what happens just before a save ----

  function scheduleAutoSave(tab) {
    clearTimeout(tab.autoSaveTimer);
    tab.autoSaveTimer = 0;
    if (settings.get('files.autoSave') !== 'afterDelay' || !isDirty(tab)) return;
    tab.autoSaveTimer = setTimeout(() => {
      tab.autoSaveTimer = 0;
      if ((tab === active || tab === split.tab) && isDirty(tab) && !tab.saving) save({ auto: true, tab });
      else if (isDirty(tab) && tab !== active) tab.autoSavePending = true;
    }, settings.get('files.autoSaveDelay'));
  }

  function autoSaveWhen(mode) {
    if (settings.get('files.autoSave') !== mode || !active || !isDirty(active) || active.saving) return;
    save({ auto: true });
  }

  // Format on save, trimming and the final newline all happen in the editor before the text is read.
  async function prepareForSave(tab, auto) {
    // Formatting needs an editor that is showing the file.
    const host = tab === active ? editor : tab === split.tab && split.mode === 'editor' ? split.editor : null;
    if (!host || tab.model.isDisposed()) return;
    const model = tab.model;
    const delayed = auto && settings.get('files.autoSave') === 'afterDelay';
    if (settings.get('editor.formatOnSave') && !delayed) {
      const action = host.getAction('editor.action.formatDocument');
      if (action && action.isSupported()) {
        await Promise.race([action.run(), new Promise((resolve) => setTimeout(resolve, 25000))]);
      }
    }
    const edits = [];
    if (settings.get('files.trimTrailingWhitespace')) {
      for (let line = 1; line <= model.getLineCount(); line++) {
        const text = model.getLineContent(line);
        const at = text.search(/[ \t]+$/);
        if (at !== -1) edits.push({ range: new monaco.Range(line, at + 1, line, text.length + 1), text: '' });
      }
    }
    if (settings.get('files.insertFinalNewline')) {
      const last = model.getLineCount();
      if (model.getLineContent(last) !== '') {
        const column = model.getLineMaxColumn(last);
        edits.push({ range: new monaco.Range(last, column, last, column), text: model.getEOL() });
      }
    }
    if (edits.length) model.pushEditOperations([], edits, () => null);
  }

  // ---- The settings page ----

  let settingsPage = null;
  function openSettings(query = '') {
    settingsPage ||= window.CPM_SETTINGS_UI.create({ dialog: ui.settingsDialog, icons: icon });
    settingsPage.open(query);
  }

  function setupSettings() {
    ui.settingsBtn.addEventListener('click', () => openSettings());
    editor.addAction({
      id: 'cpm.openSettings',
      label: 'Preferences: Open Settings',
      run: () => openSettings(),
    });
    editor.addAction({
      id: 'cpm.openModifiedSettings',
      label: 'Preferences: Show Modified Settings',
      run: () => openSettings('@modified'),
    });
    editor.onDidBlurEditorText(() => autoSaveWhen('onFocusChange'));
    window.addEventListener('blur', () => {
      autoSaveWhen('onFocusChange');
      autoSaveWhen('onWindowChange');
    });
  }

  // ---- PHP syntax check ----

  // Runs shortly after typing stops, in the formatter's worker, and underlines the first
  // syntax error the parser finds.
  function scheduleLint(tab) {
    clearTimeout(tab.lintTimer);
    tab.lintTimer = 0;
    if (tab.image || tab.model.isDisposed()) return;
    if (!settings.get('php.validate.enabled') || tab.model.getLanguageId() !== 'php' || !window.CPM_FORMAT?.check) {
      monaco.editor.setModelMarkers(tab.model, 'cpm-php', []);
      return;
    }
    // Only files on screen are checked; the others are when you switch to them.
    if (tab !== active && tab !== split.tab) return;
    tab.lintTimer = setTimeout(() => lint(tab), 700);
  }

  async function lint(tab) {
    tab.lintTimer = 0;
    const model = tab.model;
    if (model.isDisposed()) return;
    const version = model.getVersionId();
    const result = await window.CPM_FORMAT.check(model.getValue());
    if (model.isDisposed() || model.getVersionId() !== version) return;
    const markers = [];
    if (!result.ok && result.line) {
      const line = Math.min(result.line, model.getLineCount());
      const text = model.getLineContent(line);
      // From the unexpected token to the end of the line, or the whole line when it's at the end.
      const column = (result.column || 0) < text.length ? (result.column || 0) + 1 : Math.max(text.search(/\S/), 0) + 1;
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        source: 'PHP',
        message: result.message,
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: Math.max(text.length + 1, column + 1),
      });
    }
    monaco.editor.setModelMarkers(model, 'cpm-php', markers);
  }

  // ---- Go to definition ----

  const definitionModels = new Map();

  function provideDefinition(model, position) {
    const target = window.CPM_PHP_MEMBERS?.definition(model, position);
    if (!target) return null;
    const own = tabs.find((tab) => tab.model === model);
    if (!target.path || target.path === own?.path) {
      const line = Math.min(target.line, model.getLineCount());
      const at = target.word ? model.getLineContent(line).indexOf(target.word) : -1;
      const column = at === -1 ? 1 : at + 1;
      return { uri: model.uri, range: new monaco.Range(line, column, line, column + (at === -1 ? 0 : target.word.length)) };
    }
    // Monaco needs a document to point at, and the file isn't loaded until you go there. This
    // one-line stand-in says where the declaration is, and carries the line for openDefinition.
    const uri = monaco.Uri.from({ scheme: 'cpm', path: target.path, query: `${target.line}:${target.word || ''}` });
    const key = uri.toString();
    if (!definitionModels.has(key)) {
      const label = `${target.word || baseName(target.path)}  —  ${relativePath(target.path, rootDir)}:${target.line}`;
      definitionModels.set(key, monaco.editor.createModel(label, 'plaintext', uri));
    }
    return { uri, range: new monaco.Range(1, 1, 1, 1) };
  }

  // Monaco calls this to open a definition that is in another file.
  function openDefinition(source, resource) {
    if (resource.scheme !== 'cpm') return false;
    const [line, word] = resource.query.split(':');
    openFile(parentOf(resource.path), baseName(resource.path), { line: Number(line) || 1, word });
    return true;
  }

  // ---- PHP project index (completion across files) ----

  const phpIndex = { key: '', promise: null, timer: 0 };

  // PHP's built-in documentation (about 1 MB) is read once, while the browser is idle.
  function loadPhpDocs() {
    const docs = window.CPM_PHP_DOCS;
    if (!docs) return;
    docs.setEnabled(settings.get('php.builtins.enabled'));
    if (!settings.get('php.builtins.enabled') || docs.ready()) return;
    const start = () => docs.load();
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 3000 });
    else setTimeout(start, 500);
  }

  function setIndexStatus(text) {
    ui.indexStatus.textContent = text;
  }

  // Builds the class index for the open file's project once per visit. It starts shortly after
  // a PHP file opens, reads files a few at a time in the background, and only re-reads files
  // whose size or modified time changed since the last visit.
  function schedulePhpIndex() {
    if (phpIndex.promise || phpIndex.timer || !settings.get('php.index.enabled')) return;
    phpIndex.timer = setTimeout(() => {
      phpIndex.timer = 0;
      ensurePhpIndex();
    }, 1500);
  }

  function ensurePhpIndex() {
    const project = projectFolder(rootDir) || rootDir;
    const key = `${server}|${project}`;
    if (phpIndex.promise && phpIndex.key === key) return phpIndex.promise;
    phpIndex.key = key;
    const index = window.CPM_PHP_INDEX;
    phpIndex.promise = (async () => {
      try {
        const saved = await db.getCache(`php2|${key}`).catch(() => null);
        if (saved) index.restore(saved.rows);
        setIndexStatus('Scanning project…');
        await indexReady();
        const candidates = quick.files
          .filter((item) => (item.dir === project || item.dir.startsWith(`${project}/`)) && /\.php$/i.test(item.file))
          .map((item) => ({ path: joinPath(item.dir, item.file), size: item.size, mtime: item.mtime || 0 }));
        await index.build(candidates, {
          read: (path) => request({ op: 'read', dir: parentOf(path), file: baseName(path), charset: 'utf-8' }, { background: true }),
          onProgress: (done, total) => {
            setIndexStatus(`Indexing PHP classes… ${done}/${total}`);
            scheduleQuickUpdate();
          },
          // "php2": entries also hold line numbers, functions and constants since 2.0.
          onSave: () => quiet(db.putCache(`php2|${key}`, { t: Date.now(), rows: index.serialize() })),
        });
      } catch {
        // Completion simply stays limited to the open file.
      } finally {
        setIndexStatus('');
      }
    })();
    return phpIndex.promise;
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
        const req = indexedDB.open('cpm', 2);
        req.onupgradeneeded = () => {
          const database = req.result;
          if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts', { keyPath: 'key' });
          if (!database.objectStoreNames.contains('history')) {
            database.createObjectStore('history', { keyPath: 'id', autoIncrement: true }).createIndex('key', 'key');
          }
          // File lists and PHP symbols kept between visits (see "Quick open" and the PHP index).
          if (!database.objectStoreNames.contains('cache')) database.createObjectStore('cache', { keyPath: 'key' });
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
      getCache: async (key) => done((await store('cache')).get(key)),
      putCache: async (key, value) => done((await store('cache', 'readwrite')).put({ ...value, key })),
      deleteCache: async (key) => done((await store('cache', 'readwrite')).delete(key)),
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
        await done((await store('cache', 'readwrite')).clear());
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
  function openDiff({ title, legend, original, modified, readOnly = false, language = active?.model.getLanguageId() || 'plaintext', actions }) {
    closeDiff(false);
    if (!diff.editor) {
      diff.editor = monaco.editor.createDiffEditor(ui.diffEditor, {
        automaticLayout: true,
        originalEditable: false,
        ...diffFontOptions(),
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
    diff.editor.getModifiedEditor().updateOptions({ readOnly, wordWrap: wrapMode() });
    diff.editor.getOriginalEditor().updateOptions({ wordWrap: wrapMode() });
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
        { label: 'Save', primary: true, run: async () => { if (await save({ tab })) closeDiff(); } },
        { label: 'Close', run: () => closeDiff() },
      ],
    });
  }

  function showConflict(tab, current) {
    // The comparison is shown in the main pane.
    if (tab !== active) activate(tab);
    setMessage(`Not saved: ${tab.file} was changed on the server after you opened it.`, 'error');
    openDiff({
      title: `${tab.file} changed on the server`,
      legend: 'Left: current server version · Right: your version (editable)',
      original: current,
      modified: tab.model,
      actions: [
        { label: 'Overwrite server version', danger: true, run: async () => { if (await save({ force: true, tab })) closeDiff(); } },
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
      const loading = isImage(file)
        ? loadImage(dir, file).then((image) => ({ content: '', charset: 'utf-8', image }))
        : request({ op: 'read', dir, file });
      return loading.then((data) => ({ dir, file, ...data }), () => null);
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
    ui.upload.addEventListener('click', () => pickUpload(targetDir()));
    for (const input of [ui.uploadInput, ui.uploadFolderInput]) {
      input.addEventListener('change', () => {
        // A picked folder's files say where in it they were: "photos/2024/a.jpg".
        const items = [...input.files].map((file) => ({ file, sub: parentOf(`/${file.webkitRelativePath || file.name}`).slice(1) }));
        uploadItems(items, uploadDir);
      });
    }
    ui.tree.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const row = event.target.closest('.row');
      if (!row || !selected.has(row.dataset.path)) clearSelection();
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
    const pasteLabel = () => (clip.items.length === 1 ? baseName(clip.items[0].path) : `${clip.items.length} items`);
    const paste = (dir) => (clip ? [{ label: `Paste ${pasteLabel()}`, hint: 'Ctrl+V', run: () => pasteEntry(dir) }] : []);
    const create = (dir) => [
      { label: 'New file…', run: () => createEntry('file', dir) },
      { label: 'New folder…', run: () => createEntry('dir', dir) },
      { label: 'Upload files…', run: () => pickUpload(dir) },
      { label: 'Upload folder…', run: () => pickUpload(dir, true) },
    ];
    if (!row) return [...create(rootDir), ...paste(rootDir), '-', { label: 'Refresh', run: refreshTree }];

    const { path, type, dir, name, size } = row.dataset;
    const isFile = type === 'file';
    const inside = isFile ? dir : path;
    const items = selectionFor(path, type);
    if (items.length > 1) {
      const count = `${items.length} items`;
      return [
        { label: `Cut ${count}`, hint: 'Ctrl+X', run: () => setClip(items, true) },
        { label: `Copy ${count}`, hint: 'Ctrl+C', run: () => setClip(items, false) },
        '-',
        { label: `Compress ${count}…`, run: () => compressEntries(items) },
        { label: `Move ${count} to trash`, hint: 'Del', danger: true, run: () => trashEntries(items) },
        '-',
        { label: 'Copy paths', run: () => copyText(items.map((item) => item.path).join('\n')) },
        { label: 'Clear selection', hint: 'Esc', run: clearSelection },
      ];
    }
    return [
      ...(isFile ? [
        { label: 'Open', run: () => openFile(dir, name, { size: Number(size) }) },
        { label: 'Open to the side', run: () => openFile(dir, name, { size: Number(size), side: true }) },
        '-',
      ] : []),
      ...create(inside),
      '-',
      { label: 'Cut', hint: 'Ctrl+X', run: () => setClip(items, true) },
      { label: 'Copy', hint: 'Ctrl+C', run: () => setClip(items, false) },
      ...paste(inside),
      { label: 'Duplicate…', run: () => copyEntry(path, type, dir) },
      '-',
      { label: 'Rename…', hint: 'F2', run: () => renameEntry(path, type) },
      { label: 'Permissions…', run: () => chmodEntry(path, type) },
      { label: 'Move to trash', hint: 'Del', danger: true, run: () => trashEntries(items) },
      '-',
      ...(isFile ? [{ label: 'Download', run: () => downloadEntry(dir, name) }] : []),
      { label: 'Compress…', run: () => compressEntries(items) },
      ...(isFile && ARCHIVE.test(name) ? [{ label: 'Extract here…', run: () => extractEntry(path) }] : []),
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
    relocate(path, joinPath(dir, name), type);
    refreshDir(dir);
    setMessage(`Renamed ${old} to ${name}.`, 'ok');
  }

  // After a rename or a move: points open tabs, expanded folders and caches at the new path.
  function relocate(path, target, type) {
    const moved = (p) => p === path || isInside(p, path);
    const movedPath = (p) => target + p.slice(path.length);
    for (const tab of tabs.filter((t) => moved(t.path))) {
      // Drafts follow the file to its new name.
      quiet(db.deleteDraft(fileKey(tab.path)));
      tab.path = movedPath(tab.path);
      tab.dir = parentOf(tab.path);
      tab.file = baseName(tab.path);
      if (type === 'file' && !tab.image) monaco.editor.setModelLanguage(tab.model, guessLanguage(tab.file));
      if (isDirty(tab)) scheduleDraft(tab);
    }
    for (const p of [...expanded].filter(moved)) {
      expanded.delete(p);
      expanded.add(movedPath(p));
    }
    for (const p of [...listings.keys()].filter(moved)) listings.delete(p);
    if (lastTreeRow && moved(lastTreeRow.path)) lastTreeRow = null;
    if (clip?.items.some((item) => moved(item.path))) clip = null;
    dropSearchCache(path);
    updateChrome();
    saveSession();
  }

  // ---- Copy, move, permissions, archives ----

  function setClip(items, cut) {
    clip = { items, cut };
    renderTree();
    const what = items.length === 1 ? baseName(items[0].path) : `${items.length} items`;
    setMessage(`${cut ? 'Cut' : 'Copied'} ${what}. Paste into a folder with Ctrl+V or the right-click menu.`);
  }

  async function pasteEntry(destDir) {
    if (!clip) return;
    const { items, cut } = clip;
    if (cut) {
      clip = null;
      await moveEntries(items, destDir);
    } else {
      // One after another: a copy whose name is taken stops to ask for a new one.
      for (const item of items) await copyEntry(item.path, item.type, destDir);
      clearSelection();
    }
  }

  // "logo.png" becomes "logo-copy.png", then "logo-copy2.png".
  function copyName(name, type, entries) {
    const dot = type === 'file' ? name.lastIndexOf('.') : -1;
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; ; n++) {
      const candidate = `${stem}-copy${n > 1 ? n : ''}${ext}`;
      if (!entries.some((entry) => entry.name === candidate)) return candidate;
    }
  }

  async function copyEntry(path, type, destDir) {
    const name = baseName(path);
    if (destDir === path || isInside(destDir, path)) {
      setMessage('A folder can’t be copied into itself.', 'error');
      return;
    }
    const entries = await listDir(destDir).catch(() => []);
    let newName = name;
    // A copy next to the original, or where the name is taken, needs a name of its own.
    if (entries.some((entry) => entry.name === name)) {
      const suggestion = copyName(name, type, entries);
      const dot = type === 'file' ? suggestion.lastIndexOf('.') : -1;
      newName = await ask({
        title: `Copy ${name}`,
        text: `Into ${destDir}`,
        value: suggestion,
        select: dot > 0 ? [0, dot] : null,
        confirm: 'Copy',
        validate: (value) => validateName(value, destDir),
      });
      if (!newName) return;
    }
    setMessage(`Copying ${name}…`);
    try {
      await request({ op: 'copy', dir: parentOf(path), file: name, dest: destDir, newName: newName === name ? '' : newName });
    } catch (err) {
      setMessage(`Couldn't copy ${name}: ${err.message}`, 'error');
      return;
    }
    if (destDir !== rootDir) expanded.add(destDir);
    refreshDir(destDir);
    setMessage(`Copied ${name} to ${joinPath(destDir, newName)}.`, 'ok');
  }

  // `confirmFirst` is for drag and drop, where a slip of the mouse would move live files.
  async function moveEntries(items, destDir, confirmFirst = false) {
    const moving = items.filter((item) => parentOf(item.path) !== destDir);
    if (!moving.length) return;
    if (moving.some((item) => destDir === item.path || isInside(destDir, item.path))) {
      setMessage('A folder can’t be moved into itself.', 'error');
      return;
    }
    const what = moving.length === 1 ? baseName(moving[0].path) : `${moving.length} items`;
    const where = moving.length === 1 ? `From ${parentOf(moving[0].path)} to ${destDir}` : `To ${destDir}`;
    if (confirmFirst && !(await ask({ title: `Move ${what}?`, text: where, confirm: 'Move' }))) return;
    const failed = [];
    for (const { path, type } of moving) {
      const name = baseName(path);
      setMessage(`Moving ${name}…`);
      try {
        await request({ op: 'move', dir: parentOf(path), file: name, dest: destDir });
      } catch (err) {
        failed.push(`${name}: ${err.message}`);
        continue;
      }
      relocate(path, joinPath(destDir, name), type);
      listings.delete(parentOf(path));
    }
    clearSelection();
    if (failed.length < moving.length && destDir !== rootDir) expanded.add(destDir);
    refreshDir(destDir);
    if (failed.length) setMessage(`Couldn't move ${failed.join(' · ')}`, 'error');
    else setMessage(`Moved ${what} to ${destDir}.`, 'ok');
  }

  async function chmodEntry(path, type) {
    const dir = parentOf(path);
    const name = baseName(path);
    const current = listings.get(dir)?.entries.find((entry) => entry.name === name)?.mode || (type === 'dir' ? '0755' : '0644');
    const mode = await ask({
      title: `Permissions for ${name}`,
      text: 'One digit each for the owner, the group and everyone else: 4 = read, 2 = write, 1 = run, added together. Files are usually 644 and folders 755.',
      value: current,
      confirm: 'Change',
      validate: (value) => (/^[0-7]{3,4}$/.test(value) ? '' : 'Enter three or four digits from 0 to 7, such as 644.'),
    });
    if (!mode || mode === current) return;
    try {
      await request({ op: 'chmod', dir, file: name, mode });
    } catch (err) {
      setMessage(`Couldn't change the permissions of ${name}: ${err.message}`, 'error');
      return;
    }
    // Read the folder again so the new mode shows next time.
    listings.delete(dir);
    renderTree();
    setMessage(`Permissions of ${name} are now ${mode.padStart(4, '0')}.`, 'ok');
  }

  function archiveFormat(name) {
    return name.toLowerCase().match(/\.(zip|tar\.gz|tar\.bz2|tar)$/)?.[1] || '';
  }

  // One archive from one or more files and folders, which must sit in the same folder.
  async function compressEntries(items) {
    const dir = parentOf(items[0].path);
    if (items.some((item) => parentOf(item.path) !== dir)) {
      setMessage('To compress several items together, select items from one folder.', 'error');
      return;
    }
    const names = items.map((item) => baseName(item.path));
    const what = names.length === 1 ? names[0] : `${names.length} items`;
    const stem = names.length === 1 ? names[0] : baseName(dir);
    await listDir(dir).catch(() => {});
    const archive = await ask({
      title: `Compress ${what}`,
      text: `The archive is created in ${dir}. End its name with .zip, .tar.gz, .tar.bz2 or .tar to choose the format.`,
      value: `${stem}.zip`,
      select: [0, stem.length],
      confirm: 'Compress',
      validate: (value) => validateName(value, dir) || (archiveFormat(value) ? '' : 'End the name with .zip, .tar.gz, .tar.bz2 or .tar.'),
    });
    if (!archive) return;
    setMessage(`Compressing ${what}…`);
    try {
      await request({ op: 'compress', dir, file: names[0], files: names, newName: archive, format: archiveFormat(archive) });
    } catch (err) {
      setMessage(`Couldn't compress ${what}: ${err.message}`, 'error');
      return;
    }
    clearSelection();
    refreshDir(dir);
    setMessage(`Created ${archive}.`, 'ok');
  }

  async function extractEntry(path) {
    const dir = parentOf(path);
    const name = baseName(path);
    const ok = await ask({
      title: `Extract ${name}?`,
      text: `Its contents go into ${dir}. Files already there with the same names may be overwritten.`,
      confirm: 'Extract',
    });
    if (!ok) return;
    setMessage(`Extracting ${name}…`);
    try {
      await request({ op: 'extract', dir, file: name, dest: dir });
    } catch (err) {
      setMessage(`Couldn't extract ${name}: ${err.message}`, 'error');
      return;
    }
    refreshUnder(dir);
    setMessage(`Extracted ${name} into ${dir}.`, 'ok');
  }

  // ---- Upload and download ----

  function downloadEntry(dir, file) {
    request({ op: 'download', dir, file }).then(
      () => setMessage(`Downloading ${file}…`, 'ok'),
      (err) => setMessage(`Couldn't download ${file}: ${err.message}`, 'error'),
    );
  }

  function pickUpload(dir, folder = false) {
    if (!dir) return;
    uploadDir = dir;
    const input = folder ? ui.uploadFolderInput : ui.uploadInput;
    input.value = '';
    input.click();
  }

  // items: [{ file, sub }], where `sub` is the folder below `dir` the file goes into ('' for
  // none). `folders` lists folders to create even if they turn out to be empty.
  async function uploadItems(items, dir, folders = []) {
    if ((!items.length && !folders.length) || !dir) return;
    if (items.length > UPLOAD_MAX_FILES) {
      setMessage(`That's ${items.length.toLocaleString()} files. Upload up to ${UPLOAD_MAX_FILES.toLocaleString()} at a time, or zip the folder, upload the zip and use Extract here.`, 'error');
      return;
    }
    const top = (item) => (item.sub ? item.sub.split('/')[0] : item.file.name);
    const entries = await listDir(dir).catch(() => []);
    const wanted = new Set([...items.map(top), ...folders.map((sub) => sub.split('/')[0])]);
    const existing = new Set(entries.filter((entry) => wanted.has(entry.name)).map((entry) => entry.name));
    if (existing.size) {
      const names = [...existing];
      const ok = await ask({
        title: names.length === 1 ? `Replace ${names[0]}?` : `Replace ${names.length} items?`,
        text: `${dir} already has ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}. Files with the same names are replaced, and folders are merged.`,
        confirm: 'Replace',
        danger: true,
      });
      if (!ok) return;
    }

    // Folders first, parents before the folders inside them.
    const subs = new Set(folders);
    for (const item of items) {
      for (let sub = item.sub; sub; sub = sub.includes('/') ? sub.slice(0, sub.lastIndexOf('/')) : '') subs.add(sub);
    }
    try {
      for (const sub of [...subs].sort((a, b) => a.split('/').length - b.split('/').length)) {
        const path = joinPath(dir, sub);
        await request({ op: 'mkdir', dir: parentOf(path), file: baseName(path), existingOk: true });
      }
    } catch (err) {
      refreshUnder(dir);
      setMessage(`Couldn't create the folders for this upload: ${err.message}`, 'error');
      return;
    }

    const failed = [];
    const queue = items.slice();
    let started = 0;
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        const target = item.sub ? joinPath(dir, item.sub) : dir;
        setMessage(`Uploading ${item.file.name} (${++started} of ${items.length})…`);
        try {
          await request({ op: 'upload', dir: target, file: item.file.name, blob: item.file, overwrite: existing.has(top(item)) });
          dropSearchCache(joinPath(target, item.file.name));
        } catch (err) {
          failed.push(`${item.file.name}: ${err.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));

    if (dir !== rootDir) expanded.add(dir);
    refreshUnder(dir);
    const done = items.length - failed.length;
    const what = items.length === 1 && !subs.size ? items[0].file.name : `${done.toLocaleString()} file${done === 1 ? '' : 's'}${subs.size ? ` in ${subs.size} folder${subs.size === 1 ? '' : 's'}` : ''}`;
    if (failed.length) setMessage(`Uploaded ${done} of ${items.length}. ${failed.slice(0, 5).join(' · ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}`, 'error');
    else setMessage(`Uploaded ${what} to ${dir}.`, 'ok');
  }

  // Follows dropped folders through to the files in them.
  async function collectDropped(dropped) {
    const items = [];
    const folders = [];
    const visit = async (entry, sub) => {
      if (items.length > UPLOAD_MAX_FILES) return;
      if (entry.isFile) {
        items.push({ file: await new Promise((resolve, reject) => entry.file(resolve, reject)), sub });
        return;
      }
      const path = sub ? `${sub}/${entry.name}` : entry.name;
      folders.push(path);
      const reader = entry.createReader();
      for (;;) {
        // A folder's contents arrive in batches; an empty batch means that was all.
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, path);
      }
    };
    for (const entry of dropped) {
      if (!entry) continue;
      if (entry.isFile || entry.isDirectory) await visit(entry, '');
      else items.push({ file: entry, sub: '' });
    }
    return { items, folders };
  }

  // Files dragged in from the computer are uploaded; rows dragged inside the explorer are moved.
  function setupDragAndDrop() {
    let marked = null;
    const mark = (el) => {
      if (marked === el) return;
      marked?.classList.remove('drop-target');
      marked = el;
      marked?.classList.add('drop-target');
    };
    const hasFiles = (event) => event.dataTransfer.types.includes('Files');
    const accepts = (event) => Boolean(rootDir) && (Boolean(dragged) || hasFiles(event));
    // A drop on a file lands in the folder that file is in.
    const dropDir = (event) => {
      const row = event.target.closest?.('.row');
      if (!row) return rootDir;
      return row.dataset.type === 'dir' ? row.dataset.path : row.dataset.dir;
    };

    ui.tree.addEventListener('dragstart', (event) => {
      const row = event.target.closest?.('.row');
      if (!row) return;
      dragged = selectionFor(row.dataset.path, row.dataset.type);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.path);
    });
    ui.tree.addEventListener('dragend', () => {
      dragged = null;
      mark(null);
    });
    ui.tree.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragged ? 'move' : 'copy';
      const dir = dropDir(event);
      mark(dir === rootDir ? ui.tree : findRow(dir) || ui.tree);
    });
    ui.tree.addEventListener('dragleave', (event) => {
      if (!ui.tree.contains(event.relatedTarget)) mark(null);
    });
    ui.tree.addEventListener('drop', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      const dir = dropDir(event);
      mark(null);
      if (dragged) {
        const items = dragged;
        dragged = null;
        moveEntries(items, dir, true);
        return;
      }
      // The entries have to be taken now: the drop's data is gone once this handler returns.
      const dropped = [...event.dataTransfer.items]
        .filter((item) => item.kind === 'file')
        .map((item) => item.webkitGetAsEntry?.() || item.getAsFile());
      setMessage('Reading what you dropped…');
      collectDropped(dropped).then(
        ({ items, folders }) => uploadItems(items, dir, folders),
        (err) => setMessage(`Couldn't read what you dropped: ${err.message}`, 'error'),
      );
    });
    // Anywhere else, the browser would open a dropped file in place of the editor.
    for (const type of ['dragover', 'drop']) {
      window.addEventListener(type, (event) => {
        if (!hasFiles(event) || ui.tree.contains(event.target)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'none';
      });
    }
  }

  async function trashEntries(items) {
    const single = items.length === 1;
    const what = single ? baseName(items[0].path) : `${items.length} items`;
    const goes = single ? (items[0].type === 'dir' ? 'The folder and everything in it go' : 'It goes') : 'They go';
    const ok = await ask({
      title: `Move ${what} to the trash?`,
      text: `${goes} to your cPanel trash. You can restore ${single ? 'it' : 'them'} from File Manager with View Trash.`,
      confirm: 'Move to trash',
      danger: true,
    });
    if (!ok) return;
    const failed = [];
    for (const { path } of items) {
      const name = baseName(path);
      try {
        await request({ op: 'trash', dir: parentOf(path), file: name });
      } catch (err) {
        failed.push(`${name}: ${err.message}`);
        continue;
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
      if (clip?.items.some((item) => removed(item.path))) clip = null;
      dropSearchCache(path);
      listings.delete(parentOf(path));
    }
    clearSelection();
    forgetIndexCache();
    renderTree();
    if (failed.length) setMessage(`Couldn't move to the trash: ${failed.join(' · ')}`, 'error');
    else setMessage(`Moved ${what} to the trash.`, 'ok');
  }

  function refreshDir(dir) {
    listings.delete(dir);
    forgetIndexCache();
    renderTree();
  }

  // Forgets everything listed under a folder, after an operation that may have changed any of it.
  function refreshUnder(dir) {
    for (const p of [...listings.keys()]) {
      if (p === dir || isInside(p, dir)) listings.delete(p);
    }
    dropSearchCache(dir);
    forgetIndexCache();
    renderTree();
  }

  function refreshTree() {
    if (!rootDir) return;
    listings.clear();
    forgetIndexCache();
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

  // ---- Side pane: split editor, Markdown and SVG preview, pictures ----

  function setupSplit() {
    ui.splitBtn.addEventListener('click', toggleSplit);
    ui.previewBtn.addEventListener('click', togglePreview);
    ui.sideClose.addEventListener('click', () => closeSide());
    editor.onDidFocusEditorText(() => setSideFocus(false));
    // The preview follows the editor's scroll position, in proportion.
    editor.onDidScrollChange((event) => {
      if (!event.scrollTopChanged || split.mode !== 'preview' || split.tab !== active) return;
      const range = editor.getScrollHeight() - editor.getLayoutInfo().height;
      const pane = ui.sidePreview;
      pane.scrollTop = range > 0 ? (editor.getScrollTop() / range) * (pane.scrollHeight - pane.clientHeight) : 0;
    });
    editor.addAction({
      id: 'cpm.splitRight',
      label: 'View: Split Editor Right',
      run: () => active && openSide(active),
    });
    editor.addAction({
      id: 'cpm.openPreview',
      label: 'View: Open Preview to the Side (Markdown, SVG)',
      run: () => active && canPreview(active) && openSide(active, 'preview'),
    });
    editor.addAction({
      id: 'cpm.closeSide',
      label: 'View: Close Side Pane',
      run: () => closeSide(),
    });

    // Drag (or arrow keys on) the divider to resize the side pane.
    const resize = (percent) => {
      prefs.splitWidth = Math.round(Math.min(Math.max(percent, 20), 80));
      ui.side.style.width = `${prefs.splitWidth}%`;
    };
    ui.splitResizer.tabIndex = 0;
    onDrag(ui.splitResizer, (x) => {
      const rect = ui.stage.getBoundingClientRect();
      resize(((rect.right - x) / rect.width) * 100);
    }, savePrefs);
    ui.splitResizer.addEventListener('keydown', (event) => {
      const step = { ArrowLeft: 4, ArrowRight: -4 }[event.key];
      if (!step) return;
      event.preventDefault();
      resize(prefs.splitWidth + step);
      savePrefs();
    });
  }

  function canPreview(tab) {
    return !tab.image && PREVIEWABLE.test(tab.file);
  }

  function toggleSplit() {
    if (split.mode === 'editor') closeSide();
    else if (active) openSide(active);
  }

  function togglePreview() {
    if (split.mode === 'preview' && split.tab === active) closeSide();
    else if (active && canPreview(active)) openSide(active, 'preview');
  }

  function openSide(tab, mode = 'editor') {
    if (tab.image) mode = 'image';
    clearTimeout(split.timer);
    Object.assign(split, { tab, mode, timer: 0 });
    ui.side.hidden = false;
    ui.splitResizer.hidden = false;
    ui.side.style.width = `${prefs.splitWidth}%`;
    ui.sideEditor.hidden = mode !== 'editor';
    ui.sidePreview.hidden = mode !== 'preview';
    ui.sidePreview.replaceChildren();
    ui.sideViewer.hidden = true;
    if (mode === 'editor') {
      split.editor ||= createSideEditor();
      split.editor.setModel(tab.model);
      // Start where the main editor is when it shows the same file.
      if (tab === active) split.editor.restoreViewState(editor.saveViewState());
      split.editor.focus();
    } else {
      split.editor?.setModel(null);
      setSideFocus(false);
      if (mode === 'image') showImage(ui.sideViewer, tab);
      else renderPreview();
    }
    updateSideChrome();
    renderTabs();
  }

  function createSideEditor() {
    const side = monaco.editor.create(ui.sideEditor, {
      model: null,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      ...monacoOptions(),
    });
    side.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, toggleWrap);
    side.onDidFocusEditorText(() => setSideFocus(true));
    return side;
  }

  function closeSide(refocus = true) {
    if (!split.tab) return;
    clearTimeout(split.timer);
    Object.assign(split, { tab: null, mode: '', timer: 0 });
    split.images.clear();
    split.editor?.setModel(null);
    ui.sidePreview.replaceChildren();
    ui.sideViewer.replaceChildren();
    ui.side.hidden = true;
    ui.splitResizer.hidden = true;
    setSideFocus(false);
    updateSideChrome();
    renderTabs();
    if (refocus) editor?.focus();
  }

  // Save acts on the pane that was used last.
  function setSideFocus(focused) {
    split.focused = focused && split.mode === 'editor';
    ui.side.classList.toggle('focused', split.focused);
  }

  function focusedTab() {
    return split.focused && split.tab ? split.tab : active;
  }

  function updateSideChrome() {
    ui.splitBtn.disabled = !active;
    ui.splitBtn.setAttribute('aria-pressed', String(split.mode === 'editor'));
    ui.previewBtn.hidden = !(active && canPreview(active));
    ui.previewBtn.setAttribute('aria-pressed', String(split.mode === 'preview' && split.tab === active));
    const tab = split.tab;
    if (!tab) return;
    const name = document.createElement('span');
    name.textContent = tab.file;
    ui.sideName.replaceChildren(fileIcon(tab.file), name);
    ui.sideName.title = tab.path;
    ui.sideKind.textContent = split.mode === 'preview' ? 'Preview' : '';
  }

  function schedulePreview() {
    clearTimeout(split.timer);
    split.timer = setTimeout(renderPreview, 200);
  }

  function renderPreview() {
    split.timer = 0;
    const tab = split.tab;
    if (!tab || split.mode !== 'preview' || tab.model.isDisposed()) return;
    const pane = ui.sidePreview;
    const top = pane.scrollTop;
    const text = tab.model.getValue();
    const svg = /\.svg$/i.test(tab.file);
    pane.classList.toggle('svg', svg);
    if (svg) {
      // As an <img>, an SVG can't run scripts or load anything.
      const img = document.createElement('img');
      img.alt = tab.file;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      pane.replaceChildren(img);
    } else {
      pane.replaceChildren(window.CPM_MARKDOWN.render(text, {
        code: highlightCode,
        link: (link, href) => previewLink(link, href, tab),
        image: (src, alt) => previewImage(src, alt, tab),
      }));
    }
    pane.scrollTop = top;
  }

  // Fenced code in a preview is colored by Monaco, in the editor's theme.
  function highlightCode(code, name) {
    const languages = monaco.languages.getLanguages();
    const language = languages.find((l) => l.id === name || l.aliases?.some((alias) => alias.toLowerCase() === name))
      || languages.find((l) => l.extensions?.includes(`.${name}`));
    if (!language) return;
    monaco.editor.colorize(code.textContent, language.id, {}).then((html) => {
      code.innerHTML = html.replace(/<br\s*\/?>$/, '');
    }, () => {});
  }

  function safeDecode(text) {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  }

  // Resolves a relative link against a folder. Site-absolute paths and other schemes aren't followed.
  function resolvePath(dir, link) {
    const rel = link.replace(/[?#].*$/, '');
    if (!rel || rel.startsWith('/') || /^[a-z][\w+.-]*:/i.test(rel)) return null;
    const parts = dir.split('/').filter(Boolean);
    for (const part of safeDecode(rel).split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return `/${parts.join('/')}`;
  }

  function previewLink(link, href, tab) {
    if (/^(https?:|mailto:)/i.test(href)) {
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return;
    }
    link.title = href;
    if (href.startsWith('#')) {
      const wanted = safeDecode(href.slice(1)).toLowerCase();
      link.classList.add('local');
      link.addEventListener('click', () => {
        [...ui.sidePreview.querySelectorAll('[data-slug]')].find((heading) => heading.dataset.slug === wanted)?.scrollIntoView();
      });
      return;
    }
    // A link to another file in the project opens it in the editor.
    const path = resolvePath(tab.dir, href);
    if (!path) return;
    link.classList.add('local');
    link.addEventListener('click', () => openFile(parentOf(path), baseName(path)));
  }

  // Pictures next to the file are fetched through cPanel. Pictures on other servers can't be
  // shown: this page is blocked from the network, which is what keeps your code private.
  function previewImage(src, alt, tab) {
    const img = document.createElement('img');
    img.alt = alt;
    if (/^data:image\//i.test(src)) {
      img.src = src;
      return img;
    }
    const path = resolvePath(tab.dir, src);
    if (!path || !IMAGE_TYPES[extensionOf(path.toLowerCase())]) {
      const note = document.createElement('span');
      note.className = 'missing';
      note.textContent = `[image: ${alt || src}]`;
      note.title = src;
      return note;
    }
    let loading = split.images.get(path);
    if (!loading) {
      loading = loadImage(parentOf(path), baseName(path)).then((image) => image.url);
      split.images.set(path, loading);
    }
    loading.then((url) => {
      img.src = url;
    }, () => {
      img.alt = `${alt || src} (couldn’t be loaded)`;
    });
    return img;
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
    ui.replaceInput.addEventListener('input', renderSearchResults);
    ui.replaceInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      replaceAll();
    });
    ui.replaceAll.addEventListener('click', replaceAll);
    ui.searchResults.addEventListener('click', (event) => {
      const line = event.target.closest('.sr-line');
      if (line) {
        const { group, match } = search.matchList[Number(line.dataset.index)];
        // With something to replace with, a click shows what the file would become, as in VS Code.
        if (ui.replaceInput.value) previewReplace(group);
        else openFile(group.dir, group.file, { line: match.line, column: match.column, length: match.length });
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
    search.matcher = null;
    search.limited = false;
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
    search.matcher = matcher;
    search.regex = isPressed(ui.searchRegex);

    setSearchStatus(`Listing files in ${baseName(rootDir)}…`);
    wantAllFiles();
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
    await Promise.all(Array.from({ length: 6 }, worker));
    if (generation !== search.generation) return;

    search.limited = full || candidates.length > files.length || quick.truncated;
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
    const { content } = await request({ op: 'read', dir: item.dir, file: item.file }, { background: true });
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
    const replacing = Boolean(ui.replaceInput.value) && Boolean(search.matcher);
    ui.replaceAll.disabled = !search.groups.length;
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
        const found = match.text.substr(startAt, match.length);
        const after = match.text.slice(startAt + match.length, startAt + match.length + 120);
        if (replacing) {
          const gone = document.createElement('del');
          gone.textContent = found;
          const added = document.createElement('ins');
          added.textContent = replaceIn(found, match.text, startAt);
          row.append(before, gone, added, after);
        } else {
          const mark = document.createElement('mark');
          mark.textContent = found;
          row.append(before, mark, after);
        }
        rows.append(row);
      }
    }
    ui.searchResults.replaceChildren(rows);
  }

  // ---- Replace in files ----

  // "$1" and "$&" in the replacement stand for parts of the match, in regular expression mode only.
  function expandReplacement(template, groups) {
    if (!search.regex) return template;
    return template.replace(/\$(\$|&|\d{1,2})/g, (whole, key) => {
      if (key === '$') return '$';
      if (key === '&') return groups[0];
      return Number(key) < groups.length ? groups[Number(key)] ?? '' : whole;
    });
  }

  // Replaces every match in `text`, line by line like the search itself. With `line` and `at`
  // it instead returns what the single match `text`, found at `at` in `line`, turns into.
  function replaceIn(text, line = null, at = 0) {
    const matcher = search.matcher;
    const template = ui.replaceInput.value;
    const swap = (...args) => {
      // Empty matches aren't listed by the search, so they aren't replaced either.
      if (!args[0]) return args[0];
      return expandReplacement(template, args.slice(0, args.findIndex((arg, i) => i > 0 && typeof arg === 'number')));
    };
    if (line !== null) {
      matcher.lastIndex = at;
      const found = matcher.exec(line);
      return found && found.index === at ? swap(...found, found.index) : template;
    }
    return text.replace(/[^\r\n]+/g, (one) => one.replace(matcher, swap));
  }

  async function previewReplace(group) {
    const tab = tabs.find((t) => t.path === group.path);
    let text;
    try {
      text = tab ? tab.model.getValue() : (await request({ op: 'read', dir: group.dir, file: group.file })).content;
    } catch (err) {
      setMessage(`Couldn't read ${group.file}: ${err.message}`, 'error');
      return;
    }
    openDiff({
      title: `Replace in ${group.file}`,
      legend: 'Left: now · Right: after replacing',
      original: text,
      modified: replaceIn(text),
      readOnly: true,
      language: guessLanguage(group.file),
      actions: [
        { label: 'Replace in this file', primary: true, run: () => { closeDiff(); replaceGroups([group]); } },
        { label: 'Open file', run: () => { closeDiff(false); openFile(group.dir, group.file); } },
        { label: 'Close', run: () => closeDiff() },
      ],
    });
  }

  async function replaceAll() {
    const groups = search.groups.slice();
    if (!search.matcher || !groups.length) return;
    const template = ui.replaceInput.value;
    const ok = await ask({
      title: `Replace in ${groups.length} file${groups.length === 1 ? '' : 's'}?`,
      text: `Every match of “${ui.searchInput.value}” becomes ${template ? `“${template}”` : 'nothing (the matches are deleted)'}. `
        + 'Files that are open are changed in the editor and left for you to save. The others are saved to the server right away, '
        + 'and each one’s previous version is kept in its History.'
        + (search.limited ? ' The search stopped early, so run Replace all again afterwards to catch the rest.' : ''),
      confirm: 'Replace',
      danger: true,
    });
    if (ok) replaceGroups(groups);
  }

  async function replaceGroups(groups) {
    if (!search.matcher) return;
    let written = 0;
    let edited = 0;
    const failed = [];
    for (const [index, group] of groups.entries()) {
      setSearchStatus(`Replacing… ${index + 1} of ${groups.length} file${groups.length === 1 ? '' : 's'}`);
      const tab = tabs.find((t) => t.path === group.path);
      try {
        if (tab) {
          const text = tab.model.getValue();
          const replaced = replaceIn(text);
          if (replaced !== text) {
            replaceContent(tab, replaced);
            edited++;
          }
          continue;
        }
        // Read again just before writing, so a file that changed since the search isn't clobbered.
        const { content, charset } = await request({ op: 'read', dir: group.dir, file: group.file });
        const replaced = replaceIn(content);
        if (replaced === content) continue;
        await request({ op: 'write', dir: group.dir, file: group.file, content: replaced, charset });
        updateSearchCache(group.path, replaced);
        if (phpIndex.promise && /\.php$/i.test(group.file)) window.CPM_PHP_INDEX.update(group.path, replaced);
        await recordHistory({ path: group.path, openedAt: Date.now(), historyStarted: false }, content, replaced);
        written++;
      } catch (err) {
        failed.push(`${group.file}: ${err.message}`);
      }
    }
    const parts = [];
    if (written) parts.push(`saved ${written} file${written === 1 ? '' : 's'} to the server`);
    if (edited) parts.push(`changed ${edited} open file${edited === 1 ? '' : 's'}, not saved yet`);
    const summary = parts.length ? `Replaced: ${parts.join(' and ')}.` : 'Nothing was replaced.';
    await runSearch();
    if (failed.length) setMessage(`${summary} Failed: ${failed.slice(0, 5).join(' · ')}`, 'error');
    else setMessage(summary, 'ok');
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
    if (bytes < 1024) return `${bytes} bytes`;
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
    ui.theme.value = settings.get('workbench.colorTheme');
    ui.theme.addEventListener('change', () => {
      settings.setEffective('workbench.colorTheme', ui.theme.value);
      editor?.focus();
    });
  }

  function resolveTheme() {
    const choice = settings.get('workbench.colorTheme');
    const id = choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice;
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
    if (active.image) {
      ui.cursor.textContent = '';
      return;
    }
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
    const defaults = { theme: 'system', wrap: false, trustDismissed: false, sidebar: true, sidebarWidth: 240, splitWidth: 50 };
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
