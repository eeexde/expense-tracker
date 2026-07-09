import {
  buckets,
  categories,
  categoryRules,
  notificationSources,
  pendingNotifications,
  transactions,
} from './schema';
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

describe('notification auto-log tables', () => {
  it('inserts a source, a pending notification, and a category rule', async () => {
    const db = createTestDb();
    const [bucket] = await db
      .insert(buckets)
      .values({ name: 'GCash' })
      .returning();
    const [source] = await db
      .insert(notificationSources)
      .values({ bucketId: bucket.id, packageName: 'com.globe.gcash.android' })
      .returning();
    expect(source.enabled).toBe(true);

    const [pending] = await db
      .insert(pendingNotifications)
      .values({
        sourceId: source.id,
        rawText: 'You have sent PHP 150.00 to JOLLIBEE',
        notifKey: 'k1',
        postedAt: '2026-07-10T03:00:00Z',
      })
      .returning();
    expect(pending.status).toBe('pending');

    const [cat] = await db
      .insert(categories)
      .values({ name: 'Eating Out', type: 'expense' })
      .returning();
    const [rule] = await db
      .insert(categoryRules)
      .values({ keyword: 'jollibee', categoryId: cat.id })
      .returning();
    expect(rule.priority).toBe(0);
  });

  it('rejects duplicate notifKey', async () => {
    const db = createTestDb();
    const [bucket] = await db.insert(buckets).values({ name: 'B' }).returning();
    const [source] = await db
      .insert(notificationSources)
      .values({ bucketId: bucket.id, packageName: 'x' })
      .returning();
    const row = { sourceId: source.id, rawText: 't', notifKey: 'dup', postedAt: 'now' };
    await db.insert(pendingNotifications).values(row);
    await expect(db.insert(pendingNotifications).values(row)).rejects.toThrow();
  });
});
