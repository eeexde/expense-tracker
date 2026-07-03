import { buckets, categories, transactions } from './schema';
import { seedIfEmpty, PRESET_BUCKETS } from './seed';
import { createTestDb } from './testDb';

describe('db schema', () => {
  it('inserts and reads buckets and transactions', async () => {
    const db = createTestDb();
    const [bucket] = await db
      .insert(buckets)
      .values({ name: 'GCash', startingBalance: 10000 })
      .returning();
    await db.insert(transactions).values({
      type: 'expense',
      amount: 5000,
      bucketId: bucket.id,
      date: '2026-07-03',
    });
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(5000);
    expect(rows[0].bucketId).toBe(bucket.id);
  });

  it('seeds presets once, idempotently', async () => {
    const db = createTestDb();
    await seedIfEmpty(db);
    await seedIfEmpty(db);
    const allBuckets = await db.select().from(buckets);
    const allCategories = await db.select().from(categories);
    expect(allBuckets).toHaveLength(PRESET_BUCKETS.length);
    expect(allBuckets.map((b) => b.name)).toContain('GCash');
    expect(allCategories.filter((c) => c.type === 'expense').map((c) => c.name)).toContain(
      'Electricity',
    );
    expect(allCategories.filter((c) => c.type === 'income').map((c) => c.name)).toContain(
      'Freelance',
    );
  });
});
