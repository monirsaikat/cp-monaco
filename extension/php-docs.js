// PHP's built-in functions, classes and constants with documentation (data/php-stubs.js, generated
// by scripts/build-php-stubs.js from JetBrains' phpstorm-stubs, Apache-2.0).
//
// The data is about 1 MB, so nothing is loaded until a PHP file is opened, and then in one go while
// the browser is idle. Until it arrives, completion falls back to a short built-in list.
(() => {
  'use strict';

  const MANUAL = 'https://www.php.net/manual/en/';
  let data = null;
  let enabled = true;
  let loading = null;
  let lowerFunctions = null;
  let lowerClasses = null;
  let functionList = null;
  const classCache = new Map();

  function load() {
    if (data) return Promise.resolve(data);
    loading ||= new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'data/php-stubs.js';
      script.onload = () => {
        data = window.CPM_PHP_STUBS || null;
        resolve(data);
      };
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
    return loading;
  }

  // False while the data hasn't arrived, or when the "Built-in docs" setting is off.
  const ready = () => enabled && data !== null;
  function setEnabled(value) {
    enabled = Boolean(value);
    if (enabled) load();
  }

  function lowerMap(object) {
    const map = new Map();
    for (const key of Object.keys(object)) map.set(key.toLowerCase(), key);
    return map;
  }

  // ---- lookups (PHP names are case-insensitive) ----

  function fn(name) {
    if (!ready()) return null;
    const clean = name.replace(/^\\/, '');
    if (data.f[clean]) return { name: clean, entry: data.f[clean] };
    lowerFunctions ||= lowerMap(data.f);
    const key = lowerFunctions.get(clean.toLowerCase());
    return key ? { name: key, entry: data.f[key] } : null;
  }

  function rawClass(name) {
    if (!ready()) return null;
    const clean = name.replace(/^\\/, '');
    if (data.c[clean]) return { name: clean, raw: data.c[clean] };
    lowerClasses ||= lowerMap(data.c);
    const key = lowerClasses.get(clean.toLowerCase());
    return key ? { name: key, raw: data.c[key] } : null;
  }

  const KINDS = { c: 'class', i: 'interface', t: 'trait', e: 'enum' };

  // A built-in class in the same shape the project index uses, so member completion works on it.
  function stubClass(name) {
    const found = rawClass(name);
    if (!found) return null;
    if (classCache.has(found.name)) return classCache.get(found.name);
    const { raw } = found;
    const members = [];
    for (const [n, m] of Object.entries(raw.m || {})) {
      members.push({ n, k: 'm', v: m.v === 'o' ? 'protected' : 'public', s: m.f === 's' ? 1 : 0, sig: m.s, t: m.t || '' });
    }
    for (const [n, p] of Object.entries(raw.p || {})) {
      members.push({ n, k: 'p', v: p.v === 'o' ? 'protected' : 'public', s: p.f === 's' ? 1 : 0, t: p.t || '' });
    }
    for (const n of Object.keys(raw.c || {})) members.push({ n, k: raw.k === 'e' ? 'e' : 'c', v: 'public', s: 1 });
    const cls = {
      n: found.name.split('\\').pop(),
      f: found.name,
      k: KINDS[raw.k] || 'class',
      x: raw.x || '',
      i: raw.i || [],
      t: [],
      m: members,
      stub: true,
    };
    classCache.set(found.name, cls);
    return cls;
  }

  const constant = (name) => (ready() && Object.prototype.hasOwnProperty.call(data.k, name) ? data.k[name] : null);

  // ---- lists for completion ----

  function splitParams(sig) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < sig.length; i++) {
      const c = sig[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) {
        out.push(sig.slice(start, i).trim());
        start = i + 1;
      }
    }
    if (sig.slice(start).trim()) out.push(sig.slice(start).trim());
    return out;
  }

  // Parameters that must be given: no default value and not variadic.
  function requiredNames(sig) {
    return splitParams(sig)
      .filter((p) => !p.includes('=') && !p.includes('...'))
      .map((p) => (p.match(/\$(\w+)/) || [])[1])
      .filter(Boolean);
  }

  function functions() {
    if (!ready()) return [];
    functionList ||= Object.entries(data.f)
      .filter(([name]) => !name.includes('\\'))
      .map(([name, entry]) => ({ name, sig: entry.s, ret: entry.t || '', required: requiredNames(entry.s) }));
    return functionList;
  }

  const classNames = () => (ready() ? Object.keys(data.c) : []);

  let constantList = null;
  function constantEntries() {
    if (!ready()) return [];
    constantList ||= Object.entries(data.k);
    return constantList;
  }

  // ---- Markdown for hovers and the completion details panel ----

  const code = (text) => `\`\`\`php\n${text}\n\`\`\``;
  const manual = (path) => (path ? `\n\n[PHP manual](${MANUAL}${path})` : '');

  function paramDocs(entry) {
    const params = splitParams(entry.s || '');
    const lines = [];
    params.forEach((p, i) => {
      const text = entry.p && entry.p[i];
      const name = (p.match(/\$(\w+)/) || [])[1];
      if (name && text) lines.push(`- \`$${name}\` — ${text}`);
    });
    return lines.length ? `\n\n**Parameters**\n${lines.join('\n')}` : '';
  }

  function functionMarkdown(name, entry) {
    const deprecated = entry.x ? '**Deprecated.** ' : '';
    return `${code(`function ${name}(${entry.s})${entry.t ? `: ${entry.t}` : ''}`)}\n${deprecated}${entry.d || ''}${paramDocs(entry)}${entry.r ? `\n\n**Returns** ${entry.r}` : ''}${manual(entry.l)}`;
  }

  function methodMarkdown(className, name, entry, isStatic) {
    return `${code(`${isStatic ? 'static ' : ''}function ${className.split('\\').pop()}${isStatic ? '::' : '->'}${name}(${entry.s})${entry.t ? `: ${entry.t}` : ''}`)}\n${entry.d || ''}${paramDocs(entry)}${entry.r ? `\n\n**Returns** ${entry.r}` : ''}${manual(entry.l)}`;
  }

  function classMarkdown(name, raw) {
    const kind = KINDS[raw.k] || 'class';
    const extend = raw.x ? ` extends ${raw.x}` : '';
    const implement = raw.i && raw.i.length ? ` ${kind === 'interface' ? 'extends' : 'implements'} ${raw.i.join(', ')}` : '';
    return `${code(`${kind} ${name}${extend}${implement}`)}\n${raw.d || ''}${manual(raw.l)}`;
  }

  window.CPM_PHP_DOCS = {
    load,
    ready,
    setEnabled,
    fn,
    stubClass,
    rawClass,
    constant,
    functions,
    classNames,
    constantEntries,
    splitParams,
    requiredNames,
    functionMarkdown,
    methodMarkdown,
    classMarkdown,
    manualUrl: (path) => `${MANUAL}${path}`,
    get version() { return data ? data.v : ''; },
  };
})();
