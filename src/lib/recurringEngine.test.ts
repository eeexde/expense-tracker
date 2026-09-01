import { buckets, installments, recurring, recurringEvents, transactions } from '../db/schema';
import { setFallbackBuckets } from '../db/recurringRepo';
import { createTestDb, TestDb } from '../db/testDb';
import { dueDatesBetween, isDueDate, runCatchUp } from './recurringEngine';
import { eq } from 'drizzle-orm';

describe('dueDatesBetween', () => {
  const monthly31 = { frequency: 'monthly' as const, dayDue: 31, startDate: '2026-01-01' };

  it('clamps day 31 to end of shorter months (non-leap Feb)', () => {
    expect(dueDatesBetween(monthly31, '2026-01-31', '2026-04-30')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('clamps to Feb 29 on leap years', () => {
    const item = { frequency: 'monthly' as const, dayDue: 30, startDate: '2028-01-01' };
    expect(dueDatesBetween(item, '2028-01-31', '2028-02-29')).toContain('2028-02-29');
  });

  it('returns one date per missed month', () => {
    const item = { frequency: 'monthly' as const, dayDue: 15, startDate: '2026-01-01' };
    expect(dueDatesBetween(item, '2026-01-20', '2026-06-20')).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
      '2026-06-15',
    ]);
  });

  it('respects endDate', () => {
    const item = {
      frequency: 'monthly' as const,
      dayDue: 10,
      startDate: '2026-01-01',
      endDate: '2026-03-01',
    };
    expect(dueDatesBetween(item, '2025-12-31', '2026-12-31')).toEqual([
      '2026-01-10',
      '2026-02-10',
    ]);
  });

  it('handles weekly frequency by weekday', () => {
    // 2026-07-06 is a Monday (dayDue 1)
    const item = { frequency: 'weekly' as const, dayDue: 1, startDate: '2026-07-01' };
    expect(dueDatesBetween(item, '2026-07-01', '2026-07-21')).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
    ]);
  });

  it('does not post before startDate', () => {
    const item = { frequency: 'monthly' as const, dayDue: 5, startDate: '2026-07-01' };
    expect(dueDatesBetween(item, '2026-01-01', '2026-07-31')).toEqual(['2026-07-05']);
  });
});

describe('isDueDate', () => {
  it('recognises the due dates a rule would post on, and only those', () => {
    const item = { frequency: 'monthly' as const, dayDue: 15, startDate: '2026-01-01' };
    expect(isDueDate(item, '2026-07-15')).toBe(true);
    expect(isDueDate(item, '2026-07-14')).toBe(false);
  });

  it('follows the same month-end clamping as the poster', () => {
    const item = { frequency: 'monthly' as const, dayDue: 31, startDate: '2026-01-01' };
    // February has no 31st, so the clamped due is the 28th — not "no due".
    expect(isDueDate(item, '2026-02-28')).toBe(true);
    expect(isDueDate(item, '2026-03-31')).toBe(true);
  });

  it('is false outside the window the rule runs in', () => {
    const item = {
      frequency: 'monthly' as const,
      dayDue: 10,
      startDate: '2026-03-01',
      endDate: '2026-05-31',
    };
    expect(isDueDate(item, '2026-02-10')).toBe(false);
    expect(isDueDate(item, '2026-04-10')).toBe(true);
    expect(isDueDate(item, '2026-06-10')).toBe(false);
  });

  it('matches weekly rules on their weekday only', () => {
    // 2026-07-06 is a Monday (dayDue 1).
    const item = { frequency: 'weekly' as const, dayDue: 1, startDate: '2026-07-01' };
    expect(isDueDate(item, '2026-07-06')).toBe(true);
    expect(isDueDate(item, '2026-07-13')).toBe(true);
    expect(isDueDate(item, '2026-07-07')).toBe(false);
  });
});

