// Editor themes. `ui` colors the toolbar, banner and status bar around Monaco.
// Themes with a `palette` are registered as custom Monaco themes; the rest reuse
// Monaco's built-ins. `bg`/`text` default to the palette's background/foreground.
window.CPM_THEMES = [
  {
    id: 'light',
    label: 'Light',
    mode: 'light',
    monaco: 'vs',
    ui: { bg: '#ffffff', bar: '#f5f6f8', text: '#1f2328', muted: '#6b7280', accent: '#2563eb', onAccent: '#ffffff' },
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    mode: 'light',
    ui: { bar: '#f6f8fa', muted: '#57606a', accent: '#0969da', onAccent: '#ffffff' },
    palette: {
      bg: '#ffffff', fg: '#24292f', comment: '#6e7781', keyword: '#cf222e', string: '#0a3069',
      number: '#0550ae', constant: '#0550ae', type: '#953800', variable: '#953800', tag: '#116329',
      attr: '#0550ae', regexp: '#116329', delimiter: '#57606a',
      lineHighlight: '#f6f8fa', selection: '#0969da33',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    mode: 'light',
    ui: { bar: '#eee8d5', muted: '#657b83', accent: '#268bd2', onAccent: '#ffffff' },
    palette: {
      bg: '#fdf6e3', fg: '#586e75', comment: '#93a1a1', keyword: '#859900', string: '#2aa198',
      number: '#d33682', constant: '#cb4b16', type: '#b58900', variable: '#268bd2', tag: '#268bd2',
      attr: '#b58900', regexp: '#dc322f', delimiter: '#657b83',
      lineHighlight: '#eee8d5', selection: '#d9d2bd',
    },
  },
  {
    id: 'hc-light',
    label: 'High Contrast Light',
    mode: 'light',
    monaco: 'hc-light',
    ui: { bg: '#ffffff', bar: '#ffffff', text: '#000000', muted: '#292929', accent: '#0f4a85', onAccent: '#ffffff' },
  },
  {
    id: 'dark',
    label: 'Dark',
    mode: 'dark',
    monaco: 'vs-dark',
    ui: { bg: '#1e1e1e', bar: '#252526', text: '#e5e7eb', muted: '#9ca3af', accent: '#3b82f6', onAccent: '#ffffff' },
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    mode: 'dark',
    ui: { bar: '#161b22', muted: '#8b949e', accent: '#1f6feb', onAccent: '#ffffff' },
    palette: {
      bg: '#0d1117', fg: '#e6edf3', comment: '#8b949e', keyword: '#ff7b72', string: '#a5d6ff',
      number: '#79c0ff', constant: '#79c0ff', type: '#ffa657', variable: '#ffa657', tag: '#7ee787',
      attr: '#79c0ff', regexp: '#7ee787', delimiter: '#c9d1d9',
      lineHighlight: '#161b22', selection: '#388bfd40',
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    mode: 'dark',
    ui: { bar: '#21252b', muted: '#8b919c', accent: '#4d78cc', onAccent: '#ffffff' },
    palette: {
      bg: '#282c34', fg: '#abb2bf', comment: '#5c6370', keyword: '#c678dd', string: '#98c379',
      number: '#d19a66', constant: '#d19a66', type: '#e5c07b', variable: '#e06c75', tag: '#e06c75',
      attr: '#d19a66', regexp: '#56b6c2', delimiter: '#abb2bf',
      lineHighlight: '#2c313c', selection: '#3e4451', cursor: '#528bff',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    ui: { bar: '#21222c', muted: '#a4a9c7', accent: '#bd93f9', onAccent: '#282a36' },
    palette: {
      bg: '#282a36', fg: '#f8f8f2', comment: '#6272a4', keyword: '#ff79c6', string: '#f1fa8c',
      number: '#bd93f9', constant: '#bd93f9', type: '#8be9fd', variable: '#ffb86c', tag: '#ff79c6',
      attr: '#50fa7b', regexp: '#ff5555', delimiter: '#f8f8f2',
      lineHighlight: '#343746', selection: '#44475a',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    mode: 'dark',
    ui: { bar: '#1e1f1c', muted: '#a59f85', accent: '#a6e22e', onAccent: '#272822' },
    palette: {
      bg: '#272822', fg: '#f8f8f2', comment: '#75715e', keyword: '#f92672', string: '#e6db74',
      number: '#ae81ff', constant: '#ae81ff', type: '#66d9ef', variable: '#fd971f', tag: '#f92672',
      attr: '#a6e22e', regexp: '#e6db74', delimiter: '#f8f8f2',
      lineHighlight: '#3e3d32', selection: '#49483e',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    ui: { bar: '#272c36', muted: '#9aa5b8', accent: '#88c0d0', onAccent: '#2e3440' },
    palette: {
      bg: '#2e3440', fg: '#d8dee9', comment: '#616e88', keyword: '#81a1c1', string: '#a3be8c',
      number: '#b48ead', constant: '#b48ead', type: '#8fbcbb', variable: '#d8dee9', tag: '#81a1c1',
      attr: '#8fbcbb', regexp: '#ebcb8b', delimiter: '#eceff4',
      lineHighlight: '#3b4252', selection: '#434c5e',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    mode: 'dark',
    ui: { bar: '#073642', muted: '#839496', accent: '#268bd2', onAccent: '#ffffff' },
    palette: {
      bg: '#002b36', fg: '#93a1a1', comment: '#586e75', keyword: '#859900', string: '#2aa198',
      number: '#d33682', constant: '#cb4b16', type: '#b58900', variable: '#268bd2', tag: '#268bd2',
      attr: '#b58900', regexp: '#dc322f', delimiter: '#839496',
      lineHighlight: '#073642', selection: '#274642',
    },
  },
  {
    id: 'hc-dark',
    label: 'High Contrast Dark',
    mode: 'dark',
    monaco: 'hc-black',
    ui: { bg: '#000000', bar: '#000000', text: '#ffffff', muted: '#d4d4d4', accent: '#1aebff', onAccent: '#000000' },
  },
];
