// Builds extension/data/php-stubs.js: PHP's built-in functions, classes and constants with
// signatures and short documentation, taken from JetBrains' phpstorm-stubs (Apache-2.0).
//
//   node scripts/build-php-stubs.js [path-to-phpstorm-stubs]
//
// The result is committed, so normal builds and releases never need this script or the network.
// Run it again only to update the stubs. Without a path it clones the pinned tag below.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TAG = 'v2026.2';
const TARGET = [8, 4]; // PHP version the signatures describe
// The extensions most PHP sites use. Exotic ones would only add weight.
const EXTENSIONS = [
  'Core', 'standard', 'SPL', 'date', 'json', 'mbstring', 'ctype', 'pcre', 'filter', 'hash', 'random',
  'Reflection', 'PDO', 'mysqli', 'curl', 'gd', 'fileinfo', 'openssl', 'session', 'SimpleXML', 'dom', 'xml',
  'libxml', 'zip', 'intl', 'bcmath', 'iconv', 'tokenizer', 'zlib', 'sodium', 'exif', 'ftp', 'xmlreader',
  'xmlwriter', 'calendar', 'gettext', 'sockets', 'gmp', 'posix',
];

global.window = {};
require('../extension/php-symbols.js');
const { mask } = window.CPM_PHP_SYMBOLS;

// ---- small helpers ----

const versionOf = (text) => String(text).split('.').map(Number);
function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function matching(code, open, openChar, closeChar) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === openChar) depth++;
    else if (code[i] === closeChar && --depth === 0) return i;
  }
  return code.length - 1;
}

// Splits at top-level commas, returning [start, end) pairs.
function splitTop(code, from, to) {
  const out = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      out.push([start, i]);
      start = i + 1;
    }
  }
  if (code.slice(start, to).trim()) out.push([start, to]);
  return out;
}

function entities(text) {
  return text
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// PHPDoc from the stubs is half HTML; turn it into short Markdown.
function clean(text) {
  let out = entities(text)
    .replace(/\{@(?:link|see)\s+([^}\s]+)(?:\s+([^}]*))?\}/g, (m, target, label) => (label || target).trim())
    .replace(/<\/?(?:p|div|ul|ol|table|tr|td|th|thead|tbody|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(?:b|strong)>/gi, '**')
    .replace(/<\/?(?:i|em)>/gi, '*')
    .replace(/<\/?(?:code|tt|kbd)>/gi, '`')
    .replace(/<[^>]+>/g, '');
  out = entities(out).trim()
    .replace(/^\((?:PHP|PECL)[^)]*\)\s*/i, '')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

const flat = (text) => text.replace(/\s+/g, ' ').trim();

// int<0, max> and array<string, int> read better as int and array in a signature.
function simplifyType(type) {
  let t = type.trim();
  let previous;
  do {
    previous = t;
    t = t.replace(/<[^<>]*>/g, '');
  } while (t !== previous);
  return t.replace(/\s+/g, '').replace(/^\\/, '');
}

// ---- doc blocks and attributes ----

