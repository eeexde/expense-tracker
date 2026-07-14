import {
  appSettings,
  buckets,
  categories,
  categoryRules,
  installments,
  notificationSources,
  pendingNotifications,
  recurring,
  transactions,
  utang,
  utangPayments,
} from './schema';
import { createTestDb, TestDb } from './testDb';
import { addExpense } from './repo';
import { addUtang, addUtangPayment } from './utangRepo';
import { addCategoryRule, addSource } from './notificationRepo';
import { setSetting } from './settingsRepo';
import { exportData, importData, validateExportPayload } from './dataTransfer';

async function seedSample(db: TestDb) {
  const [bucket] = await db.insert(buckets).values({ name: 'Cash', startingBalance: 100000 }).returning();
  const [cat] = await db.insert(categories).values({ name: 'Food', type: 'expense' }).returning();
  await addExpense(db, { amount: 5000, bucketId: bucket.id, date: '2026-07-01', categoryId: cat.id, note: 'lunch' });
  await db.insert(recurring).values({
    name: 'Rent',
    amount: 800000,
    bucketId: bucket.id,
    frequency: 'monthly',
    dayDue: 1,
    startDate: '2026-01-01',
  });
  await db.insert(installments).values({
    itemName: 'Phone',
    totalAmount: 600000,
    monthlyDue: 100000,
    monthsTotal: 6,
    dayDue: 10,
    bucketId: bucket.id,
    startDate: '2026-01-01',
  });
  const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
  await addUtangPayment(db, { utangId: u.id, amount: 20000, date: '2026-07-02', bucketId: bucket.id });
}

describe('dataTransfer', () => {
  it('round-trips every table with ids intact', async () => {
    const source = createTestDb();
    await seedSample(source);
    const payload = exportDataSync(await exportData(source));

    const target = createTestDb();
    // pre-existing data in the target must be replaced, not merged
    await target.insert(buckets).values({ name: 'Old bucket', startingBalance: 1 });
    await importData(target, payload);

    for (const table of [buckets, categories, transactions, recurring, installments, utang, utangPayments]) {
      const sourceRows = await source.select().from(table as any);
      const targetRows = await target.select().from(table as any);
      expect(targetRows).toEqual(sourceRows);
    }
  });

  it('survives a JSON stringify/parse cycle', async () => {
    const source = createTestDb();
    await seedSample(source);
    const json = JSON.stringify(await exportData(source));
    const target = createTestDb();
    await importData(target, JSON.parse(json));
    expect(await target.select().from(transactions)).toHaveLength(2); // lunch expense + utang payment expense
  });

  it('rejects malformed payloads without touching existing data', async () => {
    const db = createTestDb();
    await db.insert(buckets).values({ name: 'Keep me', startingBalance: 0 });

    await expect(importData(db, null as any)).rejects.toThrow();
    await expect(importData(db, { version: 99, data: {} } as any)).rejects.toThrow(/version/i);
    await expect(importData(db, { version: 1, data: { buckets: 'nope' } } as any)).rejects.toThrow();

    const rows = await db.select().from(buckets);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Keep me');
  });

  it('rolls back when a row violates the schema', async () => {
    const source = createTestDb();
    await seedSample(source);
    const payload = await exportData(source);
    // orphan payment pointing at a missing utang breaks the FK
    (payload.data.utangPayments[0] as any).utangId = 12345;

    const db = createTestDb();
    await db.insert(buckets).values({ name: 'Keep me', startingBalance: 0 });
    await expect(importData(db, payload)).rejects.toThrow();
    const rows = await db.select().from(buckets);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Keep me');
  });

  it('validateExportPayload accepts a fresh export', async () => {
    const source = createTestDb();
    await seedSample(source);
    const payload = await exportData(source);
    expect(() => validateExportPayload(payload)).not.toThrow();
  });

  it('round-trips notification sources, category rules, and pending notifications', async () => {
    const source = createTestDb();
    const [bucket] = await source.insert(buckets).values({ name: 'Cash', startingBalance: 100000 }).returning();
    const [cat] = await source.insert(categories).values({ name: 'Food', type: 'expense' }).returning();
    const notifSource = await addSource(source, {
      bucketId: bucket.id,
      packageName: 'com.bank.app',
      matchKeyword: '1234',
    });
    await addCategoryRule(source, { keyword: 'jollibee', categoryId: cat.id });
    await source.insert(pendingNotifications).values({
      sourceId: notifSource.id,
      rawTitle: 'Payment alert',
      rawText: 'You spent 500 at Jollibee',
      parsedAmount: 50000,
      parsedMerchant: 'Jollibee',
      parsedType: 'expense',
      notifKey: 'key-1',
      postedAt: '2026-07-01T00:00:00.000Z',
      status: 'pending',
    });

    const payload = await exportData(source);
    const target = createTestDb();
    await importData(target, payload);

    for (const table of [notificationSources, categoryRules, pendingNotifications]) {
      const sourceRows = await source.select().from(table as any);
      const targetRows = await target.select().from(table as any);
      expect(targetRows).toEqual(sourceRows);
    }
  });

  it('imports into the same db without a foreign key violation when auto-log rows exist', async () => {
    const db = createTestDb();
    await seedSample(db);
    const [bucket] = await db.select().from(buckets).limit(1);
    const [cat] = await db.select().from(categories).limit(1);
    await addSource(db, { bucketId: bucket.id, packageName: 'com.bank.app' });
    await addCategoryRule(db, { keyword: 'grab', categoryId: cat.id });

    const payload = await exportData(db);
    await expect(importData(db, payload)).resolves.not.toThrow();
  });

  it('imports an old backup that predates the auto-log tables', async () => {
    const source = createTestDb();
    await seedSample(source);
    const payload = await exportData(source);
    delete (payload.data as any).notificationSources;
    delete (payload.data as any).pendingNotifications;
    delete (payload.data as any).categoryRules;

    const target = createTestDb();
    await importData(target, payload);

    expect(await target.select().from(notificationSources)).toHaveLength(0);
    expect(await target.select().from(pendingNotifications)).toHaveLength(0);
    expect(await target.select().from(categoryRules)).toHaveLength(0);
    // old-table data still restores fine
    expect(await target.select().from(buckets)).toHaveLength(1);
  });

  it('round-trips app_settings', async () => {
    const source = createTestDb();
    await seedSample(source);
    await setSetting(source, 'aiParsingEnabled', 'true');

    const payload = await exportData(source);
    const target = createTestDb();
    await importData(target, payload);

    const rows = await target.select().from(appSettings);
    expect(rows).toEqual(await source.select().from(appSettings));
    expect(rows).toEqual([{ key: 'aiParsingEnabled', value: 'true' }]);
  });

  it('imports an old backup that predates app_settings', async () => {
    const source = createTestDb();
    await seedSample(source);
    const payload = await exportData(source);
    delete (payload.data as any).appSettings;

    const target = createTestDb();
    await importData(target, payload);

    expect(await target.select().from(appSettings)).toHaveLength(0);
    // old-table data still restores fine
    expect(await target.select().from(buckets)).toHaveLength(1);
  });
});

/** Identity helper: makes the round-trip test read as export → (serialize) → import. */
function exportDataSync<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload));
}
