# offline-test-shim (dev-only, NOT part of the app)

A tiny adapter that exposes the `better-sqlite3` API on top of Node's built-in
`node:sqlite` (Node >= 22.13). It exists so the DB-backed unit tests can be
executed in a sandbox with **no npm/network access** (this is how the Prime
Paddle reservation tests were run during development).

It is NOT used by the app, NOT bundled by electron-builder (`files` only
includes `dist/**`, `package.json`, `node_modules/**`), and is NOT a
replacement for the real driver. It has no `.backup()` (so `BackupService`
tests fail under it) and it emulates nested transactions with SAVEPOINTs,
which mirrors documented better-sqlite3 behaviour.

## Use (only when you cannot `npm install`)

```bash
mkdir -p /tmp/shim/node_modules/better-sqlite3
cp tools/offline-test-shim/* /tmp/shim/node_modules/better-sqlite3/
echo '{"name":"better-sqlite3","version":"0.0.0-shim","main":"index.js","types":"index.d.ts"}' \
  > /tmp/shim/node_modules/better-sqlite3/package.json
ln -s /tmp/shim/node_modules ./node_modules     # temporary!
tsx --test tests/unit/*.test.ts
rm ./node_modules                                # remove the symlink afterwards
```

On a normal machine ignore this folder and run `npm install`.
