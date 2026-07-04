import { buckets, installments, transactions } from './schema';
import { createTestDb, TestDb } from './testDb';
import {
  installmentRemaining,
  listOpenInstallments,
  recordLinkedInstallmentPayment,
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
