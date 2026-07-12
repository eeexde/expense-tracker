import { buckets, installments, transactions } from './schema';
import { createTestDb, TestDb } from './testDb';
import {
  installmentRemaining,
  listOpenInstallments,
  recordLinkedInstallmentPayment,
  updateInstallment,
} from './installmentRepo';
import { runCatchUp } from '../lib/recurringEngine';

describe('installmentRepo', () => {
  let db: TestDb;
  let bucketId: number;
  let planId: number;

  beforeEach(async () => {
    db = createTestDb();
    const [b] = await db.insert(buckets).values({ name: 'Cash', startingBalance: 0 }).returning();
    bucketId = b.id;
    const [plan] = await db
      .insert(installments)
      .values({
        itemName: 'Phone',
        totalAmount: 600000,
        monthlyDue: 100000,
        monthsTotal: 6,
        dayDue: 10,
        bucketId,
        startDate: '2026-01-01',
      })
      .returning();
    planId = plan.id;
  });

  it('lists plans with their remaining balance', async () => {
    const open = await listOpenInstallments(db);
    expect(open).toHaveLength(1);
    expect(open[0].remaining).toBe(600000);
  });

  it('records an advance payment and derives monthsPaid', async () => {
    await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 250000 });
    const [plan] = await db.select().from(installments);
    expect(plan.amountPaid).toBe(250000);
    expect(plan.monthsPaid).toBe(2); // 2.5 months covered, floored
    expect(installmentRemaining(plan)).toBe(350000);
  });

  it('a payment slightly under the monthly due still counts the month', async () => {
    // Real payments rarely match the configured due to the centavo.
    await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 95000 });
    const [plan] = await db.select().from(installments);
    expect(plan.amountPaid).toBe(95000);
    expect(plan.monthsPaid).toBe(1); // months left must move with the payment
  });

  it('catch-up skips a month paid slightly under the due and settles the shortfall at the end', async () => {
    await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 95000 });
    // First due (Jan 10) is covered by the linked payment — nothing posts.
    await runCatchUp(db, '2026-01-31');
    expect(await db.select().from(transactions)).toHaveLength(0);
    // Remaining five dues post; the final one collects the ₱50 shortfall too.
    await runCatchUp(db, '2026-06-30');
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(5);
    expect(txns.map((t) => t.amount)).toEqual([100000, 100000, 100000, 100000, 105000]);
    const [plan] = await db.select().from(installments);
    expect(plan.amountPaid).toBe(600000);
    expect(plan.monthsPaid).toBe(6);
  });

  it('rejects payments above the remaining balance', async () => {
    await expect(
      recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 700000 }),
    ).rejects.toThrow(/exceeds/);
  });

  it('hides fully paid plans from the open list', async () => {
    await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 600000 });
    expect(await listOpenInstallments(db)).toHaveLength(0);
  });

  it('catch-up skips months already covered by advance payments', async () => {
    // Advance-pay 3 months before any due date hits.
    await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 300000 });
    await runCatchUp(db, '2026-04-15'); // Jan–Apr dues elapsed (4), 3 covered
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(100000);
    const [plan] = await db.select().from(installments);
    expect(plan.amountPaid).toBe(400000);
    expect(plan.monthsPaid).toBe(4);
  });

  describe('updateInstallment', () => {
    it('updates fields and recomputes the total', async () => {
      await updateInstallment(db, planId, { itemName: 'Laptop', monthlyDue: 150000, monthsTotal: 4, dayDue: 5 });
      const [plan] = await db.select().from(installments);
      expect(plan.itemName).toBe('Laptop');
      expect(plan.monthlyDue).toBe(150000);
      expect(plan.monthsTotal).toBe(4);
      expect(plan.totalAmount).toBe(600000);
      expect(plan.dayDue).toBe(5);
    });

    it('re-derives monthsPaid from what was already paid', async () => {
      await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 300000 });
      // 300k paid = 3 months at 100k; halving the monthly due makes it 6 months
      await updateInstallment(db, planId, { monthlyDue: 50000, monthsTotal: 12 });
      const [plan] = await db.select().from(installments);
      expect(plan.amountPaid).toBe(300000);
      expect(plan.monthsPaid).toBe(6);
      expect(plan.totalAmount).toBe(600000);
    });

    it('rejects shrinking the plan below what was already paid', async () => {
      await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 300000 });
      await expect(updateInstallment(db, planId, { monthlyDue: 100000, monthsTotal: 2 })).rejects.toThrow(
        /already paid/i,
      );
    });

    it('rejects invalid values', async () => {
      await expect(updateInstallment(db, planId, { monthlyDue: 0 })).rejects.toThrow();
      await expect(updateInstallment(db, planId, { monthsTotal: 0 })).rejects.toThrow();
      await expect(updateInstallment(db, planId, { dayDue: 32 })).rejects.toThrow();
      await expect(updateInstallment(db, planId, { itemName: '  ' })).rejects.toThrow();
      await expect(updateInstallment(db, 999, { itemName: 'X' })).rejects.toThrow(/no installment/i);
    });
  });

  it('catch-up clamps the final posting after a partial advance', async () => {
    // 5.5 months paid in advance — only 50k is left on the plan.
    await recordLinkedInstallmentPayment(db, { installmentId: planId, amount: 550000 });
    await runCatchUp(db, '2026-12-31');
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(50000);
    const [plan] = await db.select().from(installments);
    expect(plan.amountPaid).toBe(600000);
    expect(plan.monthsPaid).toBe(6);
    // nothing more ever posts
    const again = await runCatchUp(db, '2027-06-30');
    expect(again.posted).toHaveLength(0);
  });
});
