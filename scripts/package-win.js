#!/usr/bin/env node
// Packages the Windows build, then unconditionally restores better-sqlite3's
// native binary back to the current Node.js ABI afterward — packaging
// rebuilds it for Electron's ABI, which would otherwise break `npm test`
// and `npm run dev` until someone remembers to rebuild it back manually.
const { execSync } = require('node:child_process');

const target = process.argv[2] === 'portable' ? '--win portable' : '--win';

let exitCode = 0;
try {
  execSync(`npm run build`, { stdio: 'inherit' });
  execSync(`npm run rebuild:electron`, { stdio: 'inherit' });
  execSync(`npx electron-builder ${target}`, { stdio: 'inherit' });
} catch (err) {
  exitCode = 1;
  console.error('\nPackaging failed:', err.message);
} finally {
  console.log('\nRestoring better-sqlite3 native binary for local Node.js development...');
  try {
    execSync(`npm run rebuild:node`, { stdio: 'inherit' });
  } catch (restoreErr) {
    console.error('Warning: failed to restore the native module for local dev:', restoreErr.message);
  }
}

process.exit(exitCode);
