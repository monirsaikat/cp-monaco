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
    if (!idx.size || range.endColumn - range.startColumn < 1) return [];
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
    return out;
  }

  // use App\Models\Us…  (an import at the top of the file)
  function importSuggestions(line, position, range) {
    const m = /^\s*use\s+(?:function\s+|const\s+)?([\w\\]*)$/.exec(line);
    if (!m) return null;
    const importRange = { ...range, startColumn: position.column - m[1].length };
    return index().all().map((cls) => ({
      label: cls.f, kind: classKind(cls), insertText: cls.f, filterText: cls.f, range: importRange, sortText: cls.f,
    }));
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

  window.CPM_PHP_MEMBERS = { init, member, classSuggestions, importSuggestions, parsed };
})();
