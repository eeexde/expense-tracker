import { drizzle, ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';
import migrations from '../../drizzle/migrations';
import * as schema from './schema';
import { seedIfEmpty } from './seed';

export type AppDb = ExpoSQLiteDatabase<typeof schema>;

let db: AppDb | null = null;

/** Open (once), migrate, seed. Call from the root provider before rendering. */
export async function openAppDb(): Promise<AppDb> {
  if (db) return db;
  const sqlite = openDatabaseSync('kuripot.db', { enableChangeListener: false });
  sqlite.execSync('PRAGMA foreign_keys = ON;');
  const instance = drizzle(sqlite, { schema });
  await migrate(instance, migrations);
  await seedIfEmpty(instance);
  db = instance;
  return instance;
}
