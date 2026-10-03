<p align="center">
  <img src="extension/icons/logo.svg" alt="cPanel Monaco Editor logo" width="88" height="88">
</p>

<h1 align="center">cPanel Monaco Editor</h1>

<p align="center">
  The VS Code editor, inside cPanel's File Manager.<br>
  Made by <strong>Monir Saikat</strong> · <a href="mailto:monirsaikat1@gmail.com">monirsaikat1@gmail.com</a> · <a href="LICENSE">MIT License</a>
</p>

A Chrome extension that replaces the code editor in cPanel's File Manager with [Monaco](https://microsoft.github.io/monaco-editor/), the editor that powers VS Code.

Open any file in File Manager the way you normally do. Instead of cPanel's built-in editor, you get proper syntax highlighting, multi-cursor editing, find & replace, code folding, a minimap, and the keyboard shortcuts you already know from VS Code.

![Monaco editing a file inside cPanel, with the privacy banner](docs/screenshot.png)

## Features

- **Real VS Code editing**: multi-cursor, bracket matching, folding, command palette (`F1`), find & replace with regex, sticky scroll.
- **Automatic language detection** from the file name: PHP, JavaScript, TypeScript, HTML, CSS/SCSS/Less, JSON, Markdown, YAML, XML, SQL, Python, shell, `.htaccess`, `.env` and more. You can switch manually from the dropdown.
- **Saves straight to your server** with `Ctrl+S` / `Cmd+S`, using your existing cPanel login.
- **Unsaved-changes protection**: a dot next to the file name, a `●` in the tab title, and a browser warning if you try to close the tab with unsaved work.
- **12 themes plus "Match system"**: Light, Dark, GitHub Light/Dark, One Dark, Dracula, Monokai, Nord, Solarized Light/Dark, and high-contrast Light/Dark. The toolbar recolors to match, and your choice is remembered.
- **Word wrap** toggle, also remembered.
- **Transparent about privacy**: a banner and a **Private** button in the status bar explain exactly what the extension can and can't do, and how to check each claim yourself.
- **Escape hatch**: one click on **cPanel editor** brings back the original editor.
- **Fully offline**: Monaco is bundled inside the extension. Nothing is downloaded from a CDN, and your code is never sent anywhere except your own cPanel server.

## Installation

The extension isn't on the Chrome Web Store yet, so you load it manually. It takes about two minutes.

### Option A: from a ready-made zip

If someone shared a zip of the `extension` folder with you:

1. Unzip it somewhere permanent (for example `Documents/cpanel-monaco`). Chrome loads the extension from that folder every time, so don't delete it.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder, the one that contains `manifest.json`.

### Option B: from source

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone <this-repo-url> cp-monaco
cd cp-monaco
npm install
```

`npm install` downloads Monaco and copies it into `extension/monaco/` automatically. Then:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder inside the project.

> **Edge, Brave, Opera, Vivaldi** and other Chromium browsers work too. Use their extensions page (`edge://extensions`, `brave://extensions`, …) and follow the same steps.

## How to use it

1. Log in to cPanel and open **File Manager**.
2. Select a file and click **Edit** in the toolbar, or right-click the file and choose **Edit**.
3. If cPanel asks about the character encoding, click **Edit** again.
4. The editor opens in Monaco. Make your changes and press `Ctrl+S` (or click **Save**).

A "Saved at …" message appears in the bottom-left corner when the file has been written to the server.

### The extension popup

Click the extension's icon in Chrome's toolbar (pin it from the puzzle-piece menu) for a quick how-to and the version you're running.

<img src="docs/popup.png" alt="Extension popup" width="320">

### The toolbar

