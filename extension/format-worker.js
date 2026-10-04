// Runs Prettier's PHP formatter off the page's main thread, so a big file can't freeze the editor.
// Loaded on demand by php-format.js and shut down again when idle.
'use strict';

// The PHP plugin was written for Node and peeks at `process`; give it a minimal stand-in.
self.process = { env: {}, argv: [], platform: 'browser', versions: {}, cwd: () => '/' };

importScripts('monaco/prettier/standalone.js', 'monaco/prettier/php.js');

self.onmessage = async ({ data: { id, code, options } }) => {
  try {
    const formatted = await self.prettier.format(code, {
      parser: 'php',
      plugins: [self.prettierPlugins.php],
      endOfLine: 'auto',
      singleQuote: true,
      ...options,
    });
    self.postMessage({ id, ok: true, code: formatted });
  } catch (err) {
    const loc = err.loc && err.loc.start;
    self.postMessage({
      id,
      ok: false,
      message: String(err.message || err).split('\n')[0].replace(/^Parse Error\s*:\s*/i, ''),
      line: loc ? loc.line : 0,
    });
  }
};
