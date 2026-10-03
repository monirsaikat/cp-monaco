// Copies Monaco's prebuilt AMD bundle into the extension so it ships fully offline,
// along with the license files (MIT requires them to travel with the code).
const fs = require('fs');
const path = require('path');

const pkg = path.join(__dirname, '..', 'node_modules', 'monaco-editor');
const root = path.join(__dirname, '..', 'extension', 'monaco');

fs.rmSync(root, { recursive: true, force: true });
fs.cpSync(path.join(pkg, 'min', 'vs'), path.join(root, 'vs'), { recursive: true });
for (const file of ['LICENSE', 'ThirdPartyNotices.txt']) {
  fs.copyFileSync(path.join(pkg, file), path.join(root, file));
}
// The project's own license ships inside the extension folder too.
fs.copyFileSync(path.join(__dirname, '..', 'LICENSE'), path.join(__dirname, '..', 'extension', 'LICENSE'));
console.log(`Monaco copied to ${path.relative(process.cwd(), root)}`);
