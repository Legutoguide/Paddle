// electron-builder afterPack hook.
//
// ROOT CAUSE THIS WORKS AROUND:
// electron-builder's own "files" copy step (independent of asar on/off, and
// independent of npmRebuild) reconstructs its own layout of node_modules
// rather than a faithful copy of what's on disk. For npm-hoisted/deduped
// packages that are required by several sibling packages (e.g.
// `call-bind-apply-helpers`, needed by `call-bind`, `get-intrinsic`,
// `dunder-proto`, and `call-bound`), it has been observed to keep the
// package nested under only ONE of those consumers (e.g.
// node_modules/call-bind/node_modules/call-bind-apply-helpers) while
// dropping the root-level node_modules/call-bind-apply-helpers copy that
// the OTHER consumers rely on via Node's normal upward module resolution.
// This breaks at runtime with "Cannot find module 'call-bind-apply-helpers'"
// even though the package genuinely is present in the packaged app —
// just not reachable from where it's required.
//
// THE FIX: after electron-builder finishes copying files, walk the packaged
// node_modules tree, and for every package name that exists ANYWHERE in that
// tree (at any nesting depth) but is NOT also present at the top-level
// node_modules, copy it up to the top level. This restores npm's hoisting
// invariant — "a package used by multiple consumers is reachable from the
// app root" — without pulling in anything that wasn't already going to be
// packaged (we only ever look at packages electron-builder already decided
// to include somewhere), so this cannot accidentally bundle unrelated
// devDependencies.
const fs = require('node:fs');
const path = require('node:path');

/** Find the first occurrence of every package name under `dir`, at any depth. */
function findAllPackages(dir, found = new Map(), depth = 0) {
  if (depth > 12) return found; // sane recursion guard
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);

    if (entry.name.startsWith('@')) {
      // Scoped packages: one more directory level, e.g. @scope/name.
      findAllPackages(full, found, depth + 1);
      continue;
    }

    if (entry.name === '.bin') continue;

    const pkgJson = path.join(full, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const relativeName = path.relative(dir, full).split(path.sep).join('/');
      // Reconstruct the real package name (handles the @scope case: when we
      // recursed into a scope dir, `dir` is the scope dir itself, so join
      // with its parent's basename).
      const parentName = path.basename(dir).startsWith('@') ? path.basename(dir) : null;
      const name = parentName ? `${parentName}/${entry.name}` : entry.name;
      if (!found.has(name)) {
        found.set(name, full);
      }
    }

    // Recurse into this package's own node_modules, if any, to find nested copies too.
    const nestedModules = path.join(full, 'node_modules');
    if (fs.existsSync(nestedModules)) {
      findAllPackages(nestedModules, found, depth + 1);
    }
  }

  return found;
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

exports.default = async function afterPack(context) {
  const platformName = context.electronPlatformName; // 'win32', 'darwin', 'linux'
  const appDir =
    platformName === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
      : path.join(context.appOutDir, 'resources', 'app');

  const packagedModules = path.join(appDir, 'node_modules');
  if (!fs.existsSync(packagedModules)) {
    console.log('[afterPack] No unpacked node_modules found (asar enabled?) — skipping hoisting repair.');
    return;
  }

  const allPackages = findAllPackages(packagedModules);
  let repaired = 0;

  for (const [name, fullPath] of allPackages) {
    const rootPath = path.join(packagedModules, ...name.split('/'));
    if (fs.existsSync(rootPath)) continue; // already reachable at root — fine
    if (fullPath === rootPath) continue;

    copyRecursive(fullPath, rootPath);
    repaired++;
    console.log(`[afterPack] Restored root hoisting for "${name}" (was only nested under a sibling package).`);
  }

  console.log(`[afterPack] Node_modules hoisting repair complete: ${repaired} package(s) restored to root.`);
};
