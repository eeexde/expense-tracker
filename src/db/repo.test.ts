import { buckets, installments, recurring, utang, utangPayments } from './schema';
import { createTestDb, TestDb } from './testDb';
import {
  addExpense,
  addIncome,
  addTransfer,
  allBucketBalances,
  archiveBucket,
  bucketBalance,
  bucketHasReferences,
  createBucket,
  deleteBucket,
  deleteTransaction,
  listTransactions,
  totalMoney,
  updateBucket,
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

  it('lists transactions filtered by type', async () => {
    const { cash, gcash } = await makeBuckets(db);
    await addExpense(db, { amount: 100, bucketId: cash.id, date: '2026-07-01' });
    await addIncome(db, { amount: 200, bucketId: cash.id, date: '2026-07-02' });
    await addTransfer(db, { amount: 300, bucketId: cash.id, toBucketId: gcash.id, date: '2026-07-03' });

    const incomes = await listTransactions(db, { type: 'income' });
    expect(incomes).toHaveLength(1);
    expect(incomes[0].amount).toBe(200);

    // combines with month + bucket
    const julyCashExpenses = await listTransactions(db, {
      month: '2026-07',
      type: 'expense',
      bucketId: cash.id,
    });
    expect(julyCashExpenses).toHaveLength(1);
    expect(julyCashExpenses[0].amount).toBe(100);
    expect(await listTransactions(db, { month: '2026-06', type: 'expense' })).toHaveLength(0);
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

  it('creates and updates buckets', async () => {
    const bucket = await createBucket(db, { name: '  Wallet ', icon: '👛', startingBalance: 2500 });
    expect(bucket.name).toBe('Wallet');
    expect(bucket.icon).toBe('👛');
    expect(await bucketBalance(db, bucket.id)).toBe(2500);

    await updateBucket(db, bucket.id, { name: 'Coin Purse', startingBalance: 5000 });
    const [updated] = await db.select().from(buckets);
    expect(updated.name).toBe('Coin Purse');
    expect(await bucketBalance(db, bucket.id)).toBe(5000);

    await expect(createBucket(db, { name: '  ' })).rejects.toThrow();
    await expect(updateBucket(db, bucket.id, { startingBalance: 1.5 })).rejects.toThrow();
  });

  it('deletes a bucket only while nothing references it', async () => {
    const { cash } = await makeBuckets(db);
    expect(await bucketHasReferences(db, cash.id)).toBe(false);

    await addExpense(db, { amount: 1000, bucketId: cash.id, date: '2026-07-01' });
    expect(await bucketHasReferences(db, cash.id)).toBe(true);
    await expect(deleteBucket(db, cash.id)).rejects.toThrow();

    const [txn] = await listTransactions(db, {});
    await deleteTransaction(db, txn.id);
    await deleteBucket(db, cash.id);
    expect(await db.select().from(buckets)).toHaveLength(1);
  });

  it('detects references from transfers in, utang payments, recurring, installments', async () => {
    const { cash, gcash } = await makeBuckets(db);

    // transfer destination counts as a reference
    await addTransfer(db, { amount: 100, bucketId: cash.id, toBucketId: gcash.id, date: '2026-07-01' });
    expect(await bucketHasReferences(db, gcash.id)).toBe(true);

    const [pig] = await db.insert(buckets).values({ name: 'Pig' }).returning();
    const [debt] = await db
      .insert(utang)
      .values({ personName: 'Juan', direction: 'iOwe', originalAmount: 5000 })
      .returning();
    await db
      .insert(utangPayments)
      .values({ utangId: debt.id, amount: 1000, date: '2026-07-01', bucketId: pig.id });
    expect(await bucketHasReferences(db, pig.id)).toBe(true);

    const [ruleBucket] = await db.insert(buckets).values({ name: 'Bills' }).returning();
    await db.insert(recurring).values({
      name: 'Rent',
      amount: 500000,
      bucketId: ruleBucket.id,
      frequency: 'monthly',
      dayDue: 1,
      startDate: '2026-07-01',
    });
    expect(await bucketHasReferences(db, ruleBucket.id)).toBe(true);

    const [planBucket] = await db.insert(buckets).values({ name: 'Gadget' }).returning();
    await db.insert(installments).values({
      itemName: 'Phone',
      totalAmount: 1200000,
      monthlyDue: 100000,
      monthsTotal: 12,
      dayDue: 15,
      bucketId: planBucket.id,
      startDate: '2026-07-01',
    });
    expect(await bucketHasReferences(db, planBucket.id)).toBe(true);
  });
});
