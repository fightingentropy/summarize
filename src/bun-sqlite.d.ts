declare module "bun:sqlite" {
  export type BunSqliteDatabaseOptions = {
    readonly?: boolean;
  };

  export type BunSqliteStatement = {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => unknown;
  };

  export class Database {
    constructor(filename: string, options?: BunSqliteDatabaseOptions);
    exec(sql: string): void;
    prepare(sql: string): BunSqliteStatement;
    close(): void;
    query<T = unknown>(sql: string): { all: () => T[]; run: () => unknown };
  }
}
