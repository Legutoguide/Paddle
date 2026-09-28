// Bundles the main process and preload script into single self-contained
// CommonJS files with esbuild, inlining every pure-JS dependency (pdfkit,
// fontkit, qrcode, papaparse, zod, date-fns, nanoid, and their full
// transitive tree). Only 'electron' (provided by the runtime) and
// 'better-sqlite3' (native, can't be bundled into JS) stay external.
//
// This exists specifically to avoid a class of bug where electron-builder's
// own node_modules packaging logic reconstructs its own version of the
// dependency tree and can drop hoisted/deduped transitive packages that
// other packages need (observed with the `call-bind-apply-helpers` family
// pulled in via pdfkit -> fontkit -> deep-equal/object.assign/call-bind).
// Bundling removes the need for electron-builder to reason about any of
// those pure-JS packages at packaging time at all.
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');

async function buildEntry(entry, outfile) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    minify: false,
    external: ['electron', 'better-sqlite3', 'pdfkit'],
    logLevel: 'info',
  });
}

async function main() {
  await buildEntry(path.join(root, 'src/main/main.ts'), path.join(root, 'dist/main/main.js'));
  await buildEntry(path.join(root, 'src/preload/preload.ts'), path.join(root, 'dist/preload/preload.js'));

  // schema.sql is read from disk at runtime via `path.join(__dirname,
  // 'schema.sql')` in db/connection.ts. Because esbuild bundles everything
  // into a single dist/main/main.js, __dirname for ALL inlined code now
  // resolves to dist/main itself (not the original src/main/db/ location),
  // so schema.sql must sit directly beside main.js, not in a db/ subfolder.
  const schemaDest = path.join(root, 'dist/main/schema.sql');
  fs.mkdirSync(path.dirname(schemaDest), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/main/db/schema.sql'), schemaDest);

  console.log('Bundled main.js, preload.js, and copied schema.sql.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
