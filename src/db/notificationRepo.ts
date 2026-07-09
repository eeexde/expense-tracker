import { and, eq } from 'drizzle-orm';
import { parseNotification } from '../lib/notificationParser';
import { addExpense, addIncome } from './repo';
import {
  CategoryRule,
  categoryRules,
  NotificationSource,
  notificationSources,
  PendingNotification,
  pendingNotifications,
  transactions,
} from './schema';

/** Works against both drizzle drivers, same as repo.ts. */
type Db = any;

/** One captured notification, as drained from the native buffer. */
export interface CapturedNotification {
  packageName: string;
  title: string | null;
  text: string;
  postedAt: string; // ISO UTC from the Kotlin side
  key: string;
}

// ---------- sources ----------

export interface NewSourceInput {
  bucketId: number;
  packageName: string;
  matchKeyword?: string | null;
}

export async function addSource(db: Db, input: NewSourceInput): Promise<NotificationSource> {
  const packageName = input.packageName.trim();
  if (!packageName) throw new Error('Package name is required');
  const [row] = await db
    .insert(notificationSources)
    .values({ ...input, packageName })
    .returning();
  return row;
}

export async function listSources(db: Db): Promise<NotificationSource[]> {
  return db.select().from(notificationSources);
}

export async function updateSource(
  db: Db,
  id: number,
  patch: Partial<NewSourceInput> & { enabled?: boolean },
): Promise<void> {
  if (patch.packageName !== undefined) {
    const packageName = patch.packageName.trim();
    if (!packageName) throw new Error('Package name is required');
    patch = { ...patch, packageName };
  }
  await db.update(notificationSources).set(patch).where(eq(notificationSources.id, id));
}

export async function deleteSource(db: Db, id: number): Promise<void> {
  // Pending rows reference the source; drop them first (they're just audit).
  await db.delete(pendingNotifications).where(eq(pendingNotifications.sourceId, id));
  await db.delete(notificationSources).where(eq(notificationSources.id, id));
}

/** Distinct enabled package names — pushed down to the native listener. */
export async function watchedPackages(db: Db): Promise<string[]> {
  const rows: NotificationSource[] = await db
    .select()
    .from(notificationSources)
    .where(eq(notificationSources.enabled, true));
  return [...new Set(rows.map((r) => r.packageName))];
}

// ---------- category rules ----------

export interface NewRuleInput {
  keyword: string;
  categoryId: number;
  priority?: number;
}

export async function addCategoryRule(db: Db, input: NewRuleInput): Promise<CategoryRule> {
  const keyword = input.keyword.trim().toLowerCase();
  if (!keyword) throw new Error('Keyword is required');
  const [row] = await db
    .insert(categoryRules)
    .values({ ...input, keyword })
    .returning();
  return row;
}

export async function listCategoryRules(db: Db): Promise<CategoryRule[]> {
  return db.select().from(categoryRules);
}

export async function deleteCategoryRule(db: Db, id: number): Promise<void> {
  await db.delete(categoryRules).where(eq(categoryRules.id, id));
}

/**
 * Pure matcher: lowest priority, then lowest id, case-insensitive contains.
 * Deliberately matches against the notification text only (mirroring
 * parseNotification's contract); pickSource's haystack includes the title
 * because card-last-4 routing keywords often live there instead.
 */
export function matchCategory(
  rules: Pick<CategoryRule, 'id' | 'keyword' | 'categoryId' | 'priority'>[],
  text: string,
): number | null {
  const haystack = text.toLowerCase();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const rule of sorted) {
    if (haystack.includes(rule.keyword.toLowerCase())) return rule.categoryId;
  }
  return null;
}

// ---------- ingest ----------

export interface IngestSummary {
  committed: number;
  queued: number;
  discarded: number;
  skipped: number;
}

/**
 * Sources for a package: a keyword source claims the notification only when
 * the keyword appears in title+text; keyword-less source is the fallback.
 */
function pickSource(sources: NotificationSource[], haystack: string): NotificationSource | null {
  const withKeyword = sources.filter((s) => s.matchKeyword);
  for (const s of withKeyword) {
    if (haystack.toLowerCase().includes(s.matchKeyword!.toLowerCase())) return s;
  }
  return sources.find((s) => !s.matchKeyword) ?? null;
}

async function keyExists(db: Db, key: string): Promise<boolean> {
  const [pending] = await db
    .select({ id: pendingNotifications.id })
    .from(pendingNotifications)
    .where(eq(pendingNotifications.notifKey, key))
    .limit(1);
  if (pending) return true;
  const [txn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.sourceNotifKey, key))
    .limit(1);
  return Boolean(txn);
}

