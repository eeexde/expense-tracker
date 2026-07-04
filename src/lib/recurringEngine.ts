import { eq } from 'drizzle-orm';
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

/**
 * Post every missed recurring/installment due up to `today`.
 * Safe to run on every app open — already-posted dues never repost.
 */
export async function runCatchUp(db: Db, today: string): Promise<PostedSummary> {
  const posted: PostedItem[] = [];

  const recurringItems = await db.select().from(recurring).where(eq(recurring.active, true));
  for (const item of recurringItems) {
    const fromExclusive = item.lastPostedDate ?? dayBefore(item.startDate);
    const dues = dueDatesBetween(item, fromExclusive, today);
    for (const date of dues) {
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
    if (dues.length > 0) {
      await db
        .update(recurring)
        .set({ lastPostedDate: dues[dues.length - 1] })
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
    // Advance payments already cover the next floor(amountPaid / monthlyDue)
    // dues, so those months post nothing.
    const covered = Math.min(Math.floor(plan.amountPaid / plan.monthlyDue), plan.monthsTotal);
    const unpaidDues = allDues.slice(covered, plan.monthsTotal);
    let amountPaid = plan.amountPaid;
    for (const date of unpaidDues) {
      // The last due only charges what's actually left after advances.
      const amount = Math.min(plan.monthlyDue, plan.totalAmount - amountPaid);
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
      posted.push({ name: plan.itemName, amount, date });
    }
    if (amountPaid !== plan.amountPaid) {
      await db
        .update(installments)
        .set({
          amountPaid,
          monthsPaid: Math.min(Math.floor(amountPaid / plan.monthlyDue), plan.monthsTotal),
        })
        .where(eq(installments.id, plan.id));
    }
  }

  return { posted };
}
