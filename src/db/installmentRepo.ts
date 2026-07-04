import { eq } from 'drizzle-orm';
import { Installment, installments } from './schema';

type Db = any;

export interface InstallmentWithRemaining extends Installment {
  remaining: number;
}

/** monthsPaid is display-only, derived from the centavos actually paid. */
export function monthsCovered(plan: Pick<Installment, 'amountPaid' | 'monthlyDue' | 'monthsTotal'>): number {
  return Math.min(Math.floor(plan.amountPaid / plan.monthlyDue), plan.monthsTotal);
}

export function installmentRemaining(plan: Pick<Installment, 'totalAmount' | 'amountPaid'>): number {
  return Math.max(plan.totalAmount - plan.amountPaid, 0);
}

/** Plans that still have a balance, offered for advance payment linking. */
export async function listOpenInstallments(db: Db): Promise<InstallmentWithRemaining[]> {
  const rows: Installment[] = await db.select().from(installments);
  return rows
    .map((row) => ({ ...row, remaining: installmentRemaining(row) }))
    .filter((row) => row.remaining > 0);
}

/**
 * Payment path for an expense saved with an installment link: the expense
 * itself is the money log, so only the plan's paid amount moves here.
 * Advance payments push amountPaid ahead, so the catch-up engine skips
 * the months already covered.
 */
export async function recordLinkedInstallmentPayment(
  db: Db,
  input: { installmentId: number; amount: number },
): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Installment payment must be positive centavos');
  }
  const [plan] = await db
    .select()
    .from(installments)
    .where(eq(installments.id, input.installmentId));
  if (!plan) throw new Error(`No installment ${input.installmentId}`);
  const remaining = installmentRemaining(plan);
  if (input.amount > remaining) {
    throw new Error(`Payment exceeds remaining balance (${remaining} centavos)`);
  }
  const amountPaid = plan.amountPaid + input.amount;
  await db
    .update(installments)
    .set({ amountPaid, monthsPaid: monthsCovered({ ...plan, amountPaid }) })
    .where(eq(installments.id, input.installmentId));
}
