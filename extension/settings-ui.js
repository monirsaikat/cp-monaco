// The Settings page: a search box, a User / Server switch, a category tree on the left and the
// settings themselves on the right, laid out like VS Code's. It reads and writes through
// CPM_SETTINGS and never touches the editor itself; editor.js reacts to the changes.
(() => {
  'use strict';

  const S = () => window.CPM_SETTINGS;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : value);
    }
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  }

  // Descriptions may use `code` and **bold**; everything else is plain text.
  function richText(text) {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/);
    return parts.filter(Boolean).map((part) => {
      if (part.startsWith('`')) return el('code', { text: part.slice(1, -1) });
      if (part.startsWith('**')) return el('strong', { text: part.slice(2, -2) });
      return part;
    });
  }

  function create({ dialog, icons }) {
    const refs = {
      search: dialog.querySelector('#st-search'),
      count: dialog.querySelector('#st-count'),
      nav: dialog.querySelector('#st-nav'),
      list: dialog.querySelector('#st-list'),
      scopes: [...dialog.querySelectorAll('[data-scope]')],
      host: dialog.querySelector('#st-host'),
      close: dialog.querySelector('#st-close'),
      resetAll: dialog.querySelector('#st-reset-all'),
      copy: dialog.querySelector('#st-copy'),
      status: dialog.querySelector('#st-status'),
    };
    const state = { scope: 'user', node: 'common', expanded: new Set(['editor']), query: '' };
    const items = new Map(); // key -> { root, refresh }

    // ---- Which settings belong where ----

    const defsIn = (groupId) => S().schema.filter((def) => def.group === groupId);
    const common = () => S().schema.filter((def) => def.common).sort((a, b) => a.common - b.common);

    function matches(def, tokens) {
      const modifiedOnly = tokens.includes('@modified');
      if (modifiedOnly && !S().isModified(state.scope, def.key)) return false;
      const hay = `${def.category}: ${def.name} ${def.key} ${def.description}`.toLowerCase();
      return tokens.filter((t) => t !== '@modified').every((t) => hay.includes(t));
    }

    // ---- Values ----

    function valueIn(def) {
      const own = S().stored(state.scope, def.key);
      if (own !== undefined) return own;
      if (state.scope === 'server') {
        const user = S().stored('user', def.key);
        if (user !== undefined) return user;
      }
      return def.default;
    }

    function write(def, value) {
      const ok = S().set(state.scope, def.key, value);
      refreshItem(def.key);
      return ok;
    }

    // ---- One setting ----

    function buildControl(def, item) {
      const id = `st-${def.key}`;
      const describedBy = `${id}-desc`;
      if (def.type === 'boolean') {
        const box = el('input', { type: 'checkbox', id, 'aria-describedby': describedBy });
        box.addEventListener('change', () => write(def, box.checked));
        item.sync = () => { box.checked = Boolean(valueIn(def)); };
        return { node: el('label', { class: 'st-check', for: id }, box, el('span', { id: describedBy, class: 'st-desc' }, richText(def.description))), inlineDescription: true };
      }
      if (def.type === 'enum') {
        const select = el('select', { id, 'aria-describedby': describedBy }, def.options.map((o) => el('option', { value: o.value, text: o.label })));
        select.addEventListener('change', () => write(def, select.value));
        item.sync = () => { select.value = String(valueIn(def)); };
        return { node: select };
      }
      const isNumber = def.type === 'number';
      const input = el('input', { type: isNumber ? 'number' : 'text', id, 'aria-describedby': describedBy, spellcheck: 'false', ...(isNumber && { min: def.min, max: def.max, step: 1 }) });
      const error = el('p', { class: 'st-error', role: 'alert', hidden: true });
      let timer = 0;
      const commit = () => {
        const value = isNumber ? (input.value.trim() === '' ? NaN : Number(input.value)) : input.value;
        if (S().sanitize(def.key, value) === undefined) {
          error.textContent = isNumber ? `Enter a whole number from ${def.min} to ${def.max}.` : 'That value is not valid.';
          error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          return false;
        }
        error.hidden = true;
        input.removeAttribute('aria-invalid');
        return write(def, value);
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(commit, 300);
      });
      input.addEventListener('change', () => { clearTimeout(timer); commit(); });
      input.addEventListener('blur', () => {
        clearTimeout(timer);
        if (!commit()) { error.hidden = true; input.removeAttribute('aria-invalid'); item.sync(); }
      });
      item.sync = () => { input.value = String(valueIn(def)); error.hidden = true; input.removeAttribute('aria-invalid'); };
      return { node: el('div', { class: `st-field${isNumber ? ' short' : ''}` }, input, error) };
    }

    function buildItem(def) {
      const item = {};
      const reset = el('button', { type: 'button', class: 'st-reset', title: 'Reset Setting', 'aria-label': `Reset ${def.category}: ${def.name}`, onclick: () => { S().reset(state.scope, def.key); refreshItem(def.key); } }, icons('i-reset'));
      const note = el('span', { class: 'st-note' });
      const title = el('div', { class: 'st-title' },
        el('span', { class: 'st-cat', text: `${def.category}: ` }), el('strong', { text: def.name }), note, reset);
      const { node, inlineDescription } = buildControl(def, item);
      const root = el('div', { class: 'st-item', 'data-key': def.key }, title,
        inlineDescription ? null : el('p', { class: 'st-desc', id: `st-${def.key}-desc` }, richText(def.description)), node);
      item.root = root;
      item.refresh = () => {
        item.sync();
        const mine = S().isModified(state.scope, def.key);
        const other = state.scope === 'user' ? S().isModified('server', def.key) && S().server : S().isModified('user', def.key);
        root.classList.toggle('modified', mine);
        reset.hidden = !mine;
        note.textContent = other ? ` (Also modified in ${state.scope === 'user' ? 'Server' : 'User'})` : '';
      };
      item.refresh();
      items.set(def.key, item);
      return root;
    }

    function refreshItem(key) {
      items.get(key)?.refresh();
      updateChrome();
    }

    // ---- The left tree ----

    function renderNav() {
      refs.nav.replaceChildren(...S().tree.map((top) => {
        const open = state.expanded.has(top.id);
        const select = (id) => { state.node = id; refs.search.value = ''; state.query = ''; render(); };
        const row = el('button', {
          type: 'button',
          class: `st-nav-row${state.node === top.id && !state.query ? ' active' : ''}`,
          role: 'treeitem',
          'aria-level': '1',
          'aria-expanded': top.children ? String(open) : false,
          onclick: () => {
            // Clicking the open category again folds it; otherwise it opens and is shown.
            if (top.children) {
              if (state.node === top.id && !state.query && open) state.expanded.delete(top.id);
              else state.expanded.add(top.id);
            }
            select(top.id);
          },
        }, top.children ? icons('i-chevron', open ? 'st-chevron open' : 'st-chevron') : el('span', { class: 'st-chevron-gap' }), el('span', { text: top.label }));
        const group = el('div', { role: 'group' });
        if (top.children && open) {
          for (const child of top.children) {
            group.append(el('button', {
              type: 'button',
              class: `st-nav-row child${state.node === child.id && !state.query ? ' active' : ''}`,
              role: 'treeitem',
              'aria-level': '2',
              onclick: () => select(child.id),
            }, el('span', { text: child.label })));
          }
        }
        return el('div', { class: 'st-nav-group' }, row, group);
      }));
    }

    // ---- The right-hand list ----

    function nodeContent() {
      const top = S().tree.find((t) => t.id === state.node);
      if (state.node === 'common') return [{ defs: common() }];
      if (top?.children) return top.children.map((child) => ({ heading: child.label, defs: defsIn(child.id) }));
      return [{ defs: defsIn(state.node) }];
    }

    function render() {
      items.clear();
      const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
      let sections;
      let total;
      if (tokens.length) {
        const found = S().schema.filter((def) => matches(def, tokens));
        sections = [{ defs: found }];
        total = found.length;
        refs.count.textContent = `${found.length} Setting${found.length === 1 ? '' : 's'} Found`;
      } else {
        sections = nodeContent();
        total = sections.reduce((n, s) => n + s.defs.length, 0);
        refs.count.textContent = '';
      }
      const title = tokens.length ? null : (S().tree.flatMap((t) => [t, ...(t.children || [])]).find((n) => n.id === state.node) || {}).label;
      const children = [];
      if (title) children.push(el('h3', { class: 'st-h1', text: title }));
      if (!total) {
        children.push(el('p', { class: 'st-empty', text: tokens.length ? 'No settings match your search.' : 'Nothing here.' }));
      }
      for (const section of sections) {
        if (!section.defs.length) continue;
        if (section.heading) children.push(el('h4', { class: 'st-h2', text: section.heading }));
        children.push(...section.defs.map(buildItem));
      }
      refs.list.replaceChildren(...children);
      refs.list.scrollTop = 0;
      renderNav();
      updateChrome();
    }

    function updateChrome() {
      const server = S().server;
      for (const tab of refs.scopes) {
        const selected = tab.dataset.scope === state.scope;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (tab.dataset.scope === 'server') tab.disabled = !server;
      }
      refs.host.textContent = server ? server.replace(/:\d+$/, '') : '';
      refs.resetAll.disabled = S().modifiedKeys(state.scope).length === 0;
      refs.copy.disabled = S().modifiedKeys(state.scope).length === 0;
    }

    // ---- Events ----

    refs.search.addEventListener('input', () => {
      state.query = refs.search.value.trim();
      render();
    });
    for (const tab of refs.scopes) {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        state.scope = tab.dataset.scope;
        render();
      });
    }
    refs.close.addEventListener('click', () => dialog.close());
    refs.resetAll.addEventListener('click', () => {
      const n = S().modifiedKeys(state.scope).length;
      if (!n || !confirm(`Reset all ${n} ${state.scope === 'user' ? 'user' : 'server'} setting${n === 1 ? '' : 's'} to their defaults?`)) return;
      S().resetAll(state.scope);
      render();
    });
    refs.copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(S().exportJSON(state.scope));
        refs.status.textContent = 'Copied your changed settings as JSON.';
      } catch {
        refs.status.textContent = 'Couldn’t copy to the clipboard.';
      }
    });
    // Changes made elsewhere (the toolbar, another tab) show up while the page is open.
    S().onChange(() => { if (dialog.open) { for (const item of items.values()) item.refresh(); updateChrome(); } });
    dialog.addEventListener('close', () => { refs.status.textContent = ''; });

    return {
      open(query = '') {
        state.query = query;
        refs.search.value = query;
        render();
        if (!dialog.open) dialog.showModal();
        refs.search.focus();
      },
    };
  }

  window.CPM_SETTINGS_UI = { create };
})();
