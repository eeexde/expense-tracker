import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import * as schema from './schema';

export type TestDb = BetterSQLite3Database<typeof schema>;

/**
 * Makes `await expect(...).rejects.toThrow()` work against better-sqlite3.
 *
 * better-sqlite3's `SqliteError` is a hand-rolled constructor
 * (`lib/sqlite-error.js`): it calls `Error.call(this)` and re-parents its
 * prototype rather than `extends Error`, so instances have no [[ErrorData]]
 * slot and `Object.prototype.toString.call(err)` is `[object Object]`, not
 * `[object Error]`. Jest's `isError()` (@jest/expect-utils) therefore falls
 * through to `err instanceof Error`.
 *
 * That `instanceof` is realm-sensitive, and better-sqlite3 binds the error
 * class exactly once per *process*: `lib/database.js` does
 *   `if (!addon.isInitialized) { addon.setErrorConstructor(SqliteError); ... }`
 * on the native addon, which Node caches per process — outside jest's
 * per-test-file module registry. Jest gives every test file its own vm realm
 * with its own `Error`, so from the second better-sqlite3 file onward in a
 * worker, `err instanceof Error` is false. Jest's `toThrow` then leaves
 * `thrown = null` and reports the misleading "Received function did not throw"
 * even though the promise really did reject with a real SqliteError.
 *
 * Net effect: whichever db suite happened to run first in a worker passed and
 * the rest failed, so results moved with `--runInBand` / `--maxWorkers`.
 *
 * Fix: tag the (cross-realm) SqliteError prototype so `Object.prototype
 * .toString` reports `[object Error]`. That short-circuits jest's first check,
 * which is realm-independent, so the `instanceof` never matters. Done here
 * because this factory is the single entry point every suite in both jest
 * projects uses to get a database.
 */
let sqliteErrorTagged = false;
function tagSqliteErrorAsError(sqlite: Database.Database): void {
  if (sqliteErrorTagged) return;
  sqliteErrorTagged = true;
  try {
    sqlite.prepare('not valid sql');
  } catch (error) {
    if (Object.prototype.toString.call(error) === '[object Error]') return;
    Object.defineProperty(Object.getPrototypeOf(error), Symbol.toStringTag, {
      value: 'Error',
      configurable: true,
    });
  }
}

/** In-memory db with real migrations applied — mirrors the on-device db. */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  tagSqliteErrorAsError(sqlite);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
  return db;
}
