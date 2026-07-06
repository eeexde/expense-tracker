import { sql } from 'drizzle-orm';
import {
  Bucket,
  buckets,
  categories,
  Category,
  Installment,
  installments,
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
  };
}

/**
 * Insert order satisfies every foreign key (referenced tables first);
 * deletes run in reverse.
 */
const TABLES = [
  { key: 'buckets', table: buckets },
  { key: 'categories', table: categories },
  { key: 'utang', table: utang },
  { key: 'recurring', table: recurring },
  { key: 'installments', table: installments },
  { key: 'transactions', table: transactions },
  { key: 'utangPayments', table: utangPayments },
] as const;

type TableKey = (typeof TABLES)[number]['key'];

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
    if (!Array.isArray(rows)) throw new Error(`Export file is missing the ${key} table`);
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || !Number.isInteger((row as any).id)) {
        throw new Error(`A ${key} row is malformed`);
      }
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
      const rows = payload.data[key];
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
