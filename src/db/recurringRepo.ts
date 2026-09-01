import { and, asc, eq, inArray } from 'drizzle-orm';
import { Bucket, buckets, recurring, recurringBuckets, recurringEvents, RecurringEvent } from './schema';

type Db = any;

/**
 * The ordered chain of buckets a rule draws from: its own `bucketId` first,
 * then every `recurring_buckets` row by position.
 *
 * Duplicates are dropped rather than rejected — a fallback that repeats an
 * earlier link would only be re-asked the same question and given the same
 * answer, and silently collapsing it keeps the form from having to police it.
 */
export async function bucketChain(
  db: Db,
  rule: { id: number; bucketId: number },
): Promise<number[]> {
  const rows: { bucketId: number }[] = await db
    .select({ bucketId: recurringBuckets.bucketId })
    .from(recurringBuckets)
    .where(eq(recurringBuckets.recurringId, rule.id))
    .orderBy(asc(recurringBuckets.position));
  const chain = [rule.bucketId];
  for (const row of rows) if (!chain.includes(row.bucketId)) chain.push(row.bucketId);
  return chain;
}

/** Every rule's chain in one pass, for list screens. Keyed by recurring id. */
export async function allBucketChains(db: Db): Promise<Map<number, number[]>> {
  const rules: { id: number; bucketId: number }[] = await db
    .select({ id: recurring.id, bucketId: recurring.bucketId })
    .from(recurring);
  const rows: { recurringId: number; bucketId: number }[] = await db
    .select({ recurringId: recurringBuckets.recurringId, bucketId: recurringBuckets.bucketId })
    .from(recurringBuckets)
    .orderBy(asc(recurringBuckets.position));
  const chains = new Map<number, number[]>(rules.map((r) => [r.id, [r.bucketId]]));
  for (const row of rows) {
    const chain = chains.get(row.recurringId);
    if (chain && !chain.includes(row.bucketId)) chain.push(row.bucketId);
  }
  return chains;
}

/**
 * Replace a rule's fallbacks (positions 1..n). The primary stays in
 * `recurring.bucketId` and is not passed here; a fallback equal to it, or
 * repeated, is dropped so positions stay dense.
 */
export async function setFallbackBuckets(
  db: Db,
  ruleId: number,
  primaryBucketId: number,
  fallbackBucketIds: number[],
): Promise<void> {
  await db.delete(recurringBuckets).where(eq(recurringBuckets.recurringId, ruleId));
  const seen = new Set<number>([primaryBucketId]);
  const values = [] as { recurringId: number; bucketId: number; position: number }[];
  for (const bucketId of fallbackBucketIds) {
    if (seen.has(bucketId)) continue;
    seen.add(bucketId);
    values.push({ recurringId: ruleId, bucketId, position: values.length + 1 });
  }
  if (values.length) await db.insert(recurringBuckets).values(values);
}

/** Chain rows and chain events both point at the rule — clear them first. */
export async function deleteRecurring(db: Db, ruleId: number): Promise<void> {
  await db.delete(recurringBuckets).where(eq(recurringBuckets.recurringId, ruleId));
  await db.delete(recurringEvents).where(eq(recurringEvents.recurringId, ruleId));
  await db.delete(recurring).where(eq(recurring.id, ruleId));
}

/**
 * Record what the chain did on a due, replacing whatever it said before.
 *
 * One row per (rule, due), so a due that was skipped for three cold opens and
 * then posted ends up with the posting's event — or none at all, when the
 * primary bucket paid after all and there is nothing to report.
 */
export async function recordChainEvent(
  db: Db,
  event: {
    recurringId: number;
    date: string;
    kind: 'fallback' | 'skipped';
    bucketId: number | null;
    amount: number;
  },
): Promise<void> {
  await clearChainEvent(db, event.recurringId, event.date);
  await db.insert(recurringEvents).values(event);
}

/** Drop a due's event, or only its event of one kind. */
export async function clearChainEvent(
  db: Db,
  recurringId: number,
  date: string,
  kind?: 'fallback' | 'skipped',
): Promise<void> {
  const due = and(eq(recurringEvents.recurringId, recurringId), eq(recurringEvents.date, date));
  await db
    .delete(recurringEvents)
    .where(kind ? and(due, eq(recurringEvents.kind, kind)) : due);
}

/** Oldest due first — the recurring list keeps the latest per rule. */
export async function listChainEvents(db: Db): Promise<RecurringEvent[]> {
  return db.select().from(recurringEvents).orderBy(asc(recurringEvents.date));
}

/** Bucket rows for a chain, keyed by id, so coverage can read `type`. */
export async function chainBuckets(db: Db, ids: number[]): Promise<Map<number, Bucket>> {
  if (ids.length === 0) return new Map();
  const rows: Bucket[] = await db.select().from(buckets).where(inArray(buckets.id, ids));
  return new Map(rows.map((b) => [b.id, b]));
}
