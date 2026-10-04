// A small, forgiving PHP declaration scanner: classes, interfaces, traits and enums with their
// methods, properties, constants and cases, plus namespace and `use` imports. It is regex-based
// (no full parser), runs in a few milliseconds on typical files, and never throws on odd code.
(() => {
  'use strict';

  // Blanks out comments, strings, heredocs and inline HTML (keeping length and newlines), so
  // braces and keywords inside them can't confuse the scanner.
  function mask(text) {
    const out = text.split('');
    const n = text.length;
    const blank = (from, to) => {
      for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
    };
    let i = 0;
    let php = false;
    while (i < n) {
      if (!php) {
        const open = text.indexOf('<?', i);
        const end = open === -1 ? n : open;
        blank(i, end);
        if (open === -1) break;
        i = open + (text.startsWith('<?php', open) ? 5 : text.startsWith('<?=', open) ? 3 : 2);
        php = true;
        continue;
      }
      const c = text[i];
      const d = text[i + 1];
      if (c === '?' && d === '>') {
        php = false;
        i += 2;
      } else if (c === '/' && d === '*') {
        const end = text.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        blank(i, stop);
        i = stop;
      } else if ((c === '/' && d === '/') || (c === '#' && d !== '[')) {
        let stop = i;
        while (stop < n && text[stop] !== '\n' && !(text[stop] === '?' && text[stop + 1] === '>')) stop++;
        blank(i, stop);
        i = stop;
      } else if (c === '\'' || c === '"') {
        let stop = i + 1;
        while (stop < n && text[stop] !== c) stop += text[stop] === '\\' ? 2 : 1;
        blank(i + 1, Math.min(stop, n));
        i = stop + 1;
      } else if (c === '<' && text.startsWith('<<<', i)) {
        const head = /^<<<[ \t]*(['"]?)(\w+)\1\r?\n/.exec(text.slice(i, i + 80));
        if (head) {
          const close = new RegExp(`\\n[ \\t]*${head[2]}\\b`, 'g');
          close.lastIndex = i + head[0].length;
          const found = close.exec(text);
          const stop = found ? found.index : n;
          blank(i + head[0].length, stop);
          i = stop;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }
    return out.join('');
  }

  function matchingBrace(code, open) {
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) return i;
    }
    return code.length;
  }

  // Keeps only the text directly inside a class body, with nested { … } blocks emptied.
  function shallow(code) {
    let depth = 0;
    let out = '';
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (c === '{') {
        out += depth === 0 ? '{' : ' ';
        depth++;
      } else if (c === '}') {
        depth--;
        out += depth === 0 ? '}' : ' ';
      } else {
        out += depth === 0 || c === '\n' ? c : ' ';
      }
    }
    return out;
  }

  const BUILTIN_TYPES = new Set('string int float bool array callable iterable object mixed void null never false true self static parent'.split(' '));

  function parse(text) {
    const code = mask(text);
    const result = { ns: '', uses: {}, classes: [], useEnd: -1, nsEnd: -1, openEnd: -1 };

    const open = /<\?(?:php\b|=)?/.exec(text);
    if (open) result.openEnd = open.index + open[0].length;
    const nsMatch = /\bnamespace\s+([\w\\]+)\s*[;{]/.exec(code);
    if (nsMatch) {
      result.ns = nsMatch[1];
      result.nsEnd = nsMatch.index + nsMatch[0].length;
    }

    // Class bodies first: `use` inside them imports traits, not names.
    const ranges = [];
    const header = /\b(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+(\w+)([^{;]*)\{/g;
    let found;
    while ((found = header.exec(code))) {
      const [whole, kind, name, rest] = found;
      if (name === 'extends' || name === 'implements' || /\bnew\s+$/.test(code.slice(Math.max(0, found.index - 6), found.index))) continue;
      const bodyStart = found.index + whole.length - 1;
      const bodyEnd = matchingBrace(code, bodyStart);
      ranges.push({ kind, name, rest, bodyStart, bodyEnd });
      header.lastIndex = bodyEnd;
    }
    const insideClass = (index) => ranges.some((r) => index > r.bodyStart && index < r.bodyEnd);

    const useRe = /(^|[;{}\s])use\s+(function\s+|const\s+)?([^;()]+);/g;
    while ((found = useRe.exec(code))) {
      const at = found.index + found[1].length;
      if (insideClass(at)) continue;
      result.useEnd = Math.max(result.useEnd, found.index + found[0].length);
      if (found[2]) continue;
      const spec = found[3].trim();
      const group = /^([\w\\]+)\\\{([^}]*)\}$/.exec(spec.replace(/\s+/g, ' '));
      const entries = group ? group[2].split(',').map((part) => `${group[1]}\\${part.trim()}`) : spec.split(',');
      for (const entry of entries) {
        const m = /^\\?([\w\\]+)(?:\s+as\s+(\w+))?$/.exec(entry.trim());
        if (m) result.uses[m[2] || m[1].split('\\').pop()] = m[1];
      }
    }

    const resolve = (name) => {
      if (!name) return '';
      if (BUILTIN_TYPES.has(name.toLowerCase())) return name.toLowerCase();
      if (name.startsWith('\\')) return name.slice(1);
      const [first, ...tail] = name.split('\\');
      if (result.uses[first]) return [result.uses[first], ...tail].join('\\');
      return result.ns ? `${result.ns}\\${name}` : name;
    };
    result.resolve = resolve;

    for (const range of ranges) {
      const { kind, name, rest } = range;
      const cls = { n: name, f: result.ns ? `${result.ns}\\${name}` : name, k: kind, x: '', i: [], t: [], m: [], r: [range.bodyStart, range.bodyEnd] };
      const ext = /\bextends\s+([\w\\,\s]+?)(?=\bimplements\b|$)/.exec(rest);
      if (ext) {
        const names = ext[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (kind === 'interface') cls.i.push(...names.map(resolve));
        else cls.x = resolve(names[0]);
      }
      const impl = /\bimplements\s+([\w\\,\s]+)/.exec(rest);
      if (impl) cls.i.push(...impl[1].split(',').map((s) => resolve(s.trim())).filter(Boolean));

      const body = code.slice(range.bodyStart + 1, range.bodyEnd);
      const flat = shallow(body);
      const seen = new Set();
      const add = (member) => {
        const key = `${member.k}:${member.n}`;
        if (!seen.has(key)) {
          seen.add(key);
          cls.m.push(member);
        }
      };
      const visibility = (mods) => (/\bprivate\b/.test(mods) ? 'private' : /\bprotected\b/.test(mods) ? 'protected' : 'public');

      let m;
      const traitRe = /(?:^|[;{}\s])use\s+([\w\\,\s]+?)\s*(?:;|\{)/g;
      while ((m = traitRe.exec(flat))) cls.t.push(...m[1].split(',').map((s) => resolve(s.trim())).filter(Boolean));

      const fnRe = /((?:(?:public|protected|private|static|abstract|final)\s+)*)function\s+&?\s*(\w+)\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?::\s*(\??[\w\\|&]+))?/g;
      while ((m = fnRe.exec(flat))) {
        const params = m[3].replace(/\s+/g, ' ').trim();
        add({ n: m[2], k: 'm', v: visibility(m[1]), s: /\bstatic\b/.test(m[1]) ? 1 : 0, sig: params.length > 140 ? `${params.slice(0, 137)}...` : params, t: m[4] ? resolve(m[4].replace(/^\?/, '')) : '' });
        // Constructor promotion: `public function __construct(private Foo $bar)`.
        const promoted = /((?:(?:public|protected|private|readonly)\s+)+)(\??[\w\\|]+\s+)?\$(\w+)/g;
        let p;
        while (m[2] === '__construct' && (p = promoted.exec(params))) {
          add({ n: p[3], k: 'p', v: visibility(p[1]), s: 0, t: p[2] ? resolve(p[2].trim().replace(/^\?/, '')) : '' });
        }
      }

      const constRe = /((?:(?:public|protected|private|final)\s+)*)const\s+(?:[\w\\?|]+\s+(?=\w+\s*=))?(\w+)\s*=/g;
      while ((m = constRe.exec(flat))) add({ n: m[2], k: 'c', v: visibility(m[1]), s: 1 });

      const propRe = /((?:(?:public|protected|private|static|readonly|var)\s+)+)(\??[\w\\|&]+\s+)?\$(\w+)/g;
      while ((m = propRe.exec(flat))) {
        if (/^function\b/.test((m[2] || '').trim())) continue;
        add({ n: m[3], k: 'p', v: visibility(m[1]), s: /\bstatic\b/.test(m[1]) ? 1 : 0, t: m[2] ? resolve(m[2].trim().replace(/^\?/, '')) : '' });
      }

      if (kind === 'enum') {
        const caseRe = /\bcase\s+(\w+)\s*(?:=|;)/g;
        while ((m = caseRe.exec(flat))) add({ n: m[1], k: 'e', v: 'public', s: 1 });
      }

      // Eloquent models: attribute names listed in $fillable / $appends / $casts act as properties.
      const original = text.slice(range.bodyStart + 1, range.bodyEnd);
      const attrRe = /\$(fillable|appends|casts|hidden)\s*=\s*\[([\s\S]*?)\]\s*;/g;
      while ((m = attrRe.exec(original))) {
        const list = m[2];
        const names = m[1] === 'casts' ? [...list.matchAll(/['"](\w+)['"]\s*=>/g)] : m[1] === 'hidden' ? [] : [...list.matchAll(/['"](\w+)['"]/g)];
        for (const [, attr] of names) add({ n: attr, k: 'p', v: 'public', s: 0, t: '' });
      }

      result.classes.push(cls);
    }
    return result;
  }

  window.CPM_PHP_SYMBOLS = { parse, mask };
})();
