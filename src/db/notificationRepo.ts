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
  /** Native identity ("sbn.key#postTime"); NOT used for dedup — see notifDedupKey. */
  key: string;
}

/**
 * Dedup identity derived from the notification's CONTENT, not the native
 * StatusBarNotification key. Android bumps sbn.postTime every time an app
 * updates/reposts a notification (Gmail does this constantly), so keying on the
 * native id double-logs the same alert. Keying on package+title+text means a
 * repost of the same content dedups, while genuinely different transactions
 * (different amount/merchant/ref in the text) still log. JSON.stringify gives a
 * canonical, collision-proof encoding of the three fields (a null title is
 * distinct from an empty one), using only plain ASCII.
 */
export function notifDedupKey(packageName: string, title: string | null, text: string): string {
  return JSON.stringify([packageName, title ?? undefined, text]);
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
 * The on-device model, when one is available. Called for EVERY item that has at
 * least one candidate amount — not just ambiguous ones — because its first job
 * is deciding whether the notification is a transaction at all. Given the
 * candidate list it picks one by index; it can never supply an amount of its
 * own. Null means "couldn't help": the caller falls back to the rules.
 */
export type LlmClassifier = (
  text: string,
  candidates: number[],
) => Promise<{
  isTransaction: boolean;
  direction: 'expense' | 'income';
  merchant: string | null;
  amountCentavos: number;
} | null>;

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

/**
 * Ceiling on how long ONE ingest pass may spend inside the model, across all
 * items. Not a per-item timeout — llmParser already has one of those, and it is
 * the wrong tool here for two reasons:
 *
 * 1. Ingest is serial (`await` inside the loop below), so N items cost N
 *    timeouts. A week-away drain can be hundreds of items; at 5s each that is a
 *    sync that never visibly finishes and a phone that gets hot doing it.
 * 2. The per-item timeout ABANDONS the inference rather than cancelling it (the
 *    native call keeps running — see llmController.classify). On a device slow
 *    enough to time out once, every later item queues behind the orphan and
 *    times out too, so the worst case is also the common case.
 *
 * Once the budget is gone the remaining items take the rules path, exactly as
 * they would on a device with no model at all. 15s is chosen to cover a typical
 * foreground drain of a handful of notifications outright, while capping the
 * pathological backlog at something a user would describe as "a moment".
 */
const LLM_BUDGET_MS = 15_000;

export async function ingestCaptured(
  db: Db,
  captured: CapturedNotification[],
  nowIso: string,
  llmClassify?: LlmClassifier,
): Promise<IngestSummary> {
  const summary: IngestSummary = { committed: 0, queued: 0, discarded: 0, skipped: 0 };
  // Wall clock already spent on inference in THIS pass. Monotonic clock, so a
  // timezone change or an NTP step mid-drain cannot make the budget go
  // backwards (or, worse, jump past it on the first item).
  let llmSpentMs = 0;
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
    // Dedup on content, not the native key — an app updating its notification
    // reposts with a new native key/postTime but identical content.
    const dedupKey = notifDedupKey(item.packageName, item.title, item.text);
    if (await keyExists(db, dedupKey)) {
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
      notifKey: dedupKey,
      postedAt: item.postedAt,
    };

    // The model, when present, is the authority — it runs for every item with a
    // candidate amount, including ones the rules call high confidence. Those are
    // precisely the dangerous case: "Get up to PHP 500 cashback when you pay
    // bills" reads to the regex as an amount plus an expense verb, and used to
    // auto-commit as a PHP 500 expense the user never made. Best-effort: a
    // native crash, a timeout, or an exhausted LLM_BUDGET_MS leaves `verdict`
    // null and the rules decide.
    let verdict: Awaited<ReturnType<LlmClassifier>> = null;
    if (llmClassify && parsed.amountCandidates.length > 0 && llmSpentMs < LLM_BUDGET_MS) {
      const startedAt = performance.now();
      try {
        verdict = await llmClassify(item.text, parsed.amountCandidates);
      } catch {
        verdict = null;
      } finally {
        llmSpentMs += performance.now() - startedAt;
      }
    }

    if (verdict && !verdict.isTransaction) {
      // Not money moving. Discarded outright rather than queued: promos arrive
      // in bulk and an inbox full of them is worse than the bogus row. The audit
      // row still records what was dropped, and dedups a repost of it.
      await db.insert(pendingNotifications).values({ ...base, status: 'discarded' });
      summary.discarded += 1;
      continue;
    }

    if (verdict) {
      // The amount is one of OUR candidates (the model only sent back an index),
      // so it is a figure that literally appears in the notification text.
      // Merchant still prefers the regex capture: it comes from the text
      // verbatim, while the model's is a paraphrase.
      const mergedRow = {
        ...base,
        parsedAmount: verdict.amountCentavos,
        parsedType: verdict.direction,
        parsedMerchant: base.parsedMerchant ?? verdict.merchant,
      };
      await insertParsedTransaction(db, source, mergedRow, rules);
      await db.insert(pendingNotifications).values({ ...mergedRow, status: 'committed' });
      summary.committed += 1;
      continue;
    }

    // Rules-only path: no model on this device, or it declined to answer. The
    // promotional heuristic in parseNotification is what stands in for the
    // model's isTransaction judgement here (confidence 'none').
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

/**
 * Every commit runs through one chain.
 *
 * `commitPendingLocked` is a check-then-insert spanning four awaits, and two
 * callers reach it independently: the inbox screen's Confirm/Save, and
 * `expirePending` from `syncNotifications` on app start and on every
 * AppState -> active. Unserialised, the second caller passes the
 * `sourceNotifKey` existence check three awaits before the first one inserts,
 * and one notification becomes two transactions.
 *
 * `db.transaction()` cannot carry this guarantee. Both drizzle drivers this app
 * uses — expo-sqlite on device, better-sqlite3 in tests — implement it
 * synchronously (`begin`, call the callback, `commit`; see
 * drizzle-orm/expo-sqlite/session.js), so an async callback would commit at its
 * first await, before the insert, and buy nothing. Every writer here is on the
 * one JS thread, so a promise chain is what actually keeps a tap and a
 * foregrounding sync from interleaving. Same shape as the ingest chain in
 * lib/notificationSync.ts.
 */
let commitChain: Promise<unknown> = Promise.resolve();
function serialiseCommit<T>(work: () => Promise<T>): Promise<T> {
  const next = commitChain.then(work, work);
  commitChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function commitPending(
  db: Db,
  id: number,
  overrides: CommitOverrides = {},
): Promise<void> {
  return serialiseCommit(async () => {
    if (!(await commitPendingLocked(db, id, overrides))) {
      throw new Error(`No pending notification ${id}`);
    }
  });
}

/**
 * The commit itself — only ever called with the commit chain held. Returns
 * false when the row is no longer pending, i.e. someone else already took it.
 */
async function commitPendingLocked(
  db: Db,
  id: number,
  overrides: CommitOverrides,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(pendingNotifications)
    .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
  if (!row) return false;

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
    return true;
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
  // Status guard is belt-and-braces now that the commit chain owns the race.
  await db
    .update(pendingNotifications)
    .set({ status: 'committed' })
    .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
  return true;
}

/**
 * Only pending rows can be discarded; double-tap discard is a harmless no-op.
 *
 * On the same chain as the commits, and for the same reason: the inbox renders
 * Confirm and Discard on one row while `expirePending` auto-commits those very
 * rows from `syncNotifications` on every foreground. Off the chain this bare
 * UPDATE lands inside `commitPendingLocked`, between its status/sourceNotifKey
 * checks and its insert — the row flips to 'discarded', the transaction is
 * written anyway, and the final status flip no-ops. That state is
 * unrecoverable: the row is no longer pending, so the idempotent-recovery
 * branch can never reach it, and the user sees money they just declined.
 */
export function discardPending(db: Db, id: number): Promise<void> {
  return serialiseCommit(async () => {
    await db
      .update(pendingNotifications)
      .set({ status: 'discarded' })
      .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
  });
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
      // Straight onto the commit chain rather than through commitPending: the
      // user can confirm or discard this very row from the inbox between the
      // listPending above and our turn on the chain, and that is a skip, not an
      // error that should abort the rest of the pass.
      if (await serialiseCommit(() => commitPendingLocked(db, row.id, {}))) {
        summary.committed += 1;
      }
    }
  }
  return summary;
}
