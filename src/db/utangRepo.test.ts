import { buckets, transactions } from './schema';
import { createTestDb, TestDb } from './testDb';
import { addExpense, bucketBalance } from './repo';
import {
  addUtang,
  addUtangPayment,
  listOpenUtang,
  listUtang,
  recordLinkedUtangPayment,
  updateUtang,
  utangRemaining,
  utangTotals,
} from './utangRepo';
import { utang as utangTable } from './schema';

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

  describe('updateUtang', () => {
    it('updates name, note and amount', async () => {
      const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
      await updateUtang(db, u.id, { personName: 'Juan Dela Cruz', note: 'lunch', originalAmount: 60000 });
      const [row] = await db.select().from(utangTable);
      expect(row.personName).toBe('Juan Dela Cruz');
      expect(row.note).toBe('lunch');
      expect(row.originalAmount).toBe(60000);
    });

    it('rejects shrinking below what was already paid', async () => {
      const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
      await addUtangPayment(db, { utangId: u.id, amount: 30000, date: '2026-07-01', bucketId });
      await expect(updateUtang(db, u.id, { originalAmount: 20000 })).rejects.toThrow(/already paid/i);
      await updateUtang(db, u.id, { originalAmount: 30000 }); // exactly the paid amount settles it
      expect(await utangRemaining(db, u.id)).toBe(0);
    });

    it('allows flipping direction only while unpaid', async () => {
      const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
      await updateUtang(db, u.id, { direction: 'owedToMe' });
      const [row] = await db.select().from(utangTable);
      expect(row.direction).toBe('owedToMe');
      await addUtangPayment(db, { utangId: u.id, amount: 10000, date: '2026-07-01', bucketId });
      await expect(updateUtang(db, u.id, { direction: 'iOwe' })).rejects.toThrow(/payment/i);
    });

    it('rejects invalid values', async () => {
      const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
      await expect(updateUtang(db, u.id, { personName: ' ' })).rejects.toThrow();
      await expect(updateUtang(db, u.id, { originalAmount: 0 })).rejects.toThrow();
      await expect(updateUtang(db, 999, { personName: 'X' })).rejects.toThrow(/no utang/i);
    });
  });

  describe('linked payments (transaction form path)', () => {
    it('records the payment without logging its own transaction', async () => {
      const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 50000 });
      await recordLinkedUtangPayment(db, 'expense', {
        utangId: u.id,
        amount: 20000,
        date: '2026-07-01',
        bucketId,
      });
      expect(await utangRemaining(db, u.id)).toBe(30000);
      // no transaction was written — the caller logs its own linked expense
      expect(await db.select().from(transactions)).toHaveLength(0);

      // the form then saves exactly one expense carrying the link
      await addExpense(db, { amount: 20000, bucketId, date: '2026-07-01', utangId: u.id });
      const txns = await db.select().from(transactions);
      expect(txns).toHaveLength(1);
      expect(txns[0].utangId).toBe(u.id);
      expect(await bucketBalance(db, bucketId)).toBe(80000);
    });

    it('collecting on an owedToMe debt works via income kind', async () => {
      const u = await addUtang(db, {
        personName: 'Maria',
        direction: 'owedToMe',
        originalAmount: 40000,
      });
      await recordLinkedUtangPayment(db, 'income', {
        utangId: u.id,
        amount: 15000,
        date: '2026-07-01',
        bucketId,
      });
      expect(await utangRemaining(db, u.id)).toBe(25000);
    });

    it('rejects overpayment', async () => {
      const u = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 10000 });
      await expect(
        recordLinkedUtangPayment(db, 'expense', {
          utangId: u.id,
          amount: 20000,
          date: '2026-07-01',
          bucketId,
        }),
      ).rejects.toThrow(/exceeds/i);
      expect(await db.select().from(transactions)).toHaveLength(0);
    });

    it('rejects direction mismatches', async () => {
      const iOwe = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 10000 });
      const owedToMe = await addUtang(db, {
        personName: 'Maria',
        direction: 'owedToMe',
        originalAmount: 10000,
      });
      await expect(
        recordLinkedUtangPayment(db, 'income', {
          utangId: iOwe.id,
          amount: 5000,
          date: '2026-07-01',
          bucketId,
        }),
      ).rejects.toThrow();
      await expect(
        recordLinkedUtangPayment(db, 'expense', {
          utangId: owedToMe.id,
          amount: 5000,
          date: '2026-07-01',
          bucketId,
        }),
      ).rejects.toThrow();
    });

    it('lists only debts that still have a balance', async () => {
      const a = await addUtang(db, { personName: 'Juan', direction: 'iOwe', originalAmount: 10000 });
      await addUtang(db, { personName: 'Maria', direction: 'owedToMe', originalAmount: 20000 });
      await addUtangPayment(db, { utangId: a.id, amount: 10000, date: '2026-07-01', bucketId });
      const open = await listOpenUtang(db);
      expect(open).toHaveLength(1);
      expect(open[0].personName).toBe('Maria');
      expect(open[0].remaining).toBe(20000);
    });
  });
});
