// Stage the Firefox add-on from the same files used by the Chromium build.
// Keep Firefox-only manifest keys out of extension/manifest.json.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'extension');
const target = path.join(root, 'dist', 'firefox');
const firefoxMonaco = path.join(root, 'node_modules', 'monaco-editor-firefox');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const version = process.env.CPM_VERSION || manifest.version;

if (!/^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){0,3}$/.test(version)) {
  throw new Error(`Invalid Firefox add-on version: ${version}`);
}
for (const file of ['monaco/vs/loader.js', 'monaco/vs/editor/editor.main.js', 'monaco/emmet/emmet-monaco.min.js']) {
  if (!fs.existsSync(path.join(source, file))) {
    throw new Error(`Missing ${file}; run npm ci or npm run build first.`);
  }
}
if (!fs.existsSync(path.join(firefoxMonaco, 'min/vs/editor/editor.main.js'))) {
  throw new Error('Missing Firefox Monaco; run npm ci first.');
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, {
  recursive: true,
  filter: (file) => file !== path.join(source, 'monaco/vs')
    && !/^nls\.messages\..*\.js$/.test(path.basename(file)),
});

// Monaco 0.52's TypeScript worker exceeds Mozilla's 5 MB JavaScript file
// limit. Ship the complete 0.49 Monaco runtime in Firefox so its matching
// worker remains below that limit. All other extension files are identical.
const vsDir = path.join(target, 'monaco/vs');
fs.rmSync(vsDir, { recursive: true, force: true });
fs.cpSync(path.join(firefoxMonaco, 'min/vs'), vsDir, {
  recursive: true,
  filter: (file) => !/^nls\.messages\..*\.js$/.test(path.basename(file)),
});
for (const file of ['LICENSE', 'ThirdPartyNotices.txt']) {
  fs.copyFileSync(path.join(firefoxMonaco, file), path.join(target, 'monaco', file));
}

manifest.version = version;
manifest.author = 'Monir Saikat';
// Firefox runs background scripts as event pages, not service workers.
manifest.background = { scripts: [manifest.background.service_worker] };
manifest.browser_specific_settings = {
  gecko: {
    id: 'cp-monaco@monirsaikat.github.io',
    strict_min_version: '140.0',
    data_collection_permissions: { required: ['websiteContent', 'websiteActivity'] },
  },
};
fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Firefox add-on staged at ${path.relative(root, target)}`);
