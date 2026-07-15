import { buckets, categories, installments, recurring } from './schema';
import { createTestDb, TestDb } from './testDb';
import { addExpense, addIncome, addTransfer } from './repo';
import {
  expensesByCategory,
  monthlyCommitments,
  monthSummary,
  sixMonthTrend,
} from './statsRepo';

describe('statsRepo', () => {
  let db: TestDb;
  let cashId: number;
  let gcashId: number;
  let foodId: number;
  let loadId: number;

  beforeEach(async () => {
    db = createTestDb();
    const [cash] = await db.insert(buckets).values({ name: 'Cash' }).returning();
    const [gcash] = await db.insert(buckets).values({ name: 'GCash' }).returning();
    cashId = cash.id;
    gcashId = gcash.id;
    const [food] = await db
      .insert(categories)
      .values({ name: 'Groceries', type: 'expense' })
      .returning();
    const [load] = await db
      .insert(categories)
      .values({ name: 'Load', type: 'expense' })
      .returning();
    foodId = food.id;
    loadId = load.id;

    await addIncome(db, { amount: 1000000, bucketId: cashId, date: '2026-07-01' });
    await addExpense(db, { amount: 300000, bucketId: cashId, date: '2026-07-02', categoryId: foodId });
    await addExpense(db, { amount: 100000, bucketId: gcashId, date: '2026-07-03', categoryId: loadId });
    await addExpense(db, { amount: 50000, bucketId: cashId, date: '2026-06-15', categoryId: foodId });
    // transfers are not income/expense
    await addTransfer(db, { amount: 200000, bucketId: cashId, toBucketId: gcashId, date: '2026-07-02' });
  });

  it('summarizes a month, ignoring transfers', async () => {
    const s = await monthSummary(db, '2026-07');
    expect(s.income).toBe(1000000);
    expect(s.expenses).toBe(400000);
    expect(s.net).toBe(600000);
  });

  it('breaks expenses down by category with percentages', async () => {
    const rows = await expensesByCategory(db, '2026-07');
    expect(rows).toHaveLength(2);
    expect(rows[0].categoryName).toBe('Groceries');
    expect(rows[0].total).toBe(300000);
    expect(rows[0].pct).toBe(75);
    expect(rows[1].categoryName).toBe('Load');
    expect(rows[1].pct).toBe(25);
  });

  it('labels expenses without a category as Uncategorized', async () => {
    await addExpense(db, { amount: 10000, bucketId: cashId, date: '2026-07-05' });
    const rows = await expensesByCategory(db, '2026-07');
    const fallback = rows.find((r) => r.categoryId === null);
    expect(fallback?.categoryName).toBe('Uncategorized');
  });

  it('returns a six month trend ending at the given month', async () => {
    const trend = await sixMonthTrend(db, '2026-07');
    expect(trend).toHaveLength(6);
    expect(trend[0].ym).toBe('2026-02');
    expect(trend[5]).toEqual({ ym: '2026-07', income: 1000000, expenses: 400000 });
    expect(trend[4]).toEqual({ ym: '2026-06', income: 0, expenses: 50000 });
  });

  it('totals monthly commitments: recurring (weekly normalized) + open installments', async () => {
    // monthly rule counts as-is
    await db.insert(recurring).values({
      name: 'Rent',
      amount: 500000,
      bucketId: cashId,
      frequency: 'monthly',
      dayDue: 1,
      startDate: '2026-07-01',
    });
    // weekly rule normalized: 100000 * 52 / 12 = 433333
    await db.insert(recurring).values({
      name: 'Groceries',
      amount: 100000,
      bucketId: cashId,
      frequency: 'weekly',
      dayDue: 0,
      startDate: '2026-07-01',
    });
    // paused rule excluded
    await db.insert(recurring).values({
      name: 'Gym',
      amount: 99999,
      bucketId: cashId,
      frequency: 'monthly',
      dayDue: 5,
      startDate: '2026-07-01',
      active: false,
    });
    // open installment counts its monthly due
    await db.insert(installments).values({
      itemName: 'Phone',
      totalAmount: 1200000,
      monthlyDue: 100000,
      monthsTotal: 12,
      amountPaid: 0,
      dayDue: 10,
      bucketId: cashId,
      startDate: '2026-07-01',
    });
    // fully paid installment excluded
    await db.insert(installments).values({
      itemName: 'Laptop',
      totalAmount: 300000,
      monthlyDue: 50000,
      monthsTotal: 6,
      amountPaid: 300000,
      dayDue: 10,
      bucketId: cashId,
      startDate: '2026-01-01',
    });

    const c = await monthlyCommitments(db);
    expect(c.recurring).toBe(500000 + Math.round((100000 * 52) / 12));
    expect(c.installments).toBe(100000);
    expect(c.total).toBe(c.recurring + c.installments);
  });
});
