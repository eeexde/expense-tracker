import { sql } from 'drizzle-orm';
import {
  AppSetting,
  appSettings,
  Bucket,
  buckets,
  categories,
  Category,
  CategoryRule,
  categoryRules,
  Installment,
  installments,
  NotificationSource,
  notificationSources,
  PendingNotification,
  pendingNotifications,
  Recurring,
  recurring,
  Transaction,
  transactions,
  Utang,
  utang,
  UtangPayment,
  utangPayments,
} from './schema';

type Db = any;

export const EXPORT_VERSION = 1;

export interface ExportPayload {
  version: typeof EXPORT_VERSION;
  app: 'kuripot';
  data: {
    buckets: Bucket[];
    categories: Category[];
    utang: Utang[];
    recurring: Recurring[];
    installments: Installment[];
    transactions: Transaction[];
    utangPayments: UtangPayment[];
    /** Added by the notification auto-log feature; absent in pre-auto-log backups. */
    notificationSources?: NotificationSource[];
    pendingNotifications?: PendingNotification[];
    categoryRules?: CategoryRule[];
    /** Added by the on-device LLM feature; absent in older backups. */
    appSettings?: AppSetting[];
  };
}

/**
 * Insert order satisfies every foreign key (referenced tables first);
 * deletes run in reverse.
 */
const TABLES = [
  { key: 'appSettings', table: appSettings },
  { key: 'buckets', table: buckets },
  { key: 'notificationSources', table: notificationSources },
  { key: 'pendingNotifications', table: pendingNotifications },
  { key: 'categories', table: categories },
  { key: 'categoryRules', table: categoryRules },
  { key: 'utang', table: utang },
  { key: 'recurring', table: recurring },
  { key: 'installments', table: installments },
  { key: 'transactions', table: transactions },
  { key: 'utangPayments', table: utangPayments },
] as const;

type TableKey = (typeof TABLES)[number]['key'];

/**
 * Tables added by the notification auto-log feature. Backups written before
 * that feature existed won't have these keys — treat a missing key as an
 * empty table rather than a validation failure so old backups still restore.
 */
const OPTIONAL_TABLES = new Set<TableKey>([
  'notificationSources',
  'pendingNotifications',
  'categoryRules',
  'appSettings',
]);

export async function exportData(db: Db): Promise<ExportPayload> {
  const data = {} as ExportPayload['data'];
  for (const { key, table } of TABLES) {
    data[key] = await db.select().from(table);
  }
  return { version: EXPORT_VERSION, app: 'kuripot', data };
}

/** Throws with a human-readable message when the payload isn't a kuripot export. */
export function validateExportPayload(payload: unknown): asserts payload is ExportPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Not a kuripot export file');
  }
  const p = payload as Record<string, unknown>;
  if (p.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported export version ${String(p.version)} — expected ${EXPORT_VERSION}`);
  }
  if (typeof p.data !== 'object' || p.data === null) {
    throw new Error('Export file has no data section');
  }
  const data = p.data as Record<TableKey, unknown>;
  for (const { key } of TABLES) {
    const rows = data[key];
    if (rows === undefined && OPTIONAL_TABLES.has(key)) continue;
    if (!Array.isArray(rows)) throw new Error(`Export file is missing the ${key} table`);
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) {
        throw new Error(`A ${key} row is malformed`);
      }
      // app_settings is keyed by a text `key`, not an integer `id`.
      const idOk =
        key === 'appSettings'
          ? typeof (row as any).key === 'string' && (row as any).key.length > 0
          : Number.isInteger((row as any).id);
      if (!idOk) throw new Error(`A ${key} row is malformed`);
    }
  }
}

/** SQLite caps bound parameters per statement; stay comfortably under it. */
const INSERT_CHUNK = 50;

/**
 * Replaces ALL app data with the payload's, keeping original ids so every
 * cross-reference survives. Runs inside a transaction — a bad row rolls the
 * whole import back.
 */
export async function importData(db: Db, payload: ExportPayload): Promise<void> {
  validateExportPayload(payload);
  await db.run(sql`BEGIN`);
  try {
    for (const { table } of [...TABLES].reverse()) {
      await db.delete(table);
    }
    for (const { key, table } of TABLES) {
      // Old backups omit the auto-log tables entirely; treat that as empty.
      const rows = payload.data[key] ?? [];
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        if (chunk.length) await db.insert(table).values(chunk);
      }
    }
    await db.run(sql`COMMIT`);
  } catch (error) {
    await db.run(sql`ROLLBACK`);
    throw error;
  }
}
