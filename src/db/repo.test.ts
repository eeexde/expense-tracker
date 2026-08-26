import { eq, sql } from 'drizzle-orm';
import { buckets, installments, recurring, transactions, utang, utangPayments } from './schema';
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
  listActiveRecurring,
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

/**
 * `allBucketBalances` used to call `bucketBalance` once per bucket, and
 * `bucketBalance` summed a `case` over the *whole* transactions table with no
 * `where` — a full scan per bucket. The grouped rewrite has to land on exactly
 * the same centavo, so the old shape is kept here verbatim as the oracle: any
 * drift in the transfer or credit-card signs shows up as a diff, not as a
 * silently wrong balance.
 */
async function legacyBucketBalance(db: TestDb, bucketId: number): Promise<number> {
  const [bucket] = await db.select().from(buckets).where(eq(buckets.id, bucketId));
  if (!bucket) throw new Error(`No bucket ${bucketId}`);
  const [{ delta }] = await db
    .select({
      delta: sql<number>`coalesce(sum(
        case
          when ${transactions.type} = 'income' and ${transactions.bucketId} = ${bucketId} then ${transactions.amount}
          when ${transactions.type} = 'expense' and ${transactions.bucketId} = ${bucketId} then -${transactions.amount}
          when ${transactions.type} = 'transfer' and ${transactions.bucketId} = ${bucketId} then -${transactions.amount}
          when ${transactions.type} = 'transfer' and ${transactions.toBucketId} = ${bucketId} then ${transactions.amount}
          else 0
        end), 0)`,
    })
    .from(transactions);
  return bucket.startingBalance + delta;
}

async function legacyAllBucketBalances(db: TestDb) {
  const active = await db.select().from(buckets).where(eq(buckets.archived, false));
  const result: { id: number; balance: number }[] = [];
  for (const bucket of active) {
    result.push({ id: bucket.id, balance: await legacyBucketBalance(db, bucket.id) });
  }
  return result;
}

/** Counts prepared statements — one per executed query on both drivers. */
function countStatements(db: TestDb) {
  const client = (db as any).session.client;
  const original = client.prepare.bind(client);
  let n = 0;
  client.prepare = (query: string) => {
    n += 1;
    return original(query);
  };
  return {
    take: () => {
      const taken = n;
      n = 0;
      return taken;
    },
  };
}

