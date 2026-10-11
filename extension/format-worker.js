// Runs Prettier's PHP formatter off the page's main thread, so a big file can't freeze the editor.
// Loaded on demand by php-format.js and shut down again when idle.
'use strict';

// The PHP plugin was written for Node and peeks at `process`; give it a minimal stand-in.
self.process = { env: {}, argv: [], platform: 'browser', versions: {}, cwd: () => '/' };

importScripts('monaco/prettier/standalone.js', 'monaco/prettier/php.js');

self.onmessage = async ({ data: { id, code, options, check } }) => {
  try {
    if (check) {
      // Parsing alone finds a syntax error, and is much quicker than formatting. The newest
      // PHP version the parser knows keeps modern syntax from being flagged.
      self.prettierPlugins.php.parsers.php.parse(code, { phpVersion: '8.5' });
      self.postMessage({ id, ok: true });
      return;
    }
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
      column: loc ? loc.column : 0,
    });
  }
};
