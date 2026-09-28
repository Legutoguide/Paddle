// THROWAWAY test adapter: better-sqlite3 API on top of Node's built-in node:sqlite.
// Used only to execute the unit tests in a sandbox without npm access. NOT shipped.
const { DatabaseSync } = require('node:sqlite');
class Database {
  constructor(path) { this._db = new DatabaseSync(path === undefined ? ':memory:' : path); this._depth = 0; }
  prepare(sql) {
    const st = this._db.prepare(sql);
    return {
      run: (...a) => { const r = st.run(...a); return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }; },
      get: (...a) => st.get(...a),
      all: (...a) => st.all(...a),
    };
  }
  exec(sql) { this._db.exec(sql); return this; }
  pragma(src, opts) {
    const rows = this._db.prepare('PRAGMA ' + src).all();
    if (opts && opts.simple) { const r = rows[0]; return r ? Object.values(r)[0] : undefined; }
    return rows;
  }
  transaction(fn) {
    const self = this;
    return function (...args) {
      const d = self._depth; const sp = 'sp' + d;
      self._db.exec(d === 0 ? 'BEGIN' : 'SAVEPOINT ' + sp);
      self._depth++;
      try {
        const r = fn.apply(this, args);
        self._depth--;
        self._db.exec(d === 0 ? 'COMMIT' : 'RELEASE ' + sp);
        return r;
      } catch (e) {
        self._depth--;
        if (d === 0) self._db.exec('ROLLBACK'); else { self._db.exec('ROLLBACK TO ' + sp); self._db.exec('RELEASE ' + sp); }
        throw e;
      }
    };
  }
  close() { this._db.close(); }
}
module.exports = Database;
module.exports.default = Database;
