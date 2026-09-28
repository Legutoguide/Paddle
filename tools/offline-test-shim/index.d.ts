declare namespace Database {
  interface RunResult { changes: number; lastInsertRowid: number | bigint; }
  interface Statement<P extends unknown[] = unknown[], R = unknown> {
    run(...params: P): RunResult;
    get(...params: P): R | undefined;
    all(...params: P): R[];
  }
  interface Database {
    prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Statement<P, R>;
    exec(sql: string): this;
    transaction<F extends (...args: any[]) => any>(fn: F): F;
    pragma(source: string, options?: { simple?: boolean }): any;
    close(): void;
  }
}
declare class Database {
  constructor(filename: string, options?: any);
  prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Database.Statement<P, R>;
  exec(sql: string): this;
  transaction<F extends (...args: any[]) => any>(fn: F): F;
  pragma(source: string, options?: { simple?: boolean }): any;
  close(): void;
}
export = Database;
