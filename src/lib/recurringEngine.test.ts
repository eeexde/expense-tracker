import { buckets, installments, recurring, transactions } from '../db/schema';
import { createTestDb, TestDb } from '../db/testDb';
import { dueDatesBetween, runCatchUp } from './recurringEngine';
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
