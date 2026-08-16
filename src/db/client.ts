import { drizzle, ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import migrations from '../../drizzle/migrations';
import * as schema from './schema';
import { seedIfEmpty } from './seed';

export type AppDb = ExpoSQLiteDatabase<typeof schema>;

const DB_FILENAME = 'kuripot.db';
/** Where `openDatabaseSync` keeps a named database. */
const DB_DIRECTORY = 'SQLite';

let db: AppDb | null = null;
/**
 * The raw handle from the last open attempt. Kept at module scope so
 * `backupDatabaseFile` can still checkpoint the write-ahead log after an open
 * that never produced a usable `db` — which is the only moment that matters.
 */
let rawHandle: SQLiteDatabase | null = null;

/** Which step of startup failed. Drives what the recovery screen offers. */
export type DbOpenStage = 'open' | 'newer-schema' | 'migrate' | 'seed';

/**
 * A startup failure the user can be told something useful about.
 *
 * `message` is our own plain sentence and is safe to show; `detail` is the
 * driver text behind it (SQL, file paths) and belongs behind "Show details".
 * The app has no cloud sync, so the recovery screen's job is to get the
 * database *off the device* before anything else — see `backupDatabaseFile`.
 */
export class DbOpenError extends Error {
  readonly stage: DbOpenStage;
  readonly detail: string;

  constructor(stage: DbOpenStage, message: string, detail: string) {
    super(message);
    // Identity carried on `name`, not on the prototype chain: whether
    // `instanceof` survives depends on how classes get compiled for the
    // engine, and a recovery screen is the last place to find that out.
    this.name = 'DbOpenError';
    this.stage = stage;
    this.detail = detail;
  }
}

export function isDbOpenError(error: unknown): error is DbOpenError {
  return error instanceof Error && error.name === 'DbOpenError';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `when` is exactly what the migrator writes to `created_at`. */
function bundledMigrationMillis(): number {
  const entries: { when: number }[] = migrations.journal?.entries ?? [];
  return entries.reduce((newest, entry) => Math.max(newest, entry.when), 0);
}

/**
 * The newest migration this database already had applied, or 0 when it has
 * never been migrated.
 *
 * drizzle's migrator compares only this one number against its own migrations
 * and skips everything that is not newer (`sqlite-core/dialect.js`), so an
 * older build opening a database a newer build already migrated runs *none* of
 * its migrations and reports success. The mismatch then surfaces as a random
 * "no such column" three screens away, which is a far worse thing to hand a
 * user than a refusal at the door.
 */
function appliedMigrationMillis(sqlite: SQLiteDatabase): number {
  try {
    const row = sqlite.getFirstSync<{ created_at: number | null }>(
      'SELECT max(created_at) AS created_at FROM __drizzle_migrations',
    );
    return Number(row?.created_at ?? 0);
  } catch {
    // No migrations table yet — a fresh install, not a downgrade.
    return 0;
  }
}

/** Schema versions are timestamps; a date is the part a user can act on. */
function schemaDay(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return 'unknown';
  return new Date(millis).toISOString().slice(0, 10);
}

/** Open (once), migrate, seed. Call from the root provider before rendering. */
export async function openAppDb(): Promise<AppDb> {
  if (db) return db;

  let sqlite: SQLiteDatabase;
  try {
    sqlite = openDatabaseSync(DB_FILENAME, { enableChangeListener: false });
    sqlite.execSync('PRAGMA foreign_keys = ON;');
  } catch (error) {
    throw new DbOpenError('open', 'Kuripot could not open its database file.', messageOf(error));
  }
  rawHandle = sqlite;

  const applied = appliedMigrationMillis(sqlite);
  const bundled = bundledMigrationMillis();
  if (applied > bundled) {
    throw new DbOpenError(
      'newer-schema',
      'This database was written by a newer version of Kuripot.',
      `The database is at schema ${schemaDay(applied)}; this build only knows ${schemaDay(bundled)}. ` +
        'Install that newer version again to open it — your data is untouched.',
    );
  }

  const instance = drizzle(sqlite, { schema });
  try {
    await migrate(instance, migrations);
  } catch (error) {
    throw new DbOpenError(
      'migrate',
      'Kuripot could not upgrade its database to this version.',
      messageOf(error),
    );
  }
  try {
    await seedIfEmpty(instance);
  } catch (error) {
    throw new DbOpenError(
      'seed',
      'Kuripot could not set up its starting data.',
      messageOf(error),
    );
  }

  db = instance;
  return instance;
}

/**
 * Copies the raw SQLite file out through the share sheet.
 *
 * This is the escape hatch for a database the app cannot open: `exportData` in
 * `dataTransfer.ts` selects from every table, so it needs the migration that
 * just failed to have succeeded. The file needs nothing — a later build, or
 * any desktop SQLite, can read it. Nothing here deletes or rewrites anything.
 *
 * Returns false when the device has no way to share a file at all.
 */
export async function backupDatabaseFile(today: string): Promise<boolean> {
  // The last few writes can still be sitting in the write-ahead log, and a
  // copy of the .db alone would silently be missing them.
  try {
    rawHandle?.execSync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Best-effort: copy whatever is already on disk either way.
  }

  const source = new File(Paths.document, DB_DIRECTORY, DB_FILENAME);
  if (!source.exists) throw new Error('No Kuripot database file was found on this device.');
  if (!(await Sharing.isAvailableAsync())) return false;

  const target = new File(Paths.cache, `kuripot-database-${today}.db`);
  if (target.exists) target.delete();
  await source.copy(target);
  await Sharing.shareAsync(target.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Save Kuripot database file',
    UTI: 'public.database',
  });
  return true;
}