| Control | What it does |
| --- | --- |
| Language dropdown | Changes syntax highlighting for this file (doesn't modify the file). |
| Theme dropdown | Picks the editor theme. **Match system** follows your OS light/dark setting. |
| **Wrap** | Toggles word wrap. |
| **cPanel editor** | Hides Monaco and shows cPanel's original editor. Reload the page to get Monaco back. |
| **Save** | Saves the file to your server. |

The status bar shows the cursor position, the file's line endings (LF/CRLF) and its character encoding. The **Private** button on the right opens a short explanation of how your code is protected. The same panel opens from the banner you see the first time, which you can dismiss with **×**.

### Keyboard shortcuts

Most VS Code shortcuts work. The most useful ones:

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save |
| `F1` | Command palette |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `Ctrl+D` | Select next occurrence |
| `Alt+Click` | Add another cursor |
| `Ctrl+Alt+↑` / `↓` | Add cursor above / below |
| `Alt+↑` / `↓` | Move line up / down |
| `Shift+Alt+↑` / `↓` | Copy line up / down |
| `Ctrl+/` | Toggle comment |
| `Ctrl+Shift+[` / `]` | Fold / unfold block |
| `Shift+Alt+F` | Format document (JS, TS, JSON, HTML, CSS) |
| `Alt+Z` | Toggle word wrap |
| `Ctrl+G` | Go to line |

On macOS, use `Cmd` instead of `Ctrl` and `Option` instead of `Alt`.

## Troubleshooting

**The old cPanel editor still shows up.**
The extension only runs on cPanel's editor page, whose address looks like:

```
https://your-server:2083/cpsess1234567890/frontend/jupiter/filemanager/editit.html?file=…&dir=…
```

If your editor's address looks different, the extension won't activate. Email the URL to [monirsaikat1@gmail.com](mailto:monirsaikat1@gmail.com) (remove the `cpsess…` number first) so the match pattern can be extended in `extension/manifest.json`.

**"Couldn't load this file" or "Your session may have expired".**
Your cPanel login timed out. Reload the page, log in again and reopen the file.

**"Save failed: …"**
The error text comes straight from cPanel. The usual causes are file permissions, a full disk quota, or an expired session. Copy your changes somewhere safe before reloading.

**I need the original editor for one file.**
Click **cPanel editor** in the toolbar. To turn Monaco off entirely, disable the extension on `chrome://extensions`.

**Non-UTF-8 files** (e.g. legacy `ISO-8859-1` sites).
These are converted to UTF-8 for editing and back to their original encoding on save. This path has had the least testing, so keep a backup of anything important the first time you edit one.

## Privacy & security

Every claim below can be checked in the source. None of it relies on trusting us.

- **The editor is blocked from the network by the browser.** `manifest.json` gives the editor page a strict Content Security Policy (`default-src 'none'; connect-src 'none'; …`). It can only load files packaged inside the extension, and Chrome refuses any request it tries to make to a server.
- **Your files only go to your own server.** `content.js` loads and saves through cPanel's own API (`Fileman::get_file_content` / `Fileman::save_file_content`) on the server you're already on, using the session you're already logged in with. You can confirm this in DevTools → Network.
- **No background script, no analytics, no remote code.** Monaco is bundled inside the extension rather than loaded from a CDN.
- **No extra permissions.** The extension doesn't request access to tabs, cookies, history, downloads or storage.
  - Chrome's install prompt may say it can "read and change your data on all websites". That's because cPanel can run on any domain, so the match pattern can't be limited to one host. The script only activates on URLs matching `*/cpsess*/frontend/*/filemanager/editit.html*`.
- **Your theme, word-wrap and banner preferences** are stored locally in the browser.

No software is "100% secure", and this README won't pretend otherwise. If you find a problem, please email [monirsaikat1@gmail.com](mailto:monirsaikat1@gmail.com).

## How it works

```
cPanel editor page (editit.html)
│
├── content.js   hides cPanel's editor, reads file/dir from the URL,
│                and loads/saves the file via cPanel's UAPI
│
└── <iframe> editor.html   the Monaco UI, running from the extension
                           itself, so cPanel's Content Security Policy
                           can't block it
        ▲
        └── the two talk to each other with postMessage
```

Because the extension uses cPanel's public API instead of hooking into the built-in editor's JavaScript, cPanel updates to its own editor shouldn't break it.

## Development

```
cp-monaco/
├── extension/            ← the folder Chrome loads
│   ├── manifest.json
│   ├── content.js        runs on the cPanel page; load/save via UAPI
│   ├── content.css       hides the original editor
│   ├── editor.html       Monaco UI (inside the iframe)
│   ├── editor.js
│   ├── editor.css
│   ├── themes.js         theme definitions (add your own here)
│   ├── popup.html/.css/.js   the toolbar popup
│   ├── icons/            logo.svg + PNG icons (16/32/48/128)
│   └── monaco/           copied from node_modules by npm install (git-ignored)
├── scripts/
│   └── copy-monaco.js
└── package.json
```

- After editing any file in `extension/`, click the **reload** icon on the extension's card in `chrome://extensions`, then reload the cPanel tab.
- To update Monaco, change the `monaco-editor` version in `package.json` and run `npm install`. The extension uses Monaco's AMD build (`min/vs`).
- To add a theme, copy one of the entries in `extension/themes.js` and change its colors. `palette` controls syntax colors and `ui` controls the toolbar around the editor.
- To share a build, zip the `extension` folder **after** running `npm install`, so it includes `monaco/`.

## Compatibility

- **Browsers:** Chrome and other Chromium-based browsers (Manifest V3).
- **cPanel:** written for the File Manager editor in the Jupiter theme, and any theme whose editor URL matches `*/cpsess*/frontend/*/filemanager/editit.html*`.

## Author

**Monir Saikat**, [monirsaikat1@gmail.com](mailto:monirsaikat1@gmail.com)

Questions, bug reports and feature requests are welcome by email.

## License

Released under the [MIT License](LICENSE). Copyright © 2026 Monir Saikat.

In plain terms:

- ✅ You can use it for free, personally or commercially.
- ✅ You can modify it, fork it and share your own versions.
- ✅ You can include it in other projects, including paid ones.
- 📌 You must keep the copyright notice and license text in any copy you share.
- ⚠️ It comes with no warranty. Keep backups of files you care about.

This summary is just for convenience. The [LICENSE](LICENSE) file is what legally applies.

**Third-party code:** the extension bundles [Monaco Editor](https://github.com/microsoft/monaco-editor), © Microsoft Corporation, also MIT-licensed. Its `LICENSE` and `ThirdPartyNotices.txt` are copied into `extension/monaco/` by `npm install`, so they're included automatically when you zip the extension.

## Credits

- [Monaco Editor](https://github.com/microsoft/monaco-editor) by Microsoft, MIT License.
- cPanel is a trademark of cPanel, L.L.C. This project is not affiliated with or endorsed by cPanel.
