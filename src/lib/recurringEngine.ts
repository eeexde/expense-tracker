import { and, eq, inArray } from 'drizzle-orm';
import { reconcileInstallmentLedgers } from '../db/installmentRepo';
import { reconcileUtangPayments } from '../db/utangRepo';
import { installments, recurring, transactions } from '../db/schema';

type Db = any;

export interface RecurrenceRule {
  frequency: 'monthly' | 'weekly';
  /** monthly: 1-31 (29-31 clamp to month end). weekly: weekday, Sunday=0. */
  dayDue: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
}

export interface PostedItem {
  name: string;
  amount: number;
  date: string;
}

export interface PostedSummary {
  posted: PostedItem[];
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12; day 0 of next month = last day of this month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Monthly due date for a given month, clamping 29-31 to the month's end. */
function monthlyDueDate(year: number, month: number, dayDue: number): string {
  return ymd(year, month, Math.min(dayDue, daysInMonth(year, month)));
}

/**
 * All due dates d with fromExclusive < d <= to, within [startDate, endDate].
 * Pure string date math — no timezone involvement.
 */
export function dueDatesBetween(rule: RecurrenceRule, fromExclusive: string, to: string): string[] {
  const floor = rule.startDate > fromExclusive ? rule.startDate : null;
  const ceiling = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const dates: string[] = [];

  if (rule.frequency === 'monthly') {
    let [year, month] = fromExclusive.split('-').map(Number);
    if (floor) [year, month] = floor.split('-').map(Number);
    // walk months until past ceiling
    for (;;) {
      const due = monthlyDueDate(year, month, rule.dayDue);
      if (due > ceiling) break;
      if (due > fromExclusive && (!floor || due >= floor)) dates.push(due);
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
    }
  } else {
    const start = floor && floor > fromExclusive ? floor : fromExclusive;
    const cursor = new Date(`${start}T00:00:00Z`);
    // advance to the next occurrence of the target weekday strictly after fromExclusive
    do {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } while (cursor.getUTCDay() !== rule.dayDue);
    for (;;) {
      const due = cursor.toISOString().slice(0, 10);
      if (due > ceiling) break;
      if (!floor || due >= floor) dates.push(due);
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  return dates;
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Due dates this rule has already posted a transaction for, of the ones asked. */
async function postedDues(db: Db, recurringId: number, dues: string[]): Promise<Set<string>> {
  if (dues.length === 0) return new Set();
  const rows: { date: string }[] = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(and(eq(transactions.recurringId, recurringId), inArray(transactions.date, dues)));
  return new Set(rows.map((row) => row.date));
}

/**
 * Post every missed recurring/installment due up to `today`.
 * Safe to run on every app open — already-posted dues never repost.
 *
 * Crash safety (Android kills backgrounded apps freely, and this runs on every
 * cold open): each due is written as transaction-then-ledger, and the ledger
 * moves per due rather than once per batch, so process death anywhere leaves
 * the system merely behind, never double-charged. A due whose transaction
 * landed but whose ledger move did not is recognised on the next run —
 * `(recurringId, date)` is unique per posting, so the transaction itself is the
 * marker — and only the ledger is finished. Installments are recovered the same
 * way by `reconcileInstallmentLedgers` below, which reads `amountPaid` back off
 * the transactions actually logged.
 *
 * A transaction would be the obvious answer and is not available: both drizzle
 * drivers this app uses implement `db.transaction()` synchronously (`begin`,
 * call the callback, `commit` — drizzle-orm/expo-sqlite/session.js), so an
 * async callback commits at its first await and buys nothing.
 */
export async function runCatchUp(db: Db, today: string): Promise<PostedSummary> {
  const posted: PostedItem[] = [];

  // Before anything reads a ledger: finish any linked payment whose money was
  // logged but whose plan/debt never moved. Skipping this would let the
  // installment loop below re-post a due the user has already paid.
  await reconcileInstallmentLedgers(db);
  await reconcileUtangPayments(db);

  const recurringItems = await db.select().from(recurring).where(eq(recurring.active, true));
  for (const item of recurringItems) {
    const fromExclusive = item.lastPostedDate ?? dayBefore(item.startDate);
    const dues = dueDatesBetween(item, fromExclusive, today);
    const already = await postedDues(db, item.id, dues);
    for (const date of dues) {
      if (!already.has(date)) {
        await db.insert(transactions).values({
          type: 'expense',
          amount: item.amount,
          bucketId: item.bucketId,
          categoryId: item.categoryId ?? undefined,
          note: item.name,
          date,
          recurringId: item.id,
        });
        posted.push({ name: item.name, amount: item.amount, date });
      }
      await db
        .update(recurring)
        .set({ lastPostedDate: date })
        .where(eq(recurring.id, item.id));
    }
  }

  const plans = await db.select().from(installments);
  for (const plan of plans) {
    if (plan.amountPaid >= plan.totalAmount) continue;
    const allDues = dueDatesBetween(
      { frequency: 'monthly', dayDue: plan.dayDue, startDate: plan.startDate },
      dayBefore(plan.startDate),
      today,
    );
    // Months already paid post nothing. monthsPaid counts linked payments
    // (which may be slightly under the due — fees/rounding), so trust it as
    // well as the money-derived floor(amountPaid / monthlyDue) for advances.
    const derived = Math.min(Math.floor(plan.amountPaid / plan.monthlyDue), plan.monthsTotal);
    const covered = Math.min(Math.max(plan.monthsPaid, derived), plan.monthsTotal);
    const unpaidDues = allDues.slice(covered, plan.monthsTotal);
    let amountPaid = plan.amountPaid;
    let monthsPaid = covered;
    for (const [i, date] of unpaidDues.entries()) {
      // The plan's final due collects everything left (advance clamps and any
      // shortfall from under-due linked payments); earlier dues never exceed
      // the monthly amount.
      const finalMonth = covered + i + 1 === plan.monthsTotal;
      const amount = finalMonth
        ? plan.totalAmount - amountPaid
        : Math.min(plan.monthlyDue, plan.totalAmount - amountPaid);
      if (amount <= 0) break;
      await db.insert(transactions).values({
        type: 'expense',
        amount,
        bucketId: plan.bucketId,
        note: plan.itemName,
        date,
        installmentId: plan.id,
      });
      amountPaid += amount;
      monthsPaid += 1;
      // Per due, immediately after its own insert: a crash mid-batch leaves the
      // earlier dues durably credited, and the one in flight is recovered by
      // reconcileInstallmentLedgers on the next open instead of re-posting.
      await db
        .update(installments)
        .set({ amountPaid, monthsPaid: Math.min(monthsPaid, plan.monthsTotal) })
        .where(eq(installments.id, plan.id));
      posted.push({ name: plan.itemName, amount, date });
    }
  }

  return { posted };
}