function parseDoc(raw) {
  if (!raw) return { desc: '', params: {}, ret: null, link: '', removed: null, deprecated: false };
  const body = raw
    .replace(/^\s*\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join('\n');
  const tagStart = body.search(/^@\w+/m);
  const description = tagStart === -1 ? body : body.slice(0, tagStart);
  const tags = tagStart === -1 ? '' : body.slice(tagStart);

  const params = {};
  for (const m of tags.matchAll(/@param[ \t]+(\S+)[ \t]+(?:&?\.{0,3}\$(\w+))[ \t]*([\s\S]*?)(?=\n@\w+|$)/g)) {
    params[m[2]] = { type: m[1], desc: shorten(flat(clean(m[3])).replace(/^\[optional\]\s*/i, ''), 130) };
  }
  const ret = /@return[ \t]+(\S+)[ \t]*([\s\S]*?)(?=\n@\w+|$)/.exec(tags);
  const link = /@link\s+(\S+)/.exec(tags);
  const removed = /@removed\s+([\d.]+)/.exec(tags);
  return {
    desc: shorten(clean(description), 260),
    params,
    ret: ret ? { type: ret[1], desc: shorten(flat(clean(ret[2])).replace(/^@\w+.*$/, ''), 110) } : null,
    link: link ? link[1] : '',
    removed: removed ? removed[1] : null,
    deprecated: /@deprecated\b/.test(tags),
  };
}

// The part of the manual's address after /manual/en/, which is all the editor needs.
function manualPath(link) {
  const m = /php\.net\/manual\/en\/([^\s#?]+)/.exec(link || '');
  return m ? m[1] : '';
}

function attributesIn(code, original, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    const at = code.indexOf('#[', i);
    if (at === -1 || at >= to) break;
    const end = matching(code, at + 1, '[', ']');
    out.push(original.slice(at + 2, end));
    i = end + 1;
  }
  return out;
}

function stripAttributes(code, original, from, to) {
  let out = '';
  let i = from;
  while (i < to) {
    const at = code.indexOf('#[', i);
    if (at === -1 || at >= to) break;
    out += original.slice(i, at);
    i = matching(code, at + 1, '[', ']') + 1;
  }
  return out + original.slice(i, to);
}

function availableIn(attrs) {
  for (const attr of attrs) {
    const m = /PhpStormStubsElementAvailable\(([^)]*)\)/.exec(attr);
    if (!m) continue;
    const args = m[1];
    const from = /from:\s*'([\d.]+)'/.exec(args) || /^\s*'([\d.]+)'/.exec(args);
    const to = /to:\s*'([\d.]+)'/.exec(args);
    if (from && compareVersions(versionOf(from[1]), TARGET) > 0) return false;
    if (to && compareVersions(versionOf(to[1]), TARGET) < 0) return false;
  }
  return true;
}

// #[LanguageLevelTypeAware(['8.0' => 'string'], default: '')] -> the type for PHP 8.4.
function typeFromAttributes(attrs) {
  for (const attr of attrs) {
    if (!attr.includes('LanguageLevelTypeAware')) continue;
    let best = null;
    for (const m of attr.matchAll(/'([\d.]+)'\s*=>\s*'([^']*)'/g)) {
      if (compareVersions(versionOf(m[1]), TARGET) <= 0 && (!best || compareVersions(versionOf(m[1]), versionOf(best.v)) > 0)) best = { v: m[1], t: m[2] };
    }
    if (best) return best.t;
    const fallback = /default:\s*'([^']*)'/.exec(attr);
    return fallback ? fallback[1] : null;
  }
  return null;
}

// ---- one declaration ----

function parseParams(code, original, open, close, doc) {
  const out = [];
  for (const [start, end] of splitTop(code, open + 1, close)) {
    const attrs = attributesIn(code, original, start, end);
    if (!availableIn(attrs)) continue;
    const text = stripAttributes(code, original, start, end).trim();
    const m = /^([^$&.]*?)\s*(&)?\s*(\.\.\.)?\s*\$(\w+)\s*(?:=\s*([\s\S]+))?$/.exec(text);
    if (!m) continue;
    const [, written, byRef, variadic, name, def] = m;
    const type = typeFromAttributes(attrs) ?? (written.trim() || (doc.params[name] ? simplifyType(doc.params[name].type) : ''));
    let fallback = def ? flat(def) : '';
    if (fallback.length > 36) fallback = `${fallback.slice(0, 33)}...`;
    out.push({ name, text: `${type ? `${simplifyType(type)} ` : ''}${byRef ? '&' : ''}${variadic ? '...' : ''}$${name}${fallback ? ` = ${fallback}` : ''}` });
  }
  return out;
}

