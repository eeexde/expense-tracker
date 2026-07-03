import { buckets, categories } from './schema';
import { createTestDb, TestDb } from './testDb';
import { addExpense, addIncome, addTransfer } from './repo';
import { expensesByCategory, monthSummary, sixMonthTrend } from './statsRepo';

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

  it('returns a six month trend ending at the given month', async () => {
    const trend = await sixMonthTrend(db, '2026-07');
    expect(trend).toHaveLength(6);
    expect(trend[0].ym).toBe('2026-02');
    expect(trend[5]).toEqual({ ym: '2026-07', income: 1000000, expenses: 400000 });
    expect(trend[4]).toEqual({ ym: '2026-06', income: 0, expenses: 50000 });
  });
});