/** 'YYYY-MM-DD' in the device's local timezone for an ISO timestamp. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function ingestCaptured(
  db: Db,
  captured: CapturedNotification[],
  nowIso: string,
): Promise<IngestSummary> {
  const summary: IngestSummary = { committed: 0, queued: 0, discarded: 0, skipped: 0 };
  const allSources: NotificationSource[] = await db
    .select()
    .from(notificationSources)
    .where(eq(notificationSources.enabled, true));
  const rules: CategoryRule[] = await listCategoryRules(db);

  for (const item of captured) {
    const candidates = allSources.filter((s) => s.packageName === item.packageName);
    const haystack = `${item.title ?? ''} ${item.text}`;
    const source = pickSource(candidates, haystack);
    if (!source) {
      summary.skipped += 1;
      continue;
    }
    if (await keyExists(db, item.key)) {
      summary.skipped += 1;
      continue;
    }

    const parsed = parseNotification(item.text);
    const base = {
      sourceId: source.id,
      rawTitle: item.title,
      rawText: item.text,
      parsedAmount: parsed.amountCentavos,
      parsedMerchant: parsed.merchant,
      parsedType: parsed.direction,
      notifKey: item.key,
      postedAt: item.postedAt,
    };

    if (parsed.confidence === 'none') {
      await db.insert(pendingNotifications).values({ ...base, status: 'discarded' });
      summary.discarded += 1;
    } else if (parsed.confidence === 'high') {
      // Txn first, audit row second: the reverse order would let keyExists skip
      // this item forever after a crash between the writes, silently dropping a
      // transaction. This order at worst loses the audit row, and dedup via
      // transactions.sourceNotifKey still prevents duplicates.
      await insertParsedTransaction(db, source, base, rules);
      await db.insert(pendingNotifications).values({ ...base, status: 'committed' });
      summary.committed += 1;
    } else {
      await db.insert(pendingNotifications).values({ ...base, status: 'pending' });
      summary.queued += 1;
    }
  }
  return summary;
}

type ParsedRow = {
  sourceId: number;
  rawTitle: string | null;
  rawText: string;
  parsedAmount: number | null;
  parsedMerchant: string | null;
  parsedType: 'expense' | 'income' | null;
  notifKey: string;
  postedAt: string;
};

async function insertParsedTransaction(
  db: Db,
  source: NotificationSource,
  row: ParsedRow,
  rules: CategoryRule[],
): Promise<void> {
  const input = {
    amount: row.parsedAmount!,
    bucketId: source.bucketId,
    date: localDateOf(row.postedAt),
    categoryId: matchCategory(rules, row.rawText) ?? undefined,
    note: row.parsedMerchant ?? undefined,
    sourceNotifKey: row.notifKey,
  };
  if (row.parsedType === 'income') await addIncome(db, input);
  else await addExpense(db, input);
}

// ---------- inbox ----------

export async function listPending(db: Db): Promise<PendingNotification[]> {
  return db
    .select()
    .from(pendingNotifications)
    .where(eq(pendingNotifications.status, 'pending'));
}

export async function pendingCount(db: Db): Promise<number> {
  return (await listPending(db)).length;
}

export interface CommitOverrides {
  amount?: number;
  bucketId?: number;
  categoryId?: number;
  note?: string;
  date?: string;
  type?: 'expense' | 'income';
}

export async function commitPending(
  db: Db,
  id: number,
  overrides: CommitOverrides = {},
): Promise<void> {
  const [row] = await db
    .select()
    .from(pendingNotifications)
    .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
  if (!row) throw new Error(`No pending notification ${id}`);

  // Idempotent recovery: a crash between the txn insert and the status flip
  // leaves a committed transaction behind a still-pending row. Detect it via
  // sourceNotifKey and just finish the flip — never insert a second txn.
  const [existing] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.sourceNotifKey, row.notifKey))
    .limit(1);
  if (existing) {
    await db
      .update(pendingNotifications)
      .set({ status: 'committed' })
      .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
    return;
  }

  const [source] = await db
    .select()
    .from(notificationSources)
    .where(eq(notificationSources.id, row.sourceId));
  const rules: CategoryRule[] = await listCategoryRules(db);

  const amount = overrides.amount ?? row.parsedAmount;
  if (amount == null) throw new Error('Amount is required to commit');
  const input = {
    amount,
    bucketId: overrides.bucketId ?? source.bucketId,
    date: overrides.date ?? localDateOf(row.postedAt),
    categoryId: overrides.categoryId ?? matchCategory(rules, row.rawText) ?? undefined,
    note: overrides.note ?? row.parsedMerchant ?? undefined,
    sourceNotifKey: row.notifKey,
  };
  const type = overrides.type ?? row.parsedType ?? 'expense';
  if (type === 'income') await addIncome(db, input);
  else await addExpense(db, input);
  // Status guard narrows the race with a concurrent commit of the same row.
  await db
    .update(pendingNotifications)
    .set({ status: 'committed' })
    .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
}

/** Only pending rows can be discarded; double-tap discard is a harmless no-op. */
export async function discardPending(db: Db, id: number): Promise<void> {
  await db
    .update(pendingNotifications)
    .set({ status: 'discarded' })
    .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
}

// ---------- expiry ----------

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export interface ExpirySummary {
  committed: number;
  discarded: number;
}

/**
 * Auto-commit pending items older than 2 days (design: untouched inbox items
 * commit); items with no parsable amount are discarded instead.
 */
export async function expirePending(db: Db, nowIso: string): Promise<ExpirySummary> {
  const cutoff = new Date(new Date(nowIso).getTime() - TWO_DAYS_MS).toISOString();
  const rows: PendingNotification[] = await listPending(db);
  const summary: ExpirySummary = { committed: 0, discarded: 0 };
  for (const row of rows) {
    if (row.postedAt >= cutoff) continue;
    if (row.parsedAmount == null) {
      await discardPending(db, row.id);
      summary.discarded += 1;
    } else {
      await commitPending(db, row.id);
      summary.committed += 1;
    }
  }
  return summary;
}
