// Completion that needs to know about other files: members after -> and ::, class names with
// automatic `use` imports, and `use` statements. It resolves what is left of the operator through
// variable types (new Foo, type hints, @var), $this/self/parent and method or property chains,
// using the project index (php-index.js) plus the classes in the file being edited.
(() => {
  'use strict';

  const BARE = new Set(['int', 'float', 'string', 'bool', 'array', 'void', 'null', 'mixed', 'callable', 'iterable', 'object', 'never', 'false', 'true']);
  const parsedCache = new WeakMap();
  let kinds = null;
  let snippetRule = 0;

  const index = () => window.CPM_PHP_INDEX;

  function init(monaco) {
    kinds = monaco.languages.CompletionItemKind;
    snippetRule = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }

  // The file being edited, parsed again only when its text changes.
  function parsed(model) {
    const version = model.getVersionId();
    let entry = parsedCache.get(model);
    if (!entry || entry.version !== version) {
      entry = { version, doc: window.CPM_PHP_SYMBOLS.parse(model.getValue()) };
      parsedCache.set(model, entry);
    }
    return entry.doc;
  }

  function classKind(cls) {
    return cls.k === 'interface' ? kinds.Interface : cls.k === 'enum' ? kinds.Enum : kinds.Class;
  }

  function methodSnippet(member) {
    const params = member.sig ? member.sig.split(/,(?![^([]*[)\]])/) : [];
    const names = params
      .map((p) => p.trim())
      .filter((p) => p && !p.includes('=') && !p.includes('...'))
      .map((p) => (p.match(/\$(\w+)/) || [])[1])
      .filter(Boolean);
    if (!names.length) return `${member.n}($0)`;
    return `${member.n}(${names.map((name, i) => '${' + (i + 1) + ':\\$' + name + '}').join(', ')})`;
  }

  // Where a new "use" line goes: after the last import, else after the namespace, else after <?php.
  function importEdit(model, doc, fqn) {
    const at = doc.useEnd !== -1 ? doc.useEnd : doc.nsEnd !== -1 ? doc.nsEnd : doc.openEnd;
    if (at === -1) return [];
    const pos = model.getPositionAt(at);
    const gap = doc.useEnd !== -1 ? '\n' : '\n\n';
    return [{
      range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
      text: `${gap}use ${fqn};`,
    }];
  }

  // Classes from other files in the project; picking one also adds the "use" import.
  function classSuggestions(model, range) {
    const idx = index();
    if (range.endColumn - range.startColumn < 1) return [];
    const doc = parsed(model);
    const imported = new Set(Object.values(doc.uses).map((f) => f.toLowerCase()));
    const local = new Set(doc.classes.map((c) => c.f.toLowerCase()));
    const out = [];
    for (const cls of idx.all()) {
      const fqn = cls.f.toLowerCase();
      if (local.has(fqn)) continue;
      const namespaced = cls.f.includes('\\');
      const needsImport = namespaced && !imported.has(fqn) && cls.f.slice(0, cls.f.lastIndexOf('\\')) !== doc.ns;
      out.push({
        label: { label: cls.n, description: cls.f },
        kind: classKind(cls),
        insertText: cls.n,
        range,
        sortText: `2${cls.n}`,
        additionalTextEdits: needsImport ? importEdit(model, doc, cls.f) : [],
      });
    }
    // PHP's own classes (Exception, DateTime, PDO...), documented lazily when one is highlighted.
    const docs = window.CPM_PHP_DOCS;
    if (docs && docs.ready()) {
      for (const name of docs.classNames()) {
        const lower = name.toLowerCase();
        if (local.has(lower)) continue;
        const short = name.split('\\').pop();
        const namespaced = name.includes('\\');
        const raw = docs.rawClass(name).raw;
        const needsImport = namespaced && !imported.has(lower) && name.slice(0, name.lastIndexOf('\\')) !== doc.ns;
        out.push({
          label: { label: short, description: namespaced ? name : '' },
          kind: raw.k === 'i' ? kinds.Interface : raw.k === 'e' ? kinds.Enum : kinds.Class,
          insertText: short,
          range,
          sortText: `3${short}`,
          additionalTextEdits: needsImport ? importEdit(model, doc, name) : [],
          _doc: ['c', name],
        });
      }
    }
    return out;
  }

  // use App\Models\Us…  (an import at the top of the file)
  function importSuggestions(line, position, range) {
    const m = /^\s*use\s+(?:function\s+|const\s+)?([\w\\]*)$/.exec(line);
    if (!m) return null;
    const importRange = { ...range, startColumn: position.column - m[1].length };
    const docs = window.CPM_PHP_DOCS;
    const builtIn = docs && docs.ready() ? docs.classNames().filter((name) => name.includes('\\')) : [];
    return [
      ...index().all().map((cls) => ({
        label: cls.f, kind: classKind(cls), insertText: cls.f, filterText: cls.f, range: importRange, sortText: cls.f,
      })),
      ...builtIn.map((name) => ({
        label: name, kind: kinds.Class, insertText: name, filterText: name, range: importRange, sortText: name, _doc: ['c', name],
      })),
    ];
  }

  // ---- What is on the left of -> or :: ----

  function firstType(raw) {
    return (raw || '').split(/[|&]/).map((t) => t.trim().replace(/^\?/, '')).find((t) => t && !BARE.has(t.toLowerCase())) || '';
  }

  function classAt(doc, offset) {
    return doc.classes.find((c) => offset > c.r[0] && offset <= c.r[1]) || null;
  }

  function classNamed(name, doc) {
    if (!name) return null;
    const lower = name.toLowerCase();
    const fqn = doc.resolve(name).toLowerCase();
    return doc.classes.find((c) => c.f.toLowerCase() === fqn || c.n.toLowerCase() === lower) || index().find(name, doc);
  }

  // Best guess at a variable's class from the text before the cursor.
  function variableType(name, text, offset) {
    const before = text.slice(Math.max(0, offset - 40000), offset);
    const n = name.slice(1);
    const cls = '([\\\\\\w]+)';
    const patterns = [
      new RegExp(`\\$${n}\\s*=\\s*new\\s+\\(?${cls}`, 'g'),
      new RegExp(`@var\\s+([\\\\\\w|?]+)\\s+\\$${n}\\b`, 'g'),
      new RegExp(`\\$${n}\\s*=\\s*${cls}::\\w+\\(`, 'g'),
      new RegExp(`[(,]\\s*(?:(?:public|protected|private|readonly)\\s+)*(\\??[\\\\\\w|]+)\\s+&?(?:\\.\\.\\.)?\\$${n}\\b`, 'g'),
    ];
    let best = null;
    for (const re of patterns) {
      let m;
      while ((m = re.exec(before))) {
        const type = firstType(m[1]);
        if (type && (!best || m.index > best.index)) best = { index: m.index, type };
      }
    }
    return best ? best.type : '';
  }

  // Follows a chain such as $this->user->posts() through property and return types.
  function resolveExpression(expr, ctx) {
    const head = /^(\$\w+|[\\\w]+)/.exec(expr);
    if (!head) return null;
    const word = head[1].toLowerCase();
    let cls;
    if (word === '$this' || word === 'self' || word === 'static') cls = ctx.current;
    else if (word === 'parent') cls = ctx.current && classNamed(ctx.current.x, ctx.doc);
    else if (head[1][0] === '$') cls = classNamed(variableType(head[1], ctx.text, ctx.offset), ctx.doc);
    else cls = classNamed(head[1], ctx.doc);

    let i = head[1].length;
    while (cls && i < expr.length) {
      const seg = /^(->|\?->|::)(\w+)/.exec(expr.slice(i));
      if (!seg) return null;
      i += seg[0].length;
      let isCall = false;
      if (expr[i] === '(') {
        isCall = true;
        let depth = 0;
        let k = i;
        for (; k < expr.length; k++) {
          if (expr[k] === '(') depth++;
          else if (expr[k] === ')' && --depth === 0) break;
        }
        i = k + 1;
      }
      const found = index().members(cls, ctx.doc.classes).find((m) => m.n === seg[2] && (isCall ? m.k === 'm' : m.k === 'p'));
      if (!found || !found.t) return null;
      cls = ['self', 'static', '$this'].includes(found.t) ? cls : classNamed(found.t, ctx.doc);
    }
    return cls || null;
  }

  // Suggestions after "->", "?->" or "::"; null when the cursor isn't after one.
  function member(model, position, line) {
    const tail = line.slice(-300);
    const m = /((?:\$\w+|[\\\w]+)(?:(?:->|\?->|::)\w+(?:\((?:[^()]|\([^()]*\))*\))?)*)(->|\?->|::)(\w*)$/.exec(tail);
    if (!m) return null;
    const [, expr, op, partial] = m;
    const doc = parsed(model);
    const offset = model.getOffsetAt(position);
    const current = classAt(doc, offset);
    const text = model.getValue();
    const cls = resolveExpression(expr, { text, offset, doc, current });
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column - partial.length,
      endColumn: position.column,
    };

    // $this-> where the class couldn't be worked out: fall back to names used in the file.
    if (!cls) {
      if (expr !== '$this' || op === '::') return [];
      const names = new Map();
      for (const x of text.matchAll(/function\s+(\w+)\s*\(/g)) names.set(x[1], kinds.Method);
      for (const x of text.matchAll(/\$this->(\w+)/g)) if (!names.has(x[1])) names.set(x[1], kinds.Field);
      return [...names].map(([label, kind]) => ({ label, kind, insertText: label, range }));
    }

    const own = /^(\$this|self|static|parent)$/i.test(expr) || (current && current.f === cls.f);
    const isStatic = op === '::';
    const out = [];
    for (const item of index().members(cls, doc.classes)) {
      if (!own && item.v !== 'public') continue;
      if (item.v === 'private' && item.from !== cls.n) continue;
      if (item.n.startsWith('__') && !(item.n === '__construct' && /^parent$/i.test(expr))) continue;
      const rank = `${item.from === cls.n ? 0 : 1}${item.n}`;
      if (item.k === 'm') {
        if (isStatic !== Boolean(item.s) && !own) continue;
        out.push({
          label: { label: item.n, description: `(${item.sig || ''})${item.t ? `: ${item.t.split('\\').pop()}` : ''}` },
          kind: kinds.Method,
          insertText: methodSnippet(item),
          insertTextRules: snippetRule,
          detail: `${item.from}::${item.n}(${item.sig || ''})${item.t ? `: ${item.t}` : ''}`,
          range,
          sortText: rank,
          _doc: ['m', item.fromFqn, item.n, item.s],
        });
      } else if (item.k === 'p') {
        if (isStatic !== Boolean(item.s)) continue;
        const name = isStatic ? `$${item.n}` : item.n;
        out.push({ label: name, kind: kinds.Field, insertText: name, detail: `${item.from}${item.t ? `: ${item.t}` : ''}`, range, sortText: rank });
      } else if (isStatic) {
        out.push({ label: item.n, kind: item.k === 'e' ? kinds.EnumMember : kinds.Constant, insertText: item.n, detail: item.from, range, sortText: `0${item.n}` });
      }
    }
    if (isStatic) out.push({ label: 'class', kind: kinds.Keyword, insertText: 'class', range, sortText: '9class' });
    return out;
  }

  // ---- Documentation of built-in things, built only for what you look at ----

  const markdown = (value) => ({ value, isTrusted: false });

  function memberEntry(classFqn, name) {
    const docs = window.CPM_PHP_DOCS;
    const found = docs && docs.ready() ? docs.rawClass(classFqn) : null;
    return found ? { cls: found.name, raw: found.raw, entry: (found.raw.m || {})[name] } : null;
  }

  // Called by Monaco when a suggestion is highlighted; fills in the documentation panel.
  function resolveItem(item) {
    const meta = item._doc;
    const docs = window.CPM_PHP_DOCS;
    if (!meta || item.documentation || !docs || !docs.ready()) return item;
    if (meta[0] === 'f') {
      const found = docs.fn(meta[1]);
      if (found) item.documentation = markdown(docs.functionMarkdown(found.name, found.entry));
    } else if (meta[0] === 'c') {
      const found = docs.rawClass(meta[1]);
      if (found) item.documentation = markdown(docs.classMarkdown(found.name, found.raw));
    } else if (meta[0] === 'm') {
      const hit = memberEntry(meta[1], meta[2]);
      if (hit && hit.entry) item.documentation = markdown(docs.methodMarkdown(hit.cls, meta[2], hit.entry, Boolean(meta[3])));
    }
    return item;
  }

  const PHP_WORD = /^[\\\w$]+$/;
  const CHAIN = /((?:\$\w+|[\\\w]+)(?:(?:->|\?->|::)\w+(?:\((?:[^()]|\([^()]*\))*\))?)*)(->|\?->|::)$/;

  function inPhpBlock(text) {
    const open = Math.max(text.lastIndexOf('<?php'), text.lastIndexOf('<?='), text.lastIndexOf('<?\n'));
    return open !== -1 && open > text.lastIndexOf('?>');
  }

  // What the mouse is over: a member, a function, a class, a constant or a variable.
  function hover(model, position) {
    const word = model.getWordAtPosition(position);
    if (!word || !PHP_WORD.test(word.word)) return null;
    const line = model.getLineContent(position.lineNumber);
    const before = line.slice(0, word.startColumn - 1);
    const after = line.slice(word.endColumn - 1);
    const upTo = model.getValueInRange({ startLineNumber: Math.max(1, position.lineNumber - 200), startColumn: 1, endLineNumber: position.lineNumber, endColumn: word.startColumn });
    if (!inPhpBlock(upTo)) return null;

    const docs = window.CPM_PHP_DOCS;
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    const reply = (value) => ({ range, contents: [markdown(value)] });
    const name = word.word.replace(/^\$/, '');
    const doc = parsed(model);
    const offset = model.getOffsetAt(position);

    // A member: look up the class of whatever is left of -> or ::.
    const chain = CHAIN.exec(before.slice(-300));
    if (chain) {
      const cls = resolveExpression(chain[1], { text: model.getValue(), offset, doc, current: classAt(doc, offset) });
      if (!cls) return null;
      const item = index().members(cls, doc.classes).find((m) => m.n === name);
      if (!item) return null;
      if (item.k === 'm') {
        const hit = memberEntry(item.fromFqn, item.n);
        if (hit && hit.entry && docs) return reply(docs.methodMarkdown(hit.cls, item.n, hit.entry, Boolean(item.s)));
        return reply(`\`\`\`php\nfunction ${item.from}${item.s ? '::' : '->'}${item.n}(${item.sig || ''})${item.t ? `: ${item.t}` : ''}\n\`\`\``);
      }
      const kind = item.k === 'p' ? 'property' : item.k === 'e' ? 'case' : 'const';
      return reply(`\`\`\`php\n(${kind}) ${item.from}${item.s ? '::' : '->'}${item.k === 'p' && item.s ? '$' : ''}${item.n}${item.t ? `: ${item.t}` : ''}\n\`\`\``);
    }
    if (/\bfunction\s+$/.test(before) || /\$$/.test(before)) return null;

    // $variable: say what we think its class is.
    if (word.word.startsWith('$')) {
      const type = word.word === '$this' ? (classAt(doc, offset) || {}).f : variableType(word.word, model.getValue(), offset);
      return type ? reply(`\`\`\`php\n${word.word}: ${type}\n\`\`\``) : null;
    }

    // function call
    if (/^\s*\(/.test(after) && docs && docs.ready()) {
      const found = docs.fn(word.word);
      if (found) return reply(docs.functionMarkdown(found.name, found.entry));
    }

    // class name (also after new, extends, instanceof, :: ...)
    if (/^[A-Z\\]/.test(word.word) || /\bnew\s+$/.test(before)) {
      const cls = classNamed(word.word, doc);
      if (cls) {
        if (cls.stub && docs) {
          const found = docs.rawClass(cls.f);
          if (found) return reply(docs.classMarkdown(found.name, found.raw));
        }
        const parents = [cls.x && ` extends ${cls.x}`, cls.i.length && ` implements ${cls.i.join(', ')}`].filter(Boolean).join('');
        return reply(`\`\`\`php\n${cls.k} ${cls.f}${parents}\n\`\`\`${cls.file ? `\n\nDefined in \`${cls.file}\`` : ''}`);
      }
    }

    // constant
    if (docs && docs.ready() && /^[A-Z_][A-Z0-9_]*$/.test(word.word)) {
      const value = docs.constant(word.word);
      if (value !== null) return reply(`\`\`\`php\nconst ${word.word}${value ? ` = ${value}` : ''}\n\`\`\``);
    }
    return null;
  }

  // ---- Parameter hints: which argument of which call is being typed ----

  function openCall(chunk) {
    const stack = [];
    let i = 0;
    while (i < chunk.length) {
      const c = chunk[i];
      if (c === '\'' || c === '"') {
        i++;
        while (i < chunk.length && chunk[i] !== c) i += chunk[i] === '\\' ? 2 : 1;
      } else if ((c === '/' && chunk[i + 1] === '/') || (c === '#' && chunk[i + 1] !== '[')) {
        while (i < chunk.length && chunk[i] !== '\n') i++;
      } else if (c === '/' && chunk[i + 1] === '*') {
        const end = chunk.indexOf('*/', i + 2);
        i = end === -1 ? chunk.length : end + 1;
      } else if ('([{'.includes(c)) {
        stack.push({ c, at: i, commas: 0 });
      } else if (')]}'.includes(c)) {
        stack.pop();
      } else if (c === ',' && stack.length) {
        stack[stack.length - 1].commas++;
      }
      i++;
    }
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].c === '(') return stack[k];
    return null;
  }

  function signatureHelp(model, position) {
    const offset = model.getOffsetAt(position);
    const start = Math.max(0, offset - 4000);
    const from = model.getPositionAt(start);
    const chunk = model.getValueInRange({ startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: position.lineNumber, endColumn: position.column });
    if (!inPhpBlock(model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column }))) return null;
    const call = openCall(chunk);
    if (!call) return null;

    const before = chunk.slice(Math.max(0, call.at - 300), call.at);
    const callee = /(new\s+)?((?:\$\w+|[\\\w]+)(?:(?:->|\?->|::)\w+(?:\((?:[^()]|\([^()]*\))*\))?)*)\s*$/.exec(before);
    if (!callee) return null;
    const [, isNew, chain] = callee;
    const docs = window.CPM_PHP_DOCS;
    const doc = parsed(model);
    const current = classAt(doc, offset);
    let label = '';
    let description = '';
    let paramDocs = [];
    let signature = null;

    const member = /^([\s\S]*?)(->|\?->|::)(\w+)$/.exec(chain);
    if (isNew) {
      const cls = classNamed(chain, doc);
      const ctor = cls && index().members(cls, doc.classes).find((m) => m.k === 'm' && m.n === '__construct');
      if (ctor) {
        signature = { name: cls.n, sig: ctor.sig || '', ret: '' };
        const hit = memberEntry(ctor.fromFqn, '__construct');
        if (hit && hit.entry) { description = hit.entry.d || ''; paramDocs = hit.entry.p || []; }
      }
    } else if (member) {
      const cls = resolveExpression(member[1], { text: model.getValue(), offset, doc, current });
      const item = cls && index().members(cls, doc.classes).find((m) => m.k === 'm' && m.n === member[3]);
      if (item) {
        signature = { name: item.n, sig: item.sig || '', ret: item.t || '' };
        const hit = memberEntry(item.fromFqn, item.n);
        if (hit && hit.entry) { description = hit.entry.d || ''; paramDocs = hit.entry.p || []; }
      }
    } else {
      const found = docs && docs.ready() ? docs.fn(chain) : null;
      if (found) {
        signature = { name: found.name, sig: found.entry.s, ret: found.entry.t || '' };
        description = found.entry.d || '';
        paramDocs = found.entry.p || [];
      } else {
        const own = new RegExp(`function\\s+${chain.replace(/\\/g, '')}\\s*\\(((?:[^()]|\\([^()]*\\))*)\\)(?:\\s*:\\s*([\\w\\\\|?]+))?`).exec(model.getValue());
        if (own) signature = { name: chain, sig: own[1].replace(/\s+/g, ' ').trim(), ret: own[2] || '' };
      }
    }
    if (!signature) return null;

    const params = docs ? docs.splitParams(signature.sig) : [];
    label = `${signature.name}(${signature.sig})${signature.ret ? `: ${signature.ret}` : ''}`;
    let cursor = signature.name.length + 1;
    const parameters = params.map((text, i) => {
      const startAt = label.indexOf(text, cursor);
      cursor = startAt + text.length;
      return { label: [startAt, startAt + text.length], documentation: paramDocs[i] ? markdown(paramDocs[i]) : undefined };
    });
    const last = params.length - 1;
    const variadic = last >= 0 && params[last].includes('...');
    const active = Math.min(call.commas, variadic ? last : Math.max(last, 0));
    return {
      value: {
        signatures: [{ label, documentation: description ? markdown(description) : undefined, parameters }],
        activeSignature: 0,
        activeParameter: active,
      },
      dispose() {},
    };
  }

  window.CPM_PHP_MEMBERS = { init, member, classSuggestions, importSuggestions, parsed, resolveItem, hover, signatureHelp };
})();
