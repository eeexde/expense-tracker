import { buckets } from './schema';
import { createTestDb, TestDb } from './testDb';
import {
  addExpense,
  addIncome,
  addTransfer,
  allBucketBalances,
  archiveBucket,
  bucketBalance,
  deleteTransaction,
  listTransactions,
  totalMoney,
  updateTransaction,
} from './repo';

async function makeBuckets(db: TestDb) {
  const [cash] = await db
    .insert(buckets)
    .values({ name: 'Cash', startingBalance: 100000 })
    .returning();
  const [gcash] = await db
    .insert(buckets)
    .values({ name: 'GCash', startingBalance: 50000 })
    .returning();
  return { cash, gcash };
}

describe('repo', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('derives balance from starting balance, income, expenses', async () => {
    const { cash } = await makeBuckets(db);
    await addIncome(db, { amount: 20000, bucketId: cash.id, date: '2026-07-01' });
    await addExpense(db, { amount: 5000, bucketId: cash.id, date: '2026-07-02' });
    expect(await bucketBalance(db, cash.id)).toBe(100000 + 20000 - 5000);
  });

  it('transfer moves money between buckets, total unchanged', async () => {
    const { cash, gcash } = await makeBuckets(db);
    const before = await totalMoney(db);
    await addTransfer(db, { amount: 30000, bucketId: cash.id, toBucketId: gcash.id, date: '2026-07-02' });
    expect(await bucketBalance(db, cash.id)).toBe(70000);
    expect(await bucketBalance(db, gcash.id)).toBe(80000);
    expect(await totalMoney(db)).toBe(before);
  });

  it('lists transactions filtered by month and bucket', async () => {
    const { cash, gcash } = await makeBuckets(db);
    await addExpense(db, { amount: 100, bucketId: cash.id, date: '2026-06-30' });
    await addExpense(db, { amount: 200, bucketId: cash.id, date: '2026-07-15' });
    await addExpense(db, { amount: 300, bucketId: gcash.id, date: '2026-07-20' });
    const julyAll = await listTransactions(db, { month: '2026-07' });
    expect(julyAll).toHaveLength(2);
    const julyCash = await listTransactions(db, { month: '2026-07', bucketId: cash.id });
    expect(julyCash).toHaveLength(1);
    expect(julyCash[0].amount).toBe(200);
  });

  it('rejects non-positive amounts', async () => {
    const { cash } = await makeBuckets(db);
    await expect(addExpense(db, { amount: 0, bucketId: cash.id, date: '2026-07-01' })).rejects.toThrow();
    await expect(addIncome(db, { amount: -5, bucketId: cash.id, date: '2026-07-01' })).rejects.toThrow();
  });

  it('updates and deletes transactions', async () => {
    const { cash } = await makeBuckets(db);
    const txn = await addExpense(db, { amount: 1000, bucketId: cash.id, date: '2026-07-01' });
    await updateTransaction(db, txn.id, { amount: 2500, note: 'lunch' });
    expect(await bucketBalance(db, cash.id)).toBe(97500);
    await deleteTransaction(db, txn.id);
    expect(await bucketBalance(db, cash.id)).toBe(100000);
  });

  it('archives buckets and excludes them from balance listings', async () => {
    const { cash, gcash } = await makeBuckets(db);
    await archiveBucket(db, gcash.id);
    const balances = await allBucketBalances(db);
    expect(balances.map((b) => b.bucket.id)).toEqual([cash.id]);
    expect(balances[0].balance).toBe(100000);
  });
});
