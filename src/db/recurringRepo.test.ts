import { eq } from 'drizzle-orm';
import { buckets, recurring, recurringBuckets, recurringEvents } from './schema';
import {
  allBucketChains,
  bucketChain,
  deleteRecurring,
  recordChainEvent,
  setFallbackBuckets,
} from './recurringRepo';
import { bucketHasReferences } from './repo';
import { createTestDb, TestDb } from './testDb';

describe('recurring bucket chains', () => {
  let db: TestDb;
  let cash: number;
  let gcash: number;
  let maya: number;
  let ruleId: number;

  beforeEach(async () => {
    db = createTestDb();
    const made = await db
      .insert(buckets)
      .values([{ name: 'Cash' }, { name: 'GCash' }, { name: 'Maya' }])
      .returning();
    [cash, gcash, maya] = made.map((b) => b.id);
    const [rule] = await db
      .insert(recurring)
      .values({
        name: 'Rent',
        amount: 500000,
        bucketId: cash,
        frequency: 'monthly',
        dayDue: 1,
        startDate: '2026-03-01',
      })
      .returning();
    ruleId = rule.id;
  });

  it('is just the primary bucket for a rule with no fallbacks', async () => {
    expect(await bucketChain(db, { id: ruleId, bucketId: cash })).toEqual([cash]);
  });

  it('puts fallbacks behind the primary, in the order they were saved', async () => {
    await setFallbackBuckets(db, ruleId, cash, [maya, gcash]);
    expect(await bucketChain(db, { id: ruleId, bucketId: cash })).toEqual([cash, maya, gcash]);
  });

  it('drops a fallback that repeats the primary or an earlier link', async () => {
    await setFallbackBuckets(db, ruleId, cash, [gcash, cash, gcash, maya]);
    expect(await bucketChain(db, { id: ruleId, bucketId: cash })).toEqual([cash, gcash, maya]);
    // Positions stay dense, so the unique (rule, position) index still holds.
    const rows = await db
      .select()
      .from(recurringBuckets)
      .where(eq(recurringBuckets.recurringId, ruleId));
    expect(rows.map((r) => r.position).sort()).toEqual([1, 2]);
  });

  it('replaces the whole chain rather than appending to it', async () => {
    await setFallbackBuckets(db, ruleId, cash, [gcash, maya]);
    await setFallbackBuckets(db, ruleId, cash, [maya]);
    expect(await bucketChain(db, { id: ruleId, bucketId: cash })).toEqual([cash, maya]);
  });

  it('reads every rule’s chain in one pass', async () => {
    await setFallbackBuckets(db, ruleId, cash, [gcash]);
    const chains = await allBucketChains(db);
    expect(chains.get(ruleId)).toEqual([cash, gcash]);
  });

  it('clears chain rows and events before deleting the rule', async () => {
    await setFallbackBuckets(db, ruleId, cash, [gcash]);
    await recordChainEvent(db, {
      recurringId: ruleId,
      date: '2026-03-01',
      kind: 'skipped',
      bucketId: null,
      amount: 500000,
    });

    await deleteRecurring(db, ruleId);

    expect(await db.select().from(recurring)).toHaveLength(0);
    expect(await db.select().from(recurringBuckets)).toHaveLength(0);
    expect(await db.select().from(recurringEvents)).toHaveLength(0);
  });

  it('keeps one event per due, replacing what it said before', async () => {
    const event = { recurringId: ruleId, date: '2026-03-01', amount: 500000 };
    await recordChainEvent(db, { ...event, kind: 'skipped', bucketId: null });
    await recordChainEvent(db, { ...event, kind: 'fallback', bucketId: gcash });
    const rows = await db.select().from(recurringEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('fallback');
    expect(rows[0].bucketId).toBe(gcash);
  });

  it('caps fallback history, keeping the most recent dues', async () => {
    for (let i = 1; i <= 20; i += 1) {
      await recordChainEvent(db, {
        recurringId: ruleId,
        date: `2026-03-${String(i).padStart(2, '0')}`,
        kind: 'fallback',
        bucketId: gcash,
        amount: 500000,
      });
    }

    const rows = await db.select().from(recurringEvents);
    expect(rows).toHaveLength(12);
    const dates = rows.map((r: { date: string }) => r.date).sort();
    expect(dates[dates.length - 1]).toBe('2026-03-20');
    expect(dates[0]).toBe('2026-03-09');
  });

  it('never prunes a skipped due, however much fallback history piles up', async () => {
    await recordChainEvent(db, {
      recurringId: ruleId,
      date: '2026-01-01',
      kind: 'skipped',
      bucketId: null,
      amount: 500000,
    });
    for (let i = 1; i <= 20; i += 1) {
      await recordChainEvent(db, {
        recurringId: ruleId,
        date: `2026-03-${String(i).padStart(2, '0')}`,
        kind: 'fallback',
        bucketId: gcash,
        amount: 500000,
      });
    }

    const skipped = await db.select().from(recurringEvents).where(eq(recurringEvents.kind, 'skipped'));
    expect(skipped).toHaveLength(1);
    expect(skipped[0].date).toBe('2026-01-01');
  });

  it('leaves a rule with little history alone', async () => {
    await recordChainEvent(db, {
      recurringId: ruleId,
      date: '2026-03-01',
      kind: 'fallback',
      bucketId: gcash,
      amount: 500000,
    });
    expect(await db.select().from(recurringEvents)).toHaveLength(1);
  });

  it('counts a fallback link as a reference, so its bucket cannot be deleted', async () => {
    expect(await bucketHasReferences(db, gcash)).toBe(false);
    await setFallbackBuckets(db, ruleId, cash, [gcash]);
    expect(await bucketHasReferences(db, gcash)).toBe(true);
  });
});
