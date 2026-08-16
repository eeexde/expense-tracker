import { eq } from 'drizzle-orm';
import { Installment, installments, transactions } from './schema';

type Db = any;

export interface InstallmentWithRemaining extends Installment {
  remaining: number;
}

/** Months fully covered by the centavos actually paid — a floor on monthsPaid. */
export function monthsCovered(plan: Pick<Installment, 'amountPaid' | 'monthlyDue' | 'monthsTotal'>): number {
  return Math.min(Math.floor(plan.amountPaid / plan.monthlyDue), plan.monthsTotal);
}

/**
 * Months a single linked payment counts for. Real payments rarely match the
 * configured due to the centavo (fees, rounding), so a payment within 10% of
 * n dues counts as n months — and linking a payment always counts at least
 * one month, otherwise a short payment would stall the months-left display
 * and make catch-up re-post a month the user already paid.
 */
export function monthsFromPayment(amount: number, monthlyDue: number): number {
  return Math.max(1, Math.floor(amount / monthlyDue + 0.1));
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

export interface InstallmentPatch {
  itemName?: string;
  monthlyDue?: number;
  monthsTotal?: number;
  dayDue?: number;
  bucketId?: number;
}

/**
 * Edits the plan's terms. totalAmount is always monthlyDue × monthsTotal and
 * monthsPaid is re-derived, so amountPaid stays the single source of truth.
 */
export async function updateInstallment(db: Db, id: number, patch: InstallmentPatch): Promise<void> {
  const [plan] = await db.select().from(installments).where(eq(installments.id, id));
  if (!plan) throw new Error(`No installment ${id}`);
  if (patch.itemName !== undefined && !patch.itemName.trim()) {
    throw new Error('Item name is required');
  }
  const monthlyDue = patch.monthlyDue ?? plan.monthlyDue;
  const monthsTotal = patch.monthsTotal ?? plan.monthsTotal;
  const dayDue = patch.dayDue ?? plan.dayDue;
  if (!Number.isInteger(monthlyDue) || monthlyDue <= 0) {
    throw new Error('Monthly due must be positive centavos');
  }
  if (!Number.isInteger(monthsTotal) || monthsTotal < 1) {
    throw new Error('Months must be at least 1');
  }
  if (!Number.isInteger(dayDue) || dayDue < 1 || dayDue > 31) {
    throw new Error('Day due must be 1–31');
  }
  const totalAmount = monthlyDue * monthsTotal;
  if (totalAmount < plan.amountPaid) {
    throw new Error(`New total is below what was already paid (${plan.amountPaid} centavos)`);
  }
  await db
    .update(installments)
    .set({
      ...patch,
      ...(patch.itemName !== undefined ? { itemName: patch.itemName.trim() } : {}),
      totalAmount,
      // Never drop below the months already counted as paid; re-derive only
      // pushes the count up (e.g. a smaller monthly due covers more months).
      monthsPaid: Math.min(
        Math.max(plan.monthsPaid, monthsCovered({ amountPaid: plan.amountPaid, monthlyDue, monthsTotal })),
        monthsTotal,
      ),
    })
    .where(eq(installments.id, id));
}

/** monthsPaid after `delta` more centavos land on `plan` — one rule, two callers. */
function monthsAfterPayment(plan: Installment, delta: number): number {
  const amountPaid = plan.amountPaid + delta;
  return Math.min(
    Math.max(
      plan.monthsPaid + monthsFromPayment(delta, plan.monthlyDue),
      monthsCovered({ ...plan, amountPaid }),
    ),
    plan.monthsTotal,
  );
}

/**
 * Validation half of `recordLinkedInstallmentPayment`, split out because the
 * caller now writes the expense (the money log) BEFORE moving this ledger —
 * so "payment exceeds the balance" has to reject before that expense exists.
 */
export async function assertLinkedInstallmentPayment(
  db: Db,
  input: { installmentId: number; amount: number },
): Promise<Installment> {
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
  return plan;
}

/**
 * Payment path for an expense saved with an installment link: the expense
 * itself is the money log, so only the plan's paid amount moves here.
 * Advance payments push amountPaid ahead, so the catch-up engine skips
 * the months already covered.
 *
 * Callers must write the expense first — see `reconcileInstallmentLedgers`.
 */
export async function recordLinkedInstallmentPayment(
  db: Db,
  input: { installmentId: number; amount: number },
): Promise<void> {
  const plan = await assertLinkedInstallmentPayment(db, input);
  await db
    .update(installments)
    .set({
      amountPaid: plan.amountPaid + input.amount,
      monthsPaid: monthsAfterPayment(plan, input.amount),
    })
    .where(eq(installments.id, input.installmentId));
}

/**
 * Finishes any plan whose money log ran ahead of its ledger.
 *
 * Every centavo credited to a plan is also a transaction carrying that plan's
 * `installmentId` — the linked expense the user saved, or the due the catch-up
 * engine posted. Both write the transaction first and move `amountPaid`
 * second, so process death between the two awaits leaves the plan *behind*,
 * never ahead: the money is logged and the bucket balance is right, only the
 * plan's progress lags. This detects that gap (logged > amountPaid) and closes
 * it, exactly as the interrupted write would have.
 *
 * Deliberately one-way. A user deleting or editing a linked expense downward
 * makes logged < amountPaid, and that is not ours to "fix" — silently walking
 * a plan's progress backwards would be a worse bug than the one being healed.
 *
 * `db.transaction()` cannot do this job instead: both drizzle drivers this app
 * uses implement transactions synchronously (`begin`, call the callback,
 * `commit` — see drizzle-orm/expo-sqlite/session.js), so an async callback
 * commits at its first await. Same reasoning as notificationRepo's commit
 * chain; same house style of idempotent recovery on the next run.
 */
export async function reconcileInstallmentLedgers(db: Db): Promise<number> {
  const plans: Installment[] = await db.select().from(installments);
  let healed = 0;
  for (const plan of plans) {
    const rows: { amount: number }[] = await db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(eq(transactions.installmentId, plan.id));
    const logged = rows.reduce((acc, row) => acc + row.amount, 0);
    // A plan can never be more than fully paid, however much was logged.
    const amountPaid = Math.min(logged, plan.totalAmount);
    if (amountPaid <= plan.amountPaid) continue;
    await db
      .update(installments)
      .set({ amountPaid, monthsPaid: monthsAfterPayment(plan, amountPaid - plan.amountPaid) })
      .where(eq(installments.id, plan.id));
    healed += 1;
  }
  return healed;
}
