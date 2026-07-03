import { buckets } from './schema';
import { createTestDb, TestDb } from './testDb';
import { bucketBalance } from './repo';
import { addUtang, addUtangPayment, listUtang, utangRemaining, utangTotals } from './utangRepo';

describe('utangRepo', () => {
  let db: TestDb;
  let bucketId: number;

  beforeEach(async () => {
    db = createTestDb();
    const [b] = await db
      .insert(buckets)
      .values({ name: 'Cash', startingBalance: 100000 })
      .returning();
    bucketId = b.id;
  });

  it('partial payments reduce remaining', async () => {
    const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
    await addUtangPayment(db, { utangId: u.id, amount: 20000, date: '2026-07-01', bucketId });
    expect(await utangRemaining(db, u.id)).toBe(30000);
    await addUtangPayment(db, { utangId: u.id, amount: 30000, date: '2026-07-02', bucketId });
    expect(await utangRemaining(db, u.id)).toBe(0);
  });

  it('paying my utang takes money out of the bucket', async () => {
    const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
    await addUtangPayment(db, { utangId: u.id, amount: 20000, date: '2026-07-01', bucketId });
    expect(await bucketBalance(db, bucketId)).toBe(80000);
  });

  it('collecting pautang puts money into the bucket', async () => {
    const u = await addUtang(db, {
      personName: 'Maria',
      direction: 'owedToMe',
      originalAmount: 40000,
    });
    await addUtangPayment(db, { utangId: u.id, amount: 40000, date: '2026-07-01', bucketId });
    expect(await bucketBalance(db, bucketId)).toBe(140000);
  });

  it('lists by direction and totals remaining per direction', async () => {
    const a = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
    await addUtang(db, { personName: 'Maria', direction: 'owedToMe', originalAmount: 40000 });
    await addUtangPayment(db, { utangId: a.id, amount: 10000, date: '2026-07-01', bucketId });
    const iOweList = await listUtang(db, 'iOwe');
    expect(iOweList).toHaveLength(1);
    expect(iOweList[0].remaining).toBe(40000);
    const totals = await utangTotals(db);
    expect(totals.iOwe).toBe(40000);
    expect(totals.owedToMe).toBe(40000);
  });

  it('rejects overpayment beyond remaining', async () => {
    const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 10000 });
    await expect(
      addUtangPayment(db, { utangId: u.id, amount: 20000, date: '2026-07-01', bucketId }),
    ).rejects.toThrow();
  });
});
