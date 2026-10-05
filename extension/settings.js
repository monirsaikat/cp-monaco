// User settings: the list of settings (a schema, in VS Code's naming), and where their values live.
//
// Values are layered: built-in default < "User" (this browser) < "Server" (just this cPanel host).
// Only values that differ from the default are stored, in localStorage, so the stored data stays
// small and a reset really restores the default. editor.js turns changes into Monaco options.
(() => {
  'use strict';

  const STORAGE_KEY = 'cpm-settings';
  const CODE_FONT = '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace';

  // The tree shown on the left of the settings page. Items name a leaf (or top-level) id in `group`.
  const TREE = [
    { id: 'common', label: 'Commonly Used' },
    {
      id: 'editor',
      label: 'Text Editor',
      children: [
        { id: 'editor.font', label: 'Font' },
        { id: 'editor.cursor', label: 'Cursor' },
        { id: 'editor.formatting', label: 'Formatting' },
        { id: 'editor.display', label: 'Display' },
        { id: 'editor.suggestions', label: 'Suggestions' },
      ],
    },
    {
      id: 'workbench',
      label: 'Workbench',
      children: [
        { id: 'workbench.appearance', label: 'Appearance' },
        { id: 'workbench.explorer', label: 'Explorer' },
      ],
    },
    { id: 'files', label: 'Files' },
    {
      id: 'features',
      label: 'Features',
      children: [
        { id: 'features.php', label: 'PHP' },
        { id: 'features.emmet', label: 'Emmet' },
      ],
    },
  ];

  const enumOf = (...values) => values.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));

  // type: boolean | number | string | enum. `common` also lists it under "Commonly Used".
  const SCHEMA = [
    // ---- Font ----
    { key: 'editor.fontSize', group: 'editor.font', category: 'Editor', name: 'Font Size', type: 'number', default: 14, min: 8, max: 40, integer: true, common: 3, description: 'Controls the font size in pixels.' },
    { key: 'editor.fontFamily', group: 'editor.font', category: 'Editor', name: 'Font Family', type: 'string', default: CODE_FONT, common: 7, description: 'Controls the font family. Fonts must be installed on your computer.' },
    { key: 'editor.fontLigatures', group: 'editor.font', category: 'Editor', name: 'Font Ligatures', type: 'boolean', default: false, description: 'Enables font ligatures, such as `=>` and `!==` drawn as single symbols, in fonts that have them (for example Fira Code).' },
    { key: 'editor.fontWeight', group: 'editor.font', category: 'Editor', name: 'Font Weight', type: 'enum', default: 'normal', options: enumOf('normal', 'bold', '300', '400', '500', '600', '700'), description: 'Controls the font weight.' },
    { key: 'editor.lineHeight', group: 'editor.font', category: 'Editor', name: 'Line Height', type: 'number', default: 0, min: 0, max: 100, integer: true, description: 'Controls the line height in pixels. Use 0 to compute it from the font size.' },

    // ---- Cursor ----
    { key: 'editor.cursorStyle', group: 'editor.cursor', category: 'Editor', name: 'Cursor Style', type: 'enum', default: 'line', options: enumOf('line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'), description: 'Controls the cursor style.' },
    { key: 'editor.cursorBlinking', group: 'editor.cursor', category: 'Editor', name: 'Cursor Blinking', type: 'enum', default: 'blink', options: enumOf('blink', 'smooth', 'phase', 'expand', 'solid'), description: 'Controls the cursor animation style.' },
    { key: 'editor.cursorSmoothCaretAnimation', group: 'editor.cursor', category: 'Editor', name: 'Cursor Smooth Caret Animation', type: 'enum', default: 'off', options: enumOf('off', 'explicit', 'on'), description: 'Controls whether the cursor glides between positions. "explicit" animates only when you move it with the keyboard.' },
    { key: 'editor.multiCursorModifier', group: 'editor.cursor', category: 'Editor', name: 'Multi Cursor Modifier', type: 'enum', default: 'alt', options: enumOf(['alt', 'Alt'], ['ctrlCmd', 'Ctrl / Cmd']), description: 'The modifier key to hold while clicking to add more cursors.' },

    // ---- Formatting & indentation ----
    { key: 'editor.tabSize', group: 'editor.formatting', category: 'Editor', name: 'Tab Size', type: 'number', default: 4, min: 1, max: 16, integer: true, common: 4, description: 'The number of spaces a tab is equal to. Ignored for a file when **Detect Indentation** finds its own.' },
    { key: 'editor.insertSpaces', group: 'editor.formatting', category: 'Editor', name: 'Insert Spaces', type: 'boolean', default: true, description: 'Insert spaces when pressing `Tab`. Ignored for a file when **Detect Indentation** finds its own.' },
    { key: 'editor.detectIndentation', group: 'editor.formatting', category: 'Editor', name: 'Detect Indentation', type: 'boolean', default: true, description: 'Work out **Tab Size** and **Insert Spaces** from the contents of each file when it opens.' },
    { key: 'editor.formatOnSave', group: 'editor.formatting', category: 'Editor', name: 'Format On Save', type: 'boolean', default: false, common: 2, description: 'Format a file on save. A formatter must be available for the language (PHP, JavaScript, TypeScript, JSON, HTML, CSS). Not applied by auto save after a delay.' },
    { key: 'editor.formatOnPaste', group: 'editor.formatting', category: 'Editor', name: 'Format On Paste', type: 'boolean', default: false, description: 'Format pasted content, where the language supports it.' },
    { key: 'editor.formatOnType', group: 'editor.formatting', category: 'Editor', name: 'Format On Type', type: 'boolean', default: false, description: 'Format a line after typing, where the language supports it.' },
    { key: 'editor.autoClosingBrackets', group: 'editor.formatting', category: 'Editor', name: 'Auto Closing Brackets', type: 'enum', default: 'languageDefined', options: enumOf(['always', 'Always'], ['languageDefined', 'Language defined'], ['beforeWhitespace', 'Before whitespace'], ['never', 'Never']), description: 'Controls whether the editor closes a bracket automatically after you type the opening one.' },
    { key: 'editor.autoClosingQuotes', group: 'editor.formatting', category: 'Editor', name: 'Auto Closing Quotes', type: 'enum', default: 'languageDefined', options: enumOf(['always', 'Always'], ['languageDefined', 'Language defined'], ['beforeWhitespace', 'Before whitespace'], ['never', 'Never']), description: 'Controls whether the editor closes a quote automatically after you type the opening one.' },
    { key: 'editor.autoIndent', group: 'editor.formatting', category: 'Editor', name: 'Auto Indent', type: 'enum', default: 'full', options: enumOf(['none', 'None'], ['keep', 'Keep'], ['brackets', 'Brackets'], ['advanced', 'Advanced'], ['full', 'Full']), description: 'Controls whether the editor indents lines automatically as you type, paste and move lines.' },

    // ---- Display ----
    { key: 'editor.wordWrap', group: 'editor.display', category: 'Editor', name: 'Word Wrap', type: 'enum', default: 'off', options: enumOf(['off', 'Off'], ['on', 'On'], ['wordWrapColumn', 'At the wrap column'], ['bounded', 'At the viewport or wrap column']), common: 5, description: 'Controls how lines wrap. The **Wrap** button in the toolbar (`Alt+Z`) switches between off and on.' },
    { key: 'editor.wordWrapColumn', group: 'editor.display', category: 'Editor', name: 'Word Wrap Column', type: 'number', default: 80, min: 1, max: 400, integer: true, description: 'The column at which lines wrap when **Word Wrap** is "At the wrap column" or "At the viewport or wrap column".' },
    { key: 'editor.lineNumbers', group: 'editor.display', category: 'Editor', name: 'Line Numbers', type: 'enum', default: 'on', options: enumOf(['on', 'On'], ['off', 'Off'], ['relative', 'Relative'], ['interval', 'Every 10 lines']), description: 'Controls the display of line numbers.' },
    { key: 'editor.minimap.enabled', group: 'editor.display', category: 'Editor', name: 'Minimap: Enabled', type: 'boolean', default: true, description: 'Show the minimap, a small overview of the file, at the right edge.' },
    { key: 'editor.renderWhitespace', group: 'editor.display', category: 'Editor', name: 'Render Whitespace', type: 'enum', default: 'selection', options: enumOf(['none', 'None'], ['boundary', 'Boundary'], ['selection', 'Selection'], ['trailing', 'Trailing'], ['all', 'All']), description: 'Controls how whitespace characters are rendered.' },
    { key: 'editor.renderLineHighlight', group: 'editor.display', category: 'Editor', name: 'Render Line Highlight', type: 'enum', default: 'line', options: enumOf('none', 'gutter', 'line', 'all'), description: 'Controls how the current line is highlighted.' },
    { key: 'editor.rulers', group: 'editor.display', category: 'Editor', name: 'Rulers', type: 'string', default: '', description: 'Vertical rulers at these columns, separated by commas, for example `80, 120`.' },
    { key: 'editor.bracketPairColorization.enabled', group: 'editor.display', category: 'Editor', name: 'Bracket Pair Colorization: Enabled', type: 'boolean', default: true, description: 'Color matching bracket pairs in different colors.' },
    { key: 'editor.matchBrackets', group: 'editor.display', category: 'Editor', name: 'Match Brackets', type: 'enum', default: 'always', options: enumOf(['always', 'Always'], ['near', 'Near'], ['never', 'Never']), description: 'Highlight the matching bracket.' },
    { key: 'editor.guides.indentation', group: 'editor.display', category: 'Editor', name: 'Guides: Indentation', type: 'boolean', default: true, description: 'Show vertical indentation guides.' },
    { key: 'editor.stickyScroll.enabled', group: 'editor.display', category: 'Editor', name: 'Sticky Scroll: Enabled', type: 'boolean', default: true, description: 'Keep the enclosing class or function header pinned at the top while you scroll.' },
    { key: 'editor.folding', group: 'editor.display', category: 'Editor', name: 'Folding', type: 'boolean', default: true, description: 'Allow collapsing blocks of code.' },
    { key: 'editor.smoothScrolling', group: 'editor.display', category: 'Editor', name: 'Smooth Scrolling', type: 'boolean', default: true, description: 'Animate scrolling.' },
    { key: 'editor.scrollBeyondLastLine', group: 'editor.display', category: 'Editor', name: 'Scroll Beyond Last Line', type: 'boolean', default: false, description: 'Allow scrolling past the last line.' },
    { key: 'editor.mouseWheelZoom', group: 'editor.display', category: 'Editor', name: 'Mouse Wheel Zoom', type: 'boolean', default: false, description: 'Change the font size with the mouse wheel while holding `Ctrl`.' },

    // ---- Suggestions ----
    { key: 'editor.quickSuggestions', group: 'editor.suggestions', category: 'Editor', name: 'Quick Suggestions', type: 'boolean', default: true, description: 'Show suggestions while you type, without pressing `Ctrl+Space`.' },
    { key: 'editor.suggestOnTriggerCharacters', group: 'editor.suggestions', category: 'Editor', name: 'Suggest On Trigger Characters', type: 'boolean', default: true, description: 'Show suggestions when you type a trigger character such as `.`, `->`, `::`, `<` or `$`.' },
    { key: 'editor.acceptSuggestionOnEnter', group: 'editor.suggestions', category: 'Editor', name: 'Accept Suggestion On Enter', type: 'enum', default: 'on', options: enumOf(['on', 'On'], ['smart', 'Smart'], ['off', 'Off']), description: 'Whether `Enter` accepts a suggestion, in addition to `Tab`. "Smart" accepts only when it changes the text.' },
    { key: 'editor.tabCompletion', group: 'editor.suggestions', category: 'Editor', name: 'Tab Completion', type: 'enum', default: 'on', options: enumOf(['on', 'On'], ['off', 'Off'], ['onlySnippets', 'Only snippets']), description: 'Whether `Tab` accepts the selected suggestion.' },
    { key: 'editor.snippetSuggestions', group: 'editor.suggestions', category: 'Editor', name: 'Snippet Suggestions', type: 'enum', default: 'inline', options: enumOf(['top', 'bottom', 'inline', 'none']), description: 'Controls whether snippets are shown with other suggestions, and how they are sorted.' },
    { key: 'editor.wordBasedSuggestions', group: 'editor.suggestions', category: 'Editor', name: 'Word Based Suggestions', type: 'enum', default: 'matchingDocuments', options: enumOf(['off', 'Off'], ['currentDocument', 'Current document'], ['matchingDocuments', 'Documents of the same language'], ['allDocuments', 'All open documents']), description: 'Offer words found in your open files as suggestions.' },
    { key: 'editor.suggest.preview', group: 'editor.suggestions', category: 'Editor', name: 'Suggest: Preview', type: 'boolean', default: true, description: 'Preview the selected suggestion in the editor as gray text.' },
    { key: 'editor.parameterHints.enabled', group: 'editor.suggestions', category: 'Editor', name: 'Parameter Hints: Enabled', type: 'boolean', default: true, description: 'Show a popup with parameter documentation while you type a function call, where the language provides it.' },

    // ---- Workbench ----
    { key: 'workbench.colorTheme', group: 'workbench.appearance', category: 'Workbench', name: 'Color Theme', type: 'enum', default: 'system', options: [], common: 6, description: 'The color theme of the editor and the toolbar around it. "Match system" follows your operating system\'s light or dark setting.' },
    { key: 'explorer.showHiddenFiles', group: 'workbench.explorer', category: 'Explorer', name: 'Show Hidden Files', type: 'boolean', default: true, description: 'Show files and folders whose names start with a dot, such as `.htaccess` and `.env`, in the explorer.' },

    // ---- Files ----
    { key: 'files.autoSave', group: 'files', category: 'Files', name: 'Auto Save', type: 'enum', default: 'off', options: enumOf(['off', 'Off'], ['afterDelay', 'After a delay'], ['onFocusChange', 'When the editor loses focus'], ['onWindowChange', 'When the window loses focus']), common: 1, description: 'Controls when files with unsaved changes are saved to the server. Auto save never overwrites a file that changed on the server meanwhile.' },
    { key: 'files.autoSaveDelay', group: 'files', category: 'Files', name: 'Auto Save Delay', type: 'number', default: 1000, min: 200, max: 600000, integer: true, description: 'Milliseconds to wait after you stop typing before saving, when **Auto Save** is "After a delay".' },
    { key: 'files.trimTrailingWhitespace', group: 'files', category: 'Files', name: 'Trim Trailing Whitespace', type: 'boolean', default: false, description: 'Remove spaces and tabs at the end of lines when saving.' },
    { key: 'files.insertFinalNewline', group: 'files', category: 'Files', name: 'Insert Final Newline', type: 'boolean', default: false, description: 'End the file with a newline when saving.' },

    // ---- Features ----
    { key: 'php.index.enabled', group: 'features.php', category: 'PHP', name: 'Index: Enabled', type: 'boolean', default: true, description: 'Read your project\'s PHP files in the background to complete classes, methods and properties across files. Only class and method names are kept, never file contents.' },
    { key: 'php.builtins.enabled', group: 'features.php', category: 'PHP', name: 'Built-in Docs: Enabled', type: 'boolean', default: true, description: 'Complete PHP\'s own functions, classes and constants, show their documentation on hover, and show parameter hints while you type a call. Loads about 1 MB of bundled data the first time you open a PHP file.' },
    { key: 'php.format.phpVersion', group: 'features.php', category: 'PHP', name: 'Format: PHP Version', type: 'enum', default: 'auto', options: enumOf(['auto', 'Detect from the file'], ['7.4', '7.4'], ['8.0', '8.0'], ['8.1', '8.1'], ['8.2', '8.2'], ['8.3', '8.3']), description: 'The PHP version the formatter writes for. "Detect" assumes PHP 8 only when the file already uses PHP 8 syntax, so older servers keep working.' },
    { key: 'emmet.enabled', group: 'features.emmet', category: 'Emmet', name: 'Enabled', type: 'boolean', default: true, description: 'Offer Emmet abbreviations (`ul>li*3`, `.card`, `m10`) in HTML, PHP, CSS, SCSS and Less files. `Tab` or `Enter` expands them.' },
  ];

  const byKey = new Map(SCHEMA.map((def) => [def.key, def]));

  let data = { user: {}, servers: {} };
  let server = '';
  const listeners = new Set();

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      data = {
        user: typeof parsed.user === 'object' && parsed.user ? parsed.user : {},
        servers: typeof parsed.servers === 'object' && parsed.servers ? parsed.servers : {},
      };
    } catch {
      data = { user: {}, servers: {} };
    }
    for (const scope of [data.user, ...Object.values(data.servers)]) {
      for (const key of Object.keys(scope)) {
        if (!byKey.has(key) || sanitize(byKey.get(key), scope[key]) === undefined) delete scope[key];
      }
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Settings still apply for this visit; they just won't be remembered.
    }
  }

  // Returns the value in its proper type, or undefined when it isn't acceptable.
  function sanitize(def, value) {
    switch (def.type) {
      case 'boolean':
        return typeof value === 'boolean' ? value : undefined;
      case 'number': {
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
        if (def.integer && !Number.isInteger(n)) return undefined;
        if (n < def.min || n > def.max) return undefined;
        return n;
      }
      case 'string':
        return typeof value === 'string' ? value : undefined;
      case 'enum':
        return def.options.length === 0 || def.options.some((o) => o.value === value) ? value : undefined;
      default:
        return undefined;
    }
  }

  const scopeData = (scope, create = false) => {
    if (scope === 'user') return data.user;
    if (!server) return {};
    if (create && !data.servers[server]) data.servers[server] = {};
    return data.servers[server] || {};
  };

  function emit(keys) {
    for (const listener of [...listeners]) listener(keys);
  }

  const api = {
    schema: SCHEMA,
    tree: TREE,
    codeFont: CODE_FONT,
    def: (key) => byKey.get(key),

    // Fills in the options of "Color Theme" once the theme list is known.
    setThemes(themes) {
      const def = byKey.get('workbench.colorTheme');
      def.options = [{ value: 'system', label: 'Match system' }, ...themes.map((t) => ({ value: t.id, label: `${t.label} (${t.mode})` }))];
    },

    setServer(host) {
      if (host === server) return;
      server = host;
      emit(SCHEMA.map((def) => def.key));
    },
    get server() { return server; },

    // The value in effect: server, else user, else the default.
    get(key) {
      const def = byKey.get(key);
      const own = scopeData('server')[key];
      if (own !== undefined) return own;
      const user = data.user[key];
      return user !== undefined ? user : def.default;
    },

    // The value stored in one scope, or undefined when that scope leaves it at the default.
    stored: (scope, key) => scopeData(scope)[key],
    isModified: (scope, key) => scopeData(scope)[key] !== undefined,

    // Returns true when the value was accepted. A value equal to the default is removed, not stored.
    set(scope, key, value) {
      const def = byKey.get(key);
      const clean = def && sanitize(def, value);
      if (clean === undefined) return false;
      const target = scopeData(scope, true);
      if (scope === 'user' && clean === def.default) delete target[key];
      else target[key] = clean;
      save();
      emit([key]);
      return true;
    },

    // For controls in the toolbar: write where the value currently comes from.
    setEffective(key, value) {
      return api.set(api.isModified('server', key) ? 'server' : 'user', key, value);
    },

    reset(scope, key) {
      delete scopeData(scope, true)[key];
      save();
      emit([key]);
    },

    resetAll(scope) {
      const target = scopeData(scope, true);
      const keys = Object.keys(target);
      for (const key of keys) delete target[key];
      save();
      emit(keys);
    },

    modifiedKeys: (scope) => Object.keys(scopeData(scope)),

    exportJSON: (scope) => JSON.stringify(scopeData(scope), null, 2),

    // Replaces a scope with the settings in `text`; returns how many were accepted.
    importJSON(scope, text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object of settings.');
      const target = scopeData(scope, true);
      const before = Object.keys(target);
      for (const key of before) delete target[key];
      let accepted = 0;
      for (const [key, value] of Object.entries(parsed)) {
        const def = byKey.get(key);
        const clean = def && sanitize(def, value);
        if (clean === undefined || (scope === 'user' && clean === def.default)) continue;
        target[key] = clean;
        accepted++;
      }
      save();
      emit([...new Set([...before, ...Object.keys(target)])]);
      return accepted;
    },

    // Used once: carry over the theme and word wrap choices made before settings existed.
    migrate(prefs) {
      if (localStorage.getItem(STORAGE_KEY) !== null) return;
      if (prefs.theme && prefs.theme !== 'system') data.user['workbench.colorTheme'] = prefs.theme;
      if (prefs.wrap) data.user['editor.wordWrap'] = 'on';
      save();
    },

    sanitize: (key, value) => sanitize(byKey.get(key), value),

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  load();
  // Another editor tab changed a setting: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    load();
    emit(SCHEMA.map((def) => def.key));
  });

  window.CPM_SETTINGS = api;
})();