describe('bucket balances', () => {
  let db: TestDb;
  let ids: Record<string, number>;

  /**
   * Every shape the `case` expression distinguishes: both sides of a transfer,
   * a credit card living in the negative, a bucket driven to exactly zero, a
   * bucket driven below zero, an untouched bucket, an archived bucket, and the
   * two malformed transfers the app refuses to write but old rows may hold —
   * a self-transfer and a transfer with no destination.
   */
  beforeEach(async () => {
    db = createTestDb();
    const mk = async (name: string, startingBalance: number, extra = {}) =>
      (await db.insert(buckets).values({ name, startingBalance, ...extra }).returning())[0].id;
    ids = {
      cash: await mk('Cash', 100000),
      gcash: await mk('GCash', 50000),
      card: await mk('Card', -25000, { type: 'credit' as const }),
      zero: await mk('Zeroed', 30000),
      negative: await mk('Overdrawn', 1000),
      untouched: await mk('Untouched', 7777),
      archived: await mk('Old', 4242, { archived: true }),
    };

    await addIncome(db, { amount: 20000, bucketId: ids.cash, date: '2026-07-01' });
    await addExpense(db, { amount: 5000, bucketId: ids.cash, date: '2026-07-02' });
    // Card spending pushes a credit bucket further negative; paying it off is a
    // transfer *into* the card.
    await addExpense(db, { amount: 40000, bucketId: ids.card, date: '2026-07-03' });
    await addTransfer(db, {
      amount: 30000,
      bucketId: ids.cash,
      toBucketId: ids.card,
      date: '2026-07-04',
    });
    await addTransfer(db, {
      amount: 10000,
      bucketId: ids.gcash,
      toBucketId: ids.cash,
      date: '2026-07-05',
    });
    await addExpense(db, { amount: 30000, bucketId: ids.zero, date: '2026-07-06' });
    await addExpense(db, { amount: 9000, bucketId: ids.negative, date: '2026-07-07' });
    await addExpense(db, { amount: 1234, bucketId: ids.archived, date: '2026-07-08' });

    const raw = (db as any).session.client;
    raw
      .prepare(
        `insert into transactions (type, amount, bucket_id, to_bucket_id, date, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run('transfer', 6000, ids.gcash, ids.gcash, '2026-07-09', '2026-07-09T00:00:00.000Z');
    raw
      .prepare(
        `insert into transactions (type, amount, bucket_id, to_bucket_id, date, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run('transfer', 500, ids.gcash, null, '2026-07-10', '2026-07-10T00:00:00.000Z');
  });

  it('matches the per-bucket implementation it replaced, bucket for bucket', async () => {
    const fresh = await allBucketBalances(db);
    const legacy = await legacyAllBucketBalances(db);

    expect(fresh.map((b) => ({ id: b.bucket.id, balance: b.balance }))).toEqual(legacy);
    // Not vacuous: the fixture has to exercise negatives and a zero.
    expect(legacy.find((b) => b.id === ids.zero)!.balance).toBe(0);
    expect(legacy.find((b) => b.id === ids.negative)!.balance).toBe(-8000);
    expect(legacy.find((b) => b.id === ids.card)!.balance).toBe(-25000 - 40000 + 30000);
    expect(legacy.find((b) => b.id === ids.untouched)!.balance).toBe(7777);
    expect(fresh.some((b) => b.bucket.id === ids.archived)).toBe(false);
  });

  it('matches it for single buckets too, including the malformed transfers', async () => {
    for (const id of Object.values(ids)) {
      expect(await bucketBalance(db, id)).toBe(await legacyBucketBalance(db, id));
    }
    // A self-transfer is "out" only — the first matching `case` arm wins — so
    // GCash pays the 6000 and never receives it back.
    expect(await bucketBalance(db, ids.gcash)).toBe(50000 - 10000 - 6000 - 500);
  });

  it('totals the same money as the per-bucket implementation', async () => {
    const legacyTotal = (await legacyAllBucketBalances(db)).reduce((acc, b) => acc + b.balance, 0);
    expect(await totalMoney(db)).toBe(legacyTotal);
  });

  it('costs a fixed number of statements instead of one scan per bucket', async () => {
    const counter = countStatements(db);

    counter.take();
    await legacyAllBucketBalances(db);
    const legacyStatements = counter.take();

    await allBucketBalances(db);
    const groupedStatements = counter.take();

    // 6 active buckets: 1 + 2 per bucket, versus one buckets select plus two
    // grouped aggregates.
    expect(legacyStatements).toBe(13);
    expect(groupedStatements).toBe(3);

    // And it stays 3 as buckets are added — the N+1 is gone, not just smaller.
    await createBucket(db, { name: 'Another', startingBalance: 1 });
    await createBucket(db, { name: 'And another', startingBalance: 1 });
    counter.take();
    await allBucketBalances(db);
    expect(counter.take()).toBe(3);
  });
});

describe('listActiveRecurring', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
  });

  it('offers only active rules, ordered by name', async () => {
    const [cash] = await db.insert(buckets).values({ name: 'Cash' }).returning();
    await db.insert(recurring).values([
      {
        name: 'Netflix',
        amount: 54900,
        bucketId: cash.id,
        frequency: 'monthly',
        dayDue: 5,
        startDate: '2026-01-01',
      },
      {
        name: 'Gym',
        amount: 150000,
        bucketId: cash.id,
        frequency: 'monthly',
        dayDue: 1,
        startDate: '2026-01-01',
      },
      {
        // Cancelled subscriptions must not be offered as a link target.
        name: 'Old ISP',
        amount: 199900,
        bucketId: cash.id,
        frequency: 'monthly',
        dayDue: 20,
        startDate: '2025-01-01',
        active: false,
      },
    ]);

    const rules = await listActiveRecurring(db);
    expect(rules.map((r) => r.name)).toEqual(['Gym', 'Netflix']);
  });
});
