// A small Markdown renderer for the preview pane (headings, lists, tables, code, quotes,
// links, images and the usual inline styles).
//
// It builds DOM nodes directly and never parses HTML, so nothing in a file can run script
// or load anything: raw HTML is shown as text. Links and images are handed to the caller
// (`hooks.link`, `hooks.image`), which decides what they may point at.
(() => {
  'use strict';

  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
  const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
  const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^ {0,3}>\s?/;
  const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
  const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const SETEXT = /^ {0,3}(=+|-+)\s*$/;

  const INLINE = [
    String.raw`\\(?<esc>[!-/:-@\[-\`{-~])`,
    String.raw`(?<tick>\`+)(?<code>[\s\S]*?[^\`])\k<tick>(?!\`)`,
    String.raw`!\[(?<alt>[^\]]*)\]\(\s*<?(?<src>[^\s)>]*)>?(?:\s+["'][^"']*["'])?\s*\)`,
    String.raw`\[(?<label>(?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?(?<href>[^\s)>]*)>?(?:\s+["'][^"']*["'])?\s*\)`,
    String.raw`<(?<auto>(?:https?://|mailto:)[^\s>]+)>`,
    String.raw`(?<url>\bhttps?://[^\s<]*[^\s<.,;:!?)\]'"*_])`,
    String.raw`(?<sm>\*\*|__)(?=\S)(?<strong>[\s\S]+?)(?<=\S)\k<sm>(?!\*)`,
    String.raw`\*(?=\S)(?<em>[\s\S]+?)(?<=\S)\*`,
    // Underscores inside a word (snake_case) aren't emphasis.
    String.raw`(?<!\w)_(?=\S)(?<em2>[\s\S]+?)(?<=\S)_(?!\w)`,
    String.raw`~~(?=\S)(?<del>[\s\S]+?)(?<=\S)~~`,
    String.raw`(?<br> {2,}\n|\\\n|<br\s*/?>)`,
  ].join('|');

  function el(tag, parent) {
    const node = document.createElement(tag);
    parent?.append(node);
    return node;
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  }

  function inline(text, parent, hooks) {
    // A fresh expression each time: this function calls itself for nested styles.
    const re = new RegExp(INLINE, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      last = re.lastIndex;
      const g = m.groups;
      if (g.esc !== undefined) {
        parent.append(g.esc);
      } else if (g.code !== undefined) {
        el('code', parent).textContent = g.code.replace(/\n/g, ' ').replace(/^ (.*\S.*) $/, '$1');
      } else if (g.src !== undefined) {
        parent.append(hooks.image ? hooks.image(g.src, g.alt) : g.alt);
      } else if (g.href !== undefined) {
        const link = el('a', parent);
        inline(g.label, link, hooks);
        hooks.link?.(link, g.href);
      } else if (g.auto !== undefined || g.url !== undefined) {
        const link = el('a', parent);
        link.textContent = g.auto ?? g.url;
        hooks.link?.(link, g.auto ?? g.url);
      } else if (g.strong !== undefined) {
        inline(g.strong, el('strong', parent), hooks);
      } else if (g.em !== undefined || g.em2 !== undefined) {
        inline(g.em ?? g.em2, el('em', parent), hooks);
      } else if (g.del !== undefined) {
        inline(g.del, el('del', parent), hooks);
      } else {
        el('br', parent);
      }
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // A line that ends the paragraph before it.
  function startsBlock(line) {
    if (FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line)) return true;
    const item = line.match(LIST);
    return Boolean(item) && (!/\d/.test(item[2]) || parseInt(item[2], 10) === 1);
  }

  function cells(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  }

  function table(lines, start, parent, hooks) {
    const align = cells(lines[start + 1]).map((cell) =>
      (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : ''));
    const tableEl = el('table', parent);
    const row = (texts, tag, section) => {
      const tr = el('tr', section);
      for (let c = 0; c < align.length; c++) {
        const cell = el(tag, tr);
        if (align[c]) cell.style.textAlign = align[c];
        inline(texts[c] || '', cell, hooks);
      }
    };
    row(cells(lines[start]), 'th', el('thead', tableEl));
    const body = el('tbody', tableEl);
    let i = start + 2;
    while (i < lines.length && lines[i].trim() && lines[i].includes('|')) row(cells(lines[i++]), 'td', body);
    return i;
  }

  function list(lines, start, parent, hooks) {
    const ordered = /\d/.test(lines[start].match(LIST)[2]);
    const listEl = el(ordered ? 'ol' : 'ul', parent);
    if (ordered) {
      const first = parseInt(lines[start].match(LIST)[2], 10);
      if (first !== 1) listEl.start = first;
    }
    const items = [];
    let loose = false;
    let i = start;
    while (i < lines.length) {
      const m = lines[i].match(LIST);
      if (!m || /\d/.test(m[2]) !== ordered || RULE.test(lines[i])) break;
      const column = m[1].length + m[2].length + 1;
      const body = [m[3] || ''];
      let blank = false;
      i++;
      // Indented lines belong to the item; so does text right under it ("lazy" continuation).
      while (i < lines.length) {
        const line = lines[i];
        const lead = line.match(/^ */)[0].length;
        if (!line.trim()) {
          blank = true;
          body.push('');
        } else if (lead >= m[1].length + 2) {
          if (blank) loose = true;
          blank = false;
          body.push(line.slice(Math.min(lead, column)));
        } else if (blank || LIST.test(line) || startsBlock(line)) {
          break;
        } else {
          body.push(line);
        }
        i++;
      }
      while (body.length > 1 && !body[body.length - 1]) body.pop();
      const next = blank && i < lines.length && lines[i].match(LIST);
      if (next && /\d/.test(next[2]) === ordered) loose = true;
      items.push(body);
    }
    for (const body of items) {
      const li = el('li', listEl);
      const task = body[0].match(/^\[([ xX])\]\s+/);
      if (task) {
        body[0] = body[0].slice(task[0].length);
        li.className = 'task';
        const box = el('input', li);
        box.type = 'checkbox';
        box.disabled = true;
        box.checked = task[1] !== ' ';
      }
      blocks(body, li, hooks, !loose);
    }
    return i;
  }

  // `tight` (inside a compact list) puts paragraph text straight into the parent, without a <p>.
  function blocks(lines, parent, hooks, tight = false) {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }

      const fence = line.match(FENCE);
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
        const body = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
        i++;
        const code = el('code', el('pre', parent));
        code.textContent = body.join('\n');
        if (fence[2]) hooks.code?.(code, fence[2].toLowerCase());
        continue;
      }

      const heading = line.match(HEADING);
      if (heading) {
        const h = el(`h${heading[1].length}`, parent);
        inline(heading[2] || '', h, hooks);
        h.dataset.slug = slug(h.textContent);
        i++;
        continue;
      }

      if (RULE.test(line)) {
        el('hr', parent);
        i++;
        continue;
      }

      if (QUOTE.test(line)) {
        const body = [];
        while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) {
          body.push(lines[i++].replace(QUOTE, ''));
        }
        blocks(body, el('blockquote', parent), hooks);
        continue;
      }

      if (LIST.test(line)) {
        i = list(lines, i, parent, hooks);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')
        && cells(line).length === cells(lines[i + 1]).length) {
        i = table(lines, i, parent, hooks);
        continue;
      }

      if (/^ {4}/.test(line)) {
        const body = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].slice(4));
        el('code', el('pre', parent)).textContent = body.join('\n').replace(/\n+$/, '');
        continue;
      }

      // A paragraph, or a heading underlined with === or ---.
      const text = [line.trim()];
      i++;
      let level = 0;
      while (i < lines.length && lines[i].trim()) {
        const underline = lines[i].match(SETEXT);
        if (underline) {
          level = underline[1][0] === '=' ? 1 : 2;
          i++;
          break;
        }
        if (startsBlock(lines[i])) break;
        text.push(lines[i++].replace(/^ +/, ''));
      }
      if (level) {
        const h = el(`h${level}`, parent);
        inline(text.join('\n'), h, hooks);
        h.dataset.slug = slug(h.textContent);
      } else {
        inline(text.join('\n'), tight ? parent : el('p', parent), hooks);
        if (tight) parent.append(' ');
      }
    }
  }

  function render(text, hooks = {}) {
    const root = document.createDocumentFragment();
    const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    // Front matter (--- … --- at the very top) is shown as it is.
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) {
        el('code', el('pre', root)).textContent = lines.slice(1, end).join('\n');
        lines.splice(0, end + 1);
      }
    }
    blocks(lines, root, hooks);
    return root;
  }

  window.CPM_MARKDOWN = { render };
})();
