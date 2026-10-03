// Monaco UI that lives inside the extension iframe. It talks to content.js via
// postMessage: content.js owns the cPanel session and does the actual load/save.
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
    editor: $('editor'),
    overlay: $('overlay'),
    overlayText: $('overlay-text'),
    overlayClassic: $('overlay-classic'),
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

  const THEMES = window.CPM_THEMES;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  const prefs = loadPrefs();
  let editor = null;
  let model = null;
  let parentOrigin = null;
  let savedVersion = 0;
  let saving = false;
  let lastDirty = false;

  setupThemePicker();
  applyTheme();
  setupTrust();
  ui.wrap.setAttribute('aria-pressed', String(prefs.wrap));
  darkQuery.addEventListener('change', () => {
    if (prefs.theme === 'system') applyTheme();
  });

  // Monaco's default worker setup uses blob: URLs for chrome-extension:// pages, which the
  // extension CSP blocks. Point it at the bundled worker file instead (same origin, allowed).
  self.MonacoEnvironment = {
    getWorkerUrl: () => 'monaco/vs/base/worker/workerMain.js',
  };

  require.config({ paths: { vs: 'monaco/vs' } });
  require(['vs/editor/editor.main'], init, (err) => {
    showOverlay(`Monaco failed to load.\n${err?.message || err}`, true);
  });

  function init() {
    // Files are edited standalone, so imports/globals can't be resolved. Only report syntax errors.
    const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics);
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics);

    for (const theme of THEMES) {
      if (theme.palette) monaco.editor.defineTheme(monacoThemeId(theme), buildMonacoTheme(theme));
    }

    editor = monaco.editor.create(ui.editor, {
      theme: monacoThemeId(resolveTheme()),
      automaticLayout: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
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

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, toggleWrap);
    editor.onDidChangeCursorPosition(updateCursor);
    editor.onDidChangeCursorSelection(updateCursor);

    const languages = monaco.languages.getLanguages()
      .map((lang) => ({ id: lang.id, label: lang.aliases?.[0] || lang.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    for (const lang of languages) ui.language.add(new Option(lang.label, lang.id));

    ui.language.addEventListener('change', () => {
      if (model) monaco.editor.setModelLanguage(model, ui.language.value);
    });
    ui.wrap.addEventListener('click', toggleWrap);
    ui.save.addEventListener('click', save);
    ui.classic.addEventListener('click', backToClassic);
    ui.overlayClassic.addEventListener('click', () => send({ type: 'classic' }));

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

    switch (msg.type) {
      case 'load':
        parentOrigin = event.origin;
        openFile(msg);
        break;
      case 'error':
        parentOrigin = event.origin;
        showOverlay(`Couldn't load this file.\n${msg.message}`, true);
        break;
      case 'saved':
        saving = false;
        if (msg.ok) {
          savedVersion = msg.version;
          setMessage(`Saved at ${new Date().toLocaleTimeString()}`, 'ok');
        } else {
          setMessage(`Save failed: ${msg.error}`, 'error');
        }
        updateDirty();
        break;
    }
  }

  function send(message) {
    if (parentOrigin) window.parent.postMessage({ source: 'cpm', ...message }, parentOrigin);
  }

  function openFile({ content, file, path, charset }) {
    const language = guessLanguage(file);
    model?.dispose();
    model = monaco.editor.createModel(content, language, monaco.Uri.file(path));
    model.onDidChangeContent(updateDirty);
    editor.setModel(model);
    savedVersion = model.getAlternativeVersionId();

    document.title = file;
    ui.name.textContent = file;
    // LRM marks keep slashes in place while the RTL trick truncates the start of long paths.
    ui.path.textContent = `‎${path}‎`;
    ui.path.title = path;
    ui.language.value = language;
    ui.language.disabled = false;
    ui.charset.textContent = charset.toUpperCase();
    ui.eol.textContent = model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
    hideOverlay();
    updateDirty();
    updateCursor();
    editor.focus();
  }

  function guessLanguage(file) {
    const lower = file.toLowerCase();
    const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    if (lower.startsWith('.env')) return 'ini';
    if (LANGUAGE_OVERRIDES[ext]) return LANGUAGE_OVERRIDES[ext];

    const languages = monaco.languages.getLanguages();
    const byName = languages.find((l) => l.filenames?.some((n) => n.toLowerCase() === lower));
    if (byName) return byName.id;
    const byExt = ext && languages.find((l) => l.extensions?.includes(`.${ext}`));
    return byExt ? byExt.id : 'plaintext';
  }

  function isDirty() {
    return Boolean(model) && model.getAlternativeVersionId() !== savedVersion;
  }

  function updateDirty() {
    const dirty = isDirty();
    ui.dirty.hidden = !dirty;
    ui.save.disabled = !model || saving;
    if (dirty !== lastDirty) {
      lastDirty = dirty;
      send({ type: 'dirty', dirty });
    }
  }

  function save() {
    if (!model || saving) return;
    saving = true;
    updateDirty();
    setMessage('Saving…');
    send({ type: 'save', content: model.getValue(), version: model.getAlternativeVersionId() });
  }

  function backToClassic() {
    if (isDirty() && !confirm('You have unsaved changes in Monaco. Discard them and switch to the cPanel editor?')) return;
    send({ type: 'classic' });
  }

  function toggleWrap() {
    prefs.wrap = !prefs.wrap;
    savePrefs();
    editor.updateOptions({ wordWrap: prefs.wrap ? 'on' : 'off' });
    ui.wrap.setAttribute('aria-pressed', String(prefs.wrap));
  }

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
    root.dataset.mode = theme.mode;
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
    if (!model) return;
    const pos = editor.getPosition();
    const selection = editor.getSelection();
    const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection).length : 0;
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
    const defaults = { theme: 'system', wrap: false, trustDismissed: false };
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