function callable(code, original, match, doc, leadingAttrs, paramsOpen) {
  const close = matching(code, paramsOpen, '(', ')');
  const params = parseParams(code, original, paramsOpen, close, doc);
  const after = /^\s*(?::\s*([^{;]+?))?\s*(?:\{|;)/.exec(code.slice(close + 1, close + 200));
  const written = after && after[1] ? after[1].trim() : '';
  const type = typeFromAttributes(leadingAttrs) ?? (written || (doc.ret ? simplifyType(doc.ret.type) : ''));
  const entry = { s: params.map((p) => p.text).join(', ') };
  if (type) entry.t = simplifyType(type);
  if (doc.desc) entry.d = doc.desc;
  const paramDocs = params.map((p) => (doc.params[p.name] ? doc.params[p.name].desc : ''));
  if (paramDocs.some(Boolean)) entry.p = paramDocs;
  if (doc.ret && doc.ret.desc) entry.r = doc.ret.desc;
  const link = manualPath(doc.link);
  if (link) entry.l = link;
  if (doc.deprecated) entry.x = 1;
  return { entry, end: close };
}

// PHP_EXTENSION_DIR, PHP_OS and friends depend on the machine; the stub author's values would mislead.
function constantValue(name, text) {
  const value = flat(text);
  if (name === 'E_ALL') return '32767'; // the stubs still carry the PHP 5 value
  if (value.length > 24) return '';
  if (/^PHP_/.test(name) && name !== 'PHP_EOL' && /^["']/.test(value)) return '';
  return value;
}

// ---- one file ----

function leading(code, original, index) {
  let start = index;
  while (start > 0 && !';{}'.includes(code[start - 1])) start--;
  return { start, text: original.slice(start, index), masked: code.slice(start, index) };
}

function docAndAttrs(code, original, index) {
  const lead = leading(code, original, index);
  const blocks = [...lead.text.matchAll(/\/\*\*[\s\S]*?\*\//g)];
  const doc = parseDoc(blocks.length ? blocks[blocks.length - 1][0] : '');
  const attrs = attributesIn(lead.masked, lead.text, 0, lead.text.length);
  return { doc, attrs };
}

const usable = (doc, attrs) => availableIn(attrs) && !(doc.removed && compareVersions(versionOf(doc.removed), TARGET) <= 0);

function parseFile(file, out) {
  const original = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const code = mask(original);

  // namespaces: `namespace A;` runs to the next one, `namespace A { … }` to its brace.
  const spaces = [];
  for (const m of code.matchAll(/^namespace\s*([\w\\]*)\s*([;{])/gm)) {
    const end = m[2] === '{' ? matching(code, m.index + m[0].length - 1, '{', '}') : Infinity;
    if (spaces.length && spaces[spaces.length - 1].end === Infinity) spaces[spaces.length - 1].end = m.index;
    spaces.push({ start: m.index, end, name: m[1] });
  }
  const namespaceAt = (i) => (spaces.find((s) => i >= s.start && i < s.end) || {}).name || '';

  // classes
  const ranges = [];
  const header = /\b(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+(\w+)([^{;]*)\{/g;
  let m;
  while ((m = header.exec(code))) {
    const bodyStart = m.index + m[0].length - 1;
    const bodyEnd = matching(code, bodyStart, '{', '}');
    ranges.push({ index: m.index, kind: m[1], name: m[2], rest: m[3], bodyStart, bodyEnd });
    header.lastIndex = bodyEnd;
  }
  const insideClass = (i) => ranges.some((r) => i > r.bodyStart && i < r.bodyEnd);

  // global functions
  const fnRe = /((?:(?:public|protected|private|static|abstract|final)\s+)*)function\s+&?\s*(\w+)\s*\(/g;
  while ((m = fnRe.exec(code))) {
    if (insideClass(m.index)) continue;
    const { doc, attrs } = docAndAttrs(code, original, m.index);
    if (!usable(doc, attrs)) continue;
    const ns = namespaceAt(m.index);
    const { entry } = callable(code, original, m, doc, attrs, m.index + m[0].length - 1);
    out.f[ns ? `${ns}\\${m[2]}` : m[2]] = entry;
  }

  // constants
  for (const c of original.matchAll(/^define\s*\(\s*(['"])(\w+)\1\s*,\s*([^;]*?)\)\s*;/gm)) {
    if (code[c.index] !== 'd') continue;
    out.k[c[2]] = constantValue(c[2], c[3]);
  }
  for (const c of code.matchAll(/^const\s+(\w+)\s*=/gm)) {
    if (insideClass(c.index)) continue;
    const end = original.indexOf(';', c.index);
    out.k[c[1]] = constantValue(c[1], original.slice(c.index + c[0].length, end));
  }

  // classes and their members
  for (const range of ranges) {
    const { doc, attrs } = docAndAttrs(code, original, range.index);
    if (!usable(doc, attrs)) continue;
    const ns = namespaceAt(range.index);
    const name = ns ? `${ns}\\${range.name}` : range.name;
    const cls = { k: range.kind[0] };
    const resolve = (n) => n.trim().replace(/^\\/, '');
    const ext = /\bextends\s+([\w\\,\s]+?)(?=\bimplements\b|$)/.exec(range.rest);
    if (ext) {
      const names = ext[1].split(',').map(resolve).filter(Boolean);
      if (range.kind === 'interface') cls.i = names;
      else cls.x = names[0];
    }
    const impl = /\bimplements\s+([\w\\,\s]+)/.exec(range.rest);
    if (impl) cls.i = [...(cls.i || []), ...impl[1].split(',').map(resolve).filter(Boolean)];
    if (doc.desc) cls.d = doc.desc;
    const link = manualPath(doc.link);
    if (link) cls.l = link;
    if (doc.deprecated) cls.x2 = 1;

    // Only text directly inside the class counts as members.
    const body = code.slice(range.bodyStart + 1, range.bodyEnd);
    const base = range.bodyStart + 1;
    let depth = 0;
    const top = [...body].map((c) => {
      if (c === '{') return depth++ === 0 ? c : ' ';
      if (c === '}') return --depth === 0 ? c : ' ';
      return depth === 0 || c === '\n' ? c : ' ';
    }).join('');

    const methods = {};
    const methodRe = /((?:(?:public|protected|private|static|abstract|final)\s+)*)function\s+&?\s*(\w+)\s*\(/g;
    let mm;
    while ((mm = methodRe.exec(top))) {
      if (/\bprivate\b/.test(mm[1])) continue;
      const at = base + mm.index;
      const member = docAndAttrs(code, original, at);
      if (!usable(member.doc, member.attrs)) continue;
      const { entry } = callable(code, original, mm, member.doc, member.attrs, base + mm.index + mm[0].length - 1);
      if (/\bstatic\b/.test(mm[1])) entry.f = 's';
      if (/\bprotected\b/.test(mm[1])) entry.v = 'o';
      if (/\babstract\b/.test(mm[1])) entry.a = 1;
      methods[mm[2]] = entry;
    }
    if (Object.keys(methods).length) cls.m = methods;

    const props = {};
    const propRe = /((?:(?:public|protected|private|static|readonly|var)\s+)+)(\??[\w\\|&()]+\s+)?\$(\w+)/g;
    while ((mm = propRe.exec(top))) {
      if (/\bprivate\b/.test(mm[1])) continue;
      const at = base + mm.index;
      const member = docAndAttrs(code, original, at);
      if (!usable(member.doc, member.attrs)) continue;
      const written = (mm[2] || '').trim();
      const varDoc = /@var\s+(\S+)/.exec(original.slice(leading(code, original, at).start, at));
      const type = typeFromAttributes(member.attrs) ?? (written || (varDoc ? varDoc[1] : ''));
      const prop = {};
      if (type) prop.t = simplifyType(type);
      if (member.doc.desc) prop.d = member.doc.desc;
      if (/\bstatic\b/.test(mm[1])) prop.f = 's';
      if (/\bprotected\b/.test(mm[1])) prop.v = 'o';
      props[mm[3]] = prop;
    }
    if (Object.keys(props).length) cls.p = props;

    const constants = {};
    const constRe = /((?:(?:public|protected|private|final)\s+)*)const\s+(?:[\w\\?|]+\s+(?=\w+\s*=))?(\w+)\s*=/g;
    while ((mm = constRe.exec(top))) {
      if (/\bprivate\b/.test(mm[1])) continue;
      const at = base + mm.index;
      const member = docAndAttrs(code, original, at);
      if (!usable(member.doc, member.attrs)) continue;
      const end = original.indexOf(';', base + mm.index + mm[0].length);
      const value = flat(original.slice(base + mm.index + mm[0].length, end));
      constants[mm[2]] = value.length > 24 ? '' : value;
    }
    if (range.kind === 'enum') for (const c of top.matchAll(/\bcase\s+(\w+)/g)) constants[c[1]] = '';
    if (Object.keys(constants).length) cls.c = constants;

    out.c[name] = cls;
  }
}

// ---- main ----

function main() {
  let root = process.argv[2];
  let temp = null;
  if (!root) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstubs-'));
    root = path.join(temp, 'stubs');
    console.log(`Cloning phpstorm-stubs ${TAG}…`);
    execFileSync('git', ['clone', '--depth', '1', '--branch', TAG, 'https://github.com/JetBrains/phpstorm-stubs', root], { stdio: 'inherit' });
  }

  const out = { f: {}, c: {}, k: {} };
  let files = 0;
  for (const extension of EXTENSIONS) {
    const dir = path.join(root, extension);
    if (!fs.existsSync(dir)) {
      console.warn(`Skipping missing extension folder: ${extension}`);
      continue;
    }
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.php') || name.startsWith('_')) continue;
      parseFile(path.join(dir, name), out);
      files++;
    }
  }

  const header = `// PHP ${TARGET.join('.')} built-in functions, classes and constants, generated by scripts/build-php-stubs.js\n`
    + `// from JetBrains/phpstorm-stubs ${TAG} (Apache License 2.0). See data/LICENSE-phpstorm-stubs.txt.\n`;
  const target = path.join(__dirname, '..', 'extension', 'data');
  fs.mkdirSync(target, { recursive: true });
  const body = `${header}window.CPM_PHP_STUBS=${JSON.stringify({ v: `${TARGET.join('.')} (phpstorm-stubs ${TAG})`, ...out })};\n`;
  fs.writeFileSync(path.join(target, 'php-stubs.js'), body);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'LICENSE-phpstorm-stubs.txt'));

  console.log(`${files} files -> ${Object.keys(out.f).length} functions, ${Object.keys(out.c).length} classes, ${Object.keys(out.k).length} constants`);
  console.log(`php-stubs.js: ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
}

main();
