// Rebuilds ONLY better-sqlite3's native binary for Electron's win32/x64 ABI,
// using @electron/rebuild's programmatic API directly (the CLI on this
// version doesn't expose --platform). Scoped to a single module so it can
// never restructure the rest of node_modules the way electron-builder's
// built-in npmRebuild step did (see electron-builder.json: npmRebuild=false
// and README §"Packaging root-cause notes" for why).
const path = require('node:path');
const { rebuild } = require('@electron/rebuild');

const electronVersion = require('../node_modules/electron/package.json').version;

rebuild({
  buildPath: path.join(__dirname, '..'),
  electronVersion,
  arch: 'x64',
  platform: 'win32',
  onlyModules: ['better-sqlite3'],
  force: true,
})
  .then(() => {
    console.log(`better-sqlite3 rebuilt for Electron ${electronVersion} (win32/x64).`);
  })
  .catch((err) => {
    console.error('Native rebuild for win32/x64 failed:', err);
    process.exit(1);
  });
