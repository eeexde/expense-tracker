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
  RecurringBucket,
  recurringBuckets,
  RecurringEvent,
  recurringEvents,
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
    /** Added by the recurring fallback chain; absent in older backups. */
    recurringBuckets?: RecurringBucket[];
    recurringEvents?: RecurringEvent[];
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
  { key: 'recurringBuckets', table: recurringBuckets },
  { key: 'recurringEvents', table: recurringEvents },
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
  // Added by the recurring fallback chain, after this export version shipped.
  'recurringBuckets',
  'recurringEvents',
]);

/** Date columns are 'YYYY-MM-DD' local strings — see CLAUDE.md. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-table money/date column rules, mirroring the guards the repo layer runs
 * on every write (`repo.ts` assertPositive, `utangRepo` / `installmentRepo`).
 *
 * `importData` bulk-inserts raw rows, so nothing else re-checks them. That
 * matters most for signs: `bucketBalance` negates expenses in SQL, so a
 * negative `transactions.amount` would silently *add* to the balance instead
 * of subtracting. A malformed `date` is the same class of bug in the other
 * direction — invisible to every month-filtered view, still counted in
 * `totalMoney`.
 *
 * Nullability is deliberately left to SQLite: a NOT NULL violation surfaces
 * inside `importData`'s transaction and rolls the whole restore back, so the
 * rules below skip null/undefined and check only what SQLite cannot — sign,
 * integer-ness and date shape.
 */
interface ColumnRules {
  /** Integer centavos, strictly positive. */
  positive?: readonly string[];
  /** Integer centavos, zero allowed (running totals). */
  nonNegative?: readonly string[];
  /** Integer centavos, any sign — credit-card buckets legitimately run negative. */
  signed?: readonly string[];
  /** 'YYYY-MM-DD' local dates. (`pendingNotifications.postedAt` is ISO UTC, so not here.) */
  date?: readonly string[];
}

const COLUMN_RULES: Partial<Record<TableKey, ColumnRules>> = {
  buckets: { signed: ['startingBalance'] },
  utang: { positive: ['originalAmount'] },
  recurring: {
    positive: ['amount'],
    date: ['startDate', 'endDate', 'lastPostedDate'],
  },
  installments: {
    positive: ['totalAmount', 'monthlyDue'],
    nonNegative: ['amountPaid'],
    date: ['startDate'],
  },
  recurringEvents: { positive: ['amount'], date: ['date'] },
  transactions: { positive: ['amount'], date: ['date'] },
  utangPayments: { positive: ['amount'], date: ['date'] },
  pendingNotifications: { positive: ['parsedAmount'] },
};

/** Message goes straight to the settings screen's status line, so keep it plain. */
function rejectRow(key: TableKey, row: Record<string, unknown>, problem: string): never {
  throw new Error(`Backup rejected — ${key} row ${String(row.id)}: ${problem}. Nothing was imported.`);
}

function validateColumns(key: TableKey, row: Record<string, unknown>): void {
  const rules = COLUMN_RULES[key];
  if (!rules) return;
  const present = (column: string) => row[column] !== null && row[column] !== undefined;

  for (const column of rules.positive ?? []) {
    if (!present(column)) continue;
    const value = row[column];
    if (!Number.isInteger(value) || (value as number) <= 0) {
      rejectRow(key, row, `${column} must be a positive whole number of centavos (got ${String(value)})`);
    }
  }
  for (const column of rules.nonNegative ?? []) {
    if (!present(column)) continue;
    const value = row[column];
    if (!Number.isInteger(value) || (value as number) < 0) {
      rejectRow(key, row, `${column} must be a whole number of centavos, zero or more (got ${String(value)})`);
    }
  }
  for (const column of rules.signed ?? []) {
    if (!present(column)) continue;
    const value = row[column];
    if (!Number.isInteger(value)) {
      rejectRow(key, row, `${column} must be a whole number of centavos (got ${String(value)})`);
    }
  }
  for (const column of rules.date ?? []) {
    if (!present(column)) continue;
    const value = row[column];
    if (typeof value !== 'string' || !DATE_RE.test(value)) {
      rejectRow(key, row, `${column} must be a YYYY-MM-DD date (got ${String(value)})`);
    }
  }
}

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
      validateColumns(key, row as Record<string, unknown>);
    }
  }
}

/** SQLite caps bound parameters per statement; stay comfortably under it. */
const INSERT_CHUNK = 50;

/**
 * Replaces ALL app data with the payload's, keeping original ids so every
 * cross-reference survives.
 *
 * Two layers keep a half-applied restore impossible: `validateExportPayload`
 * runs before `BEGIN`, so a payload with a bad money/date column is rejected
 * without deleting anything; and whatever only SQLite can catch (FKs, NOT
 * NULL) rolls the transaction back.
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
