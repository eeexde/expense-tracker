import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import * as schema from './schema';

export type TestDb = BetterSQLite3Database<typeof schema>;

/** In-memory db with real migrations applied — mirrors the on-device db. */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
  return db;
}

/**
 * Assert that a statement fails on a sqlite constraint.
 *
 * Don't use `expect(...).rejects.toThrow()` for these: better-sqlite3's
 * SqliteError is built by the native addon, which node caches per *process*,
 * while jest gives every test file its own realm. So the error class belongs to
 * whichever file first opened a database, and in every later file
 * `err instanceof Error` is false — `toThrow()` then reports "did not throw"
 * even though the constraint fired. Which file loses is decided by jest's
 * ordering, so it looks like a flake. Match on the message instead.
 */
export async function expectConstraintError(
  run: () => Promise<unknown>,
  match: RegExp = /constraint failed/i,
): Promise<void> {
  let caught: unknown;
  let threw = false;
  try {
    await run();
  } catch (error) {
    threw = true;
    caught = error;
  }
  if (!threw) throw new Error(`expected ${match} but the statement succeeded`);
  expect(String((caught as { message?: unknown })?.message ?? caught)).toMatch(match);
}