describe('runCatchUp', () => {
  let db: TestDb;
  let bucketId: number;

  beforeEach(async () => {
    db = createTestDb();
    const [b] = await db.insert(buckets).values({ name: 'Cash', startingBalance: 0 }).returning();
    bucketId = b.id;
  });

  it('posts all missed recurring dues and updates lastPostedDate', async () => {
    await db.insert(recurring).values({
      name: 'Rent',
      amount: 500000,
      bucketId,
      frequency: 'monthly',
      dayDue: 1,
      startDate: '2026-03-01',
    });
    const summary = await runCatchUp(db, '2026-07-03');
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(5); // Mar, Apr, May, Jun, Jul
    expect(txns.every((t) => t.type === 'expense' && t.amount === 500000)).toBe(true);
    expect(summary.posted).toHaveLength(5);
    const [item] = await db.select().from(recurring);
    expect(item.lastPostedDate).toBe('2026-07-01');
  });

  it('is idempotent on same-day rerun', async () => {
    await db.insert(recurring).values({
      name: 'Netflix',
      amount: 54900,
      bucketId,
      frequency: 'monthly',
      dayDue: 15,
      startDate: '2026-06-01',
    });
    await runCatchUp(db, '2026-07-03');
    const again = await runCatchUp(db, '2026-07-03');
    expect(again.posted).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(1); // Jun 15 only
  });

  it('skips inactive recurring items', async () => {
    await db.insert(recurring).values({
      name: 'Gym',
      amount: 100000,
      bucketId,
      frequency: 'monthly',
      dayDue: 1,
      startDate: '2026-01-01',
      active: false,
    });
    await runCatchUp(db, '2026-07-03');
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('posts installments and completes them at monthsTotal', async () => {
    await db.insert(installments).values({
      itemName: 'Home Credit — TV',
      totalAmount: 1200000,
      monthlyDue: 200000,
      monthsTotal: 6,
      dayDue: 10,
      bucketId,
      startDate: '2026-01-01',
    });
    await runCatchUp(db, '2026-12-31'); // 12 months elapsed, but only 6 dues exist
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(6);
    const [plan] = await db.select().from(installments);
    expect(plan.monthsPaid).toBe(6);
    // second run posts nothing more
    const again = await runCatchUp(db, '2027-06-30');
    expect(again.posted).toHaveLength(0);
  });

  describe('crash between a posted due and its ledger move', () => {
    // runCatchUp runs on EVERY cold open, and posting a due is two unguarded
    // awaits: insert the transaction, then move lastPostedDate / amountPaid.
    // These simulate death after the insert by writing the transaction and
    // leaving the ledger untouched — exactly the state the process leaves.

    it('does not re-post a recurring due whose lastPostedDate never landed', async () => {
      const [r] = await db
        .insert(recurring)
        .values({
          name: 'Rent',
          amount: 500000,
          bucketId,
          frequency: 'monthly',
          dayDue: 1,
          startDate: '2026-03-01',
        })
        .returning();
      // Step 1 only: March's transaction is written, lastPostedDate is not.
      await db.insert(transactions).values({
        type: 'expense',
        amount: 500000,
        bucketId,
        note: 'Rent',
        date: '2026-03-01',
        recurringId: r.id,
      });

      const summary = await runCatchUp(db, '2026-03-15');

      expect(await db.select().from(transactions)).toHaveLength(1); // not two
      expect(summary.posted).toHaveLength(0);
      const [item] = await db.select().from(recurring);
      expect(item.lastPostedDate).toBe('2026-03-01'); // ledger finished instead
    });

    it('resumes an installment batch instead of re-posting its written dues', async () => {
      const [plan] = await db
        .insert(installments)
        .values({
          itemName: 'Laptop',
          totalAmount: 300000,
          monthlyDue: 100000,
          monthsTotal: 3,
          dayDue: 10,
          bucketId,
          startDate: '2026-01-01',
        })
        .returning();
      // Step 1 only, for the first of three missed dues.
      await db.insert(transactions).values({
        type: 'expense',
        amount: 100000,
        bucketId,
        note: 'Laptop',
        date: '2026-01-10',
        installmentId: plan.id,
      });

      await runCatchUp(db, '2026-03-31');

      const txns = await db.select().from(transactions);
      expect(txns).toHaveLength(3); // Jan (recovered), Feb, Mar — not four
      expect(txns.map((t) => t.date)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
      const [after] = await db.select().from(installments);
      expect(after.amountPaid).toBe(300000);
      expect(after.monthsPaid).toBe(3);
    });
  });

  it('links posted txns to their source', async () => {
    const [r] = await db
      .insert(recurring)
      .values({
        name: 'Internet',
        amount: 169900,
        bucketId,
        frequency: 'monthly',
        dayDue: 5,
        startDate: '2026-07-01',
      })
      .returning();
    await runCatchUp(db, '2026-07-06');
    const [txn] = await db.select().from(transactions).where(eq(transactions.recurringId, r.id));
    expect(txn).toBeDefined();
    expect(txn.date).toBe('2026-07-05');
  });
});

/**
 * The ordered fallback chain: bucket 1 pays the whole amount or the chain moves
 * to bucket 2. The charge is never split, and a chain that comes up empty posts
 * nothing at all.
 */
describe('runCatchUp with a fallback bucket chain', () => {
  let db: TestDb;

  const RENT = 500000;

  beforeEach(() => {
    db = createTestDb();
  });

  const makeBucket = async (name: string, startingBalance: number, type: 'bucket' | 'credit' = 'bucket') => {
    const [b] = await db.insert(buckets).values({ name, startingBalance, type }).returning();
    return b.id;
  };

  /** A monthly rule due on the 1st, from `primary` with `fallbacks` behind it. */
  const makeRule = async (primary: number, fallbacks: number[]) => {
    const [r] = await db
      .insert(recurring)
      .values({
        name: 'Rent',
        amount: RENT,
        bucketId: primary,
        frequency: 'monthly',
        dayDue: 1,
        startDate: '2026-03-01',
      })
      .returning();
    await setFallbackBuckets(db, r.id, primary, fallbacks);
    return r.id;
  };

  it('pays from the primary bucket when it covers the whole amount', async () => {
    const primary = await makeBucket('Cash', RENT);
    const backup = await makeBucket('GCash', RENT);
    await makeRule(primary, [backup]);

    const summary = await runCatchUp(db, '2026-03-05');

    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].bucketId).toBe(primary);
    expect(summary.fellBack).toHaveLength(0);
    expect(summary.skipped).toHaveLength(0);
    // Nothing worth telling the user about, so no event row is left behind.
    expect(await db.select().from(recurringEvents)).toHaveLength(0);
  });

  it('falls through to the second bucket when the first is short, without splitting', async () => {
    // One centavo short: enough to pay most of the bill, which is exactly what
    // must NOT happen — the whole charge moves on rather than being split.
    const primary = await makeBucket('Cash', RENT - 1);
    const backup = await makeBucket('GCash', RENT);
    const ruleId = await makeRule(primary, [backup]);

    const summary = await runCatchUp(db, '2026-03-05');

    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].bucketId).toBe(backup);
    expect(txns[0].amount).toBe(RENT); // the whole amount, from one bucket
    expect(summary.posted).toHaveLength(1);
    expect(summary.fellBack).toEqual([
      { name: 'Rent', amount: RENT, date: '2026-03-01', bucketId: backup, bucketName: 'GCash' },
    ]);
    const [item] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    expect(item.lastPostedDate).toBe('2026-03-01');
  });

  it('walks the chain in order, past every bucket that cannot cover', async () => {
    const first = await makeBucket('Cash', 0);
    const second = await makeBucket('GCash', RENT - 100);
    const third = await makeBucket('Maya', RENT);
    await makeRule(first, [second, third]);

    await runCatchUp(db, '2026-03-05');

    const [txn] = await db.select().from(transactions);
    expect(txn.bucketId).toBe(third);
  });

  it('posts nothing at all when no bucket in the chain can cover the amount', async () => {
    const primary = await makeBucket('Cash', 100);
    const backup = await makeBucket('GCash', 200);
    const ruleId = await makeRule(primary, [backup]);

    const summary = await runCatchUp(db, '2026-03-05');

    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(summary.posted).toHaveLength(0);
    expect(summary.skipped).toEqual([
      { name: 'Rent', amount: RENT, date: '2026-03-01', bucketId: null, bucketName: null },
    ]);
    // lastPostedDate must NOT advance, or the due is skipped forever.
    const [item] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    expect(item.lastPostedDate).toBeNull();
  });

  /**
   * The salary-lands-late case, and the reason lastPostedDate is a high-water
   * mark of *settled* dues rather than of dues merely looked at.
   */
  it('retries a skipped due on a later run and posts it under its own due date', async () => {
    const primary = await makeBucket('Cash', 0);
    const ruleId = await makeRule(primary, [await makeBucket('GCash', 0)]);

    const first = await runCatchUp(db, '2026-03-02');
    expect(first.skipped).toHaveLength(1);
    expect(await db.select().from(transactions)).toHaveLength(0);

    // Payday, three days after the due date.
    await db.insert(transactions).values({
      type: 'income',
      amount: 2000000,
      bucketId: primary,
      note: 'Sahod',
      date: '2026-03-04',
    });

    const second = await runCatchUp(db, '2026-03-05');

    expect(second.posted).toEqual([{ name: 'Rent', amount: RENT, date: '2026-03-01' }]);
    const rent = await db.select().from(transactions).where(eq(transactions.recurringId, ruleId));
    expect(rent).toHaveLength(1);
    expect(rent[0].date).toBe('2026-03-01'); // backdated to when it was due
    const [item] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    expect(item.lastPostedDate).toBe('2026-03-01');
    // The warning clears itself once the due is paid.
    expect(await db.select().from(recurringEvents)).toHaveLength(0);
  });

  it('holds every due behind a stalled one, then catches all of them up', async () => {
    // Two months of dues go unpaid. Because lastPostedDate never moved past the
    // first of them, none are lost: funding the chain later pays both, each
    // still dated to its own due date.
    const primary = await makeBucket('Cash', 0);
    const ruleId = await makeRule(primary, [await makeBucket('GCash', 0)]);

    const stalled = await runCatchUp(db, '2026-04-05');
    expect(stalled.skipped.map((s) => s.date)).toEqual(['2026-03-01', '2026-04-01']);
    let [item] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    expect(item.lastPostedDate).toBeNull();
    // One event per due, and only one however many times the app is opened.
    await runCatchUp(db, '2026-04-06');
    expect(await db.select().from(recurringEvents)).toHaveLength(2);

    await db.insert(transactions).values({
      type: 'income',
      amount: RENT * 2,
      bucketId: primary,
      note: 'Sahod',
      date: '2026-04-10',
    });
    const summary = await runCatchUp(db, '2026-04-15');

    expect(summary.posted.map((p) => p.date)).toEqual(['2026-03-01', '2026-04-01']);
    [item] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    expect(item.lastPostedDate).toBe('2026-04-01');
    expect(await db.select().from(recurringEvents)).toHaveLength(0);
  });

  it('clears a skip the user covered by logging the expense themselves', async () => {
    const primary = await makeBucket('Cash', 0);
    const ruleId = await makeRule(primary, [await makeBucket('GCash', 0)]);
    await runCatchUp(db, '2026-03-05');
    expect(await db.select().from(recurringEvents)).toHaveLength(1);

    // The "cover recurring" link on the add-transaction form writes exactly this.
    await db.insert(transactions).values({
      type: 'expense',
      amount: RENT,
      bucketId: primary,
      note: 'Rent (paid in cash)',
      date: '2026-03-01',
      recurringId: ruleId,
    });
    await runCatchUp(db, '2026-03-06');

    expect(await db.select().from(recurringEvents)).toHaveLength(0);
    const [item] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    expect(item.lastPostedDate).toBe('2026-03-01');
  });

  /**
   * A credit bucket's balance is debt, not funds, and the schema carries no
   * limit to check it against — so it always covers, and a card at the end of
   * the chain is what stops a bill going unpaid.
   */
  it('treats a credit bucket as always able to cover, however negative', async () => {
    const primary = await makeBucket('Cash', 0);
    const card = await makeBucket('Visa', -9000000, 'credit');
    await makeRule(primary, [card]);

    const summary = await runCatchUp(db, '2026-03-05');

    const [txn] = await db.select().from(transactions);
    expect(txn.bucketId).toBe(card);
    expect(summary.skipped).toHaveLength(0);
    expect(summary.fellBack).toHaveLength(1);
  });

  it('never reaches a fallback that sits behind a credit bucket', async () => {
    const primary = await makeBucket('Cash', 0);
    const card = await makeBucket('Visa', -100, 'credit');
    const behind = await makeBucket('Savings', RENT * 10);
    await makeRule(primary, [card, behind]);

    await runCatchUp(db, '2026-03-05');

    const [txn] = await db.select().from(transactions);
    expect(txn.bucketId).toBe(card);
  });

  /**
   * The migration adds no `recurring_buckets` rows, so every rule that existed
   * before this feature has a one-link chain — and a one-link chain has no
   * routing decision to make. Such a rule posts unconditionally, exactly as it
   * did before, rather than silently stopping the moment the bucket runs dry.
   */
  it('leaves a rule migrated from the single-bucket shape posting unconditionally', async () => {
    const primary = await makeBucket('Cash', 0);
    const [r] = await db
      .insert(recurring)
      .values({
        name: 'Rent',
        amount: RENT,
        bucketId: primary,
        frequency: 'monthly',
        dayDue: 1,
        startDate: '2026-03-01',
      })
      .returning(); // no setFallbackBuckets — exactly what the migration leaves

    const summary = await runCatchUp(db, '2026-03-05');

    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].bucketId).toBe(primary); // posted into the red, as before
    expect(summary.skipped).toHaveLength(0);
    const [item] = await db.select().from(recurring).where(eq(recurring.id, r.id));
    expect(item.lastPostedDate).toBe('2026-03-01');
  });

  it('re-reads balances per due, so one due can drain the bucket the next needs', async () => {
    // Two dues, and only enough in the primary for one of them.
    const primary = await makeBucket('Cash', RENT);
    const backup = await makeBucket('GCash', RENT * 5);
    await makeRule(primary, [backup]);

    const summary = await runCatchUp(db, '2026-04-05'); // March and April

    const txns = await db.select().from(transactions);
    expect(txns.map((t) => t.bucketId)).toEqual([primary, backup]);
    expect(summary.fellBack.map((f) => f.date)).toEqual(['2026-04-01']);
  });
});
