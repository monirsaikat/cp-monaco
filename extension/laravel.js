// Laravel name completion in PHP and Blade files: view names inside view('…') and
// @include('…'), route names inside route('…'), config keys inside config('…') and
// .env keys inside env('…').
//
// A Laravel project is recognized by its "artisan" file. View names come from the file list
// the editor already has; routes, config files and .env.example are read once per visit and
// only the names found in them are kept.
(() => {
  'use strict';

  const CONTEXTS = [
    ['view', /(?:\b(?:view|markdown)|View::(?:make|first|exists)|@(?:include(?:If)?|extends|component|each))\s*\(\s*['"]([\w.\-:/]*)$/],
    ['route', /\b(?:route|to_route|routeIs)\s*\(\s*['"]([\w.\-*]*)$/],
    ['config', /(?:\bconfig|Config::(?:get|set|has))\s*\(\s*['"]([\w.\-]*)$/],
    ['env', /\benv\s*\(\s*['"](\w*)$/],
  ];
  const RESOURCE_ACTIONS = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];

  // root -> { files, views, names: Promise<{ route, config, env }> }
  const projects = new Map();
  let host = null;

  // The closest folder above `path` that holds an "artisan" file.
  function findRoot(files, path) {
    let best = null;
    for (const item of files) {
      if (item.file === 'artisan' && path.startsWith(`${item.dir}/`) && (!best || item.dir.length > best.length)) best = item.dir;
    }
    return best;
  }

  function viewNames(files, root) {
    const base = `${root}/resources/views/`;
    const names = [];
    for (const item of files) {
      if (!item.file.endsWith('.blade.php') || !`${item.dir}/`.startsWith(base)) continue;
      const rel = `${item.dir}/${item.file}`.slice(base.length, -'.blade.php'.length);
      names.push(rel.replace(/\//g, '.'));
    }
    return names;
  }

  function routeNames(text) {
    const names = new Set();
    // A name ending in a dot is a group prefix, not a route.
    for (const m of text.matchAll(/->name\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!m[1].endsWith('.')) names.add(m[1]);
    }
    for (const m of text.matchAll(/Route::(api)?[rR]esource\(\s*['"]([^'"]+)['"]/g)) {
      const base = m[2].replace(/^\/+|\/+$/g, '').replace(/\//g, '.');
      for (const action of RESOURCE_ACTIONS) {
        if (!m[1] || (action !== 'create' && action !== 'edit')) names.add(`${base}.${action}`);
      }
    }
    return [...names];
  }

  // The keys of the array a config file returns, up to three levels: "driver", "mysql.host".
  function configKeys(text) {
    const keys = [];
    // Each open bracket: the key it is the value of, and whether it's an array (not a call).
    const stack = [];
    const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|=>|\barray\s*\(|[[\]()]/g;
    let previous = null;
    let key = null;
    let m;
    while ((m = tokens.exec(text))) {
      const token = m[0];
      if (token.startsWith('/') || token.startsWith('#')) continue;
      const string = m[1] ?? m[2];
      if (string !== undefined) {
        previous = string;
        continue;
      }
      if (token === '=>') {
        key = previous;
        if (key !== null && stack.length && stack.length <= 3 && stack.every((level, i) => level.array && (i === 0 || level.key !== null))) {
          keys.push([...stack.slice(1).map((level) => level.key), key].join('.'));
        }
      } else if (token === '[' || token.endsWith('(')) {
        stack.push({ key, array: token !== '(' });
        key = null;
      } else {
        stack.pop();
        key = null;
      }
      previous = null;
    }
    return keys;
  }

  function envKeys(text) {
    return [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
  }

  async function readNames(files, root) {
    const read = (item) => host.read(item.dir, item.file).catch(() => '');
    const inDir = (name) => files.filter((item) => item.file.endsWith('.php') && (item.dir === `${root}/${name}` || item.dir.startsWith(`${root}/${name}/`)));
    const route = new Set();
    const config = new Set();
    const env = new Set();
    await Promise.all([
      ...inDir('routes').map(async (item) => {
        for (const name of routeNames(await read(item))) route.add(name);
      }),
      ...inDir('config').map(async (item) => {
        const prefix = `${item.dir}/${item.file}`.slice(`${root}/config/`.length, -'.php'.length).replace(/\//g, '.');
        config.add(prefix);
        for (const key of configKeys(await read(item))) config.add(`${prefix}.${key}`);
      }),
      ...files.filter((item) => item.dir === root && (item.file === '.env.example' || item.file === '.env')).map(async (item) => {
        for (const key of envKeys(await read(item))) env.add(key);
      }),
    ]);
    return { route: [...route], config: [...config], env: [...env] };
  }

  async function namesFor(kind, path) {
    const files = await host.files();
    const root = findRoot(files, path);
    if (!root) return [];
    let project = projects.get(root);
    // A new file list means files were added or removed since.
    if (!project || project.files !== files) {
      project = { files, views: viewNames(files, root), names: project?.names || null };
      projects.set(root, project);
    }
    if (kind === 'view') return project.views;
    project.names ||= readNames(files, root);
    return (await project.names)[kind];
  }

  // Called after a save: routes, config and .env are read again the next time they're needed.
  function changed(path) {
    if (/\/(?:routes|config)\/.*\.php$|\/\.env(?:\.example)?$/.test(path)) {
      for (const project of projects.values()) project.names = null;
    }
  }

  function register(monaco, hostApi) {
    host = hostApi;
    const Kind = monaco.languages.CompletionItemKind;
    const kinds = { view: Kind.File, route: Kind.Reference, config: Kind.Property, env: Kind.Constant };
    const details = { view: 'Blade view', route: 'Route name', config: 'Config key', env: '.env key' };

    monaco.languages.registerCompletionItemProvider(['php', 'blade'], {
      triggerCharacters: ['\'', '"', '.'],
      async provideCompletionItems(model, position) {
        if (!host.enabled()) return { suggestions: [] };
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        let kind = '';
        let typed = '';
        for (const [name, pattern] of CONTEXTS) {
          const m = line.match(pattern);
          if (m) [kind, typed] = [name, m[1]];
        }
        const path = kind && host.pathOf(model);
        if (!path) return { suggestions: [] };
        const names = await namesFor(kind, path).catch(() => []);
        // Names contain dots and dashes, so replace everything typed since the quote.
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column,
        };
        return {
          suggestions: names.map((name) => ({
            label: name,
            kind: kinds[kind],
            insertText: name,
            detail: details[kind],
            sortText: `0${name}`,
            range,
          })),
        };
      },
    });
  }

  window.CPM_LARAVEL = { register, changed };
})();
