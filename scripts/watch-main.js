// Development watch mode: rebuilds the bundled main process / preload
// scripts on save. Mirrors scripts/build-main.js but stays running.
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');

const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'better-sqlite3', 'pdfkit'],
  logLevel: 'info',
};

function copySchema() {
  const schemaDest = path.join(root, 'dist/main/schema.sql');
  fs.mkdirSync(path.dirname(schemaDest), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/main/db/schema.sql'), schemaDest);
}

async function main() {
  copySchema();

  const mainCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(root, 'dist/main/main.js'),
  });

  const preloadCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.join(root, 'src/preload/preload.ts')],
    outfile: path.join(root, 'dist/preload/preload.js'),
  });

  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  console.log('Watching main process and preload for changes...');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
