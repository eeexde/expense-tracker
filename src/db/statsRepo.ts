import { and, eq, like, sql } from 'drizzle-orm';
import { categories, installments, recurring, transactions } from './schema';
import { installmentRemaining } from './installmentRepo';

type Db = any;

export interface CommitmentTotals {
  recurring: number;
  installments: number;
  total: number;
}

/**
 * Monthly cost of standing obligations: active recurring rules (weekly rules
 * normalized to a monthly figure) plus the monthly due of installment plans
 * that still carry a balance.
 */
export async function monthlyCommitments(db: Db): Promise<CommitmentTotals> {
  const rules = await db.select().from(recurring).where(eq(recurring.active, true));
  const recurringTotal = rules.reduce(
    (acc: number, r: { amount: number; frequency: 'monthly' | 'weekly' }) =>
      acc + (r.frequency === 'weekly' ? Math.round((r.amount * 52) / 12) : r.amount),
    0,
  );
  const plans = await db.select().from(installments);
  const installmentTotal = plans
    .filter((p: { totalAmount: number; amountPaid: number }) => installmentRemaining(p) > 0)
    .reduce((acc: number, p: { monthlyDue: number }) => acc + p.monthlyDue, 0);
  return {
    recurring: recurringTotal,
    installments: installmentTotal,
    total: recurringTotal + installmentTotal,
  };
}

export interface MonthSummary {
  income: number;
  expenses: number;
  net: number;
}

export interface CategoryBreakdown {
  categoryId: number | null;
  categoryName: string;
  total: number;
  pct: number;
}

export interface TrendPoint {
  ym: string;
  income: number;
  expenses: number;
}

/** Transfers move money between own buckets — never income or expense. */
export async function monthSummary(db: Db, ym: string): Promise<MonthSummary> {
  const [row] = await db
    .select({
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(like(transactions.date, `${ym}-%`));
  return { income: row.income, expenses: row.expenses, net: row.income - row.expenses };
}

export async function expensesByCategory(db: Db, ym: string): Promise<CategoryBreakdown[]> {
  const rows: { categoryId: number | null; categoryName: string | null; total: number }[] = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.type, 'expense'), like(transactions.date, `${ym}-%`)))
    .groupBy(transactions.categoryId)
    .orderBy(sql`sum(${transactions.amount}) desc`);
  const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);
  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName ?? 'Uncategorized',
    total: r.total,
    pct: grandTotal === 0 ? 0 : Math.round((r.total / grandTotal) * 100),
  }));
}

function previousMonths(endYm: string, count: number): string[] {
  let [year, month] = endYm.split('-').map(Number);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return result;
}

export async function sixMonthTrend(db: Db, endYm: string): Promise<TrendPoint[]> {
  const months = previousMonths(endYm, 6);
  const result: TrendPoint[] = [];
  for (const ym of months) {
    const s = await monthSummary(db, ym);
    result.push({ ym, income: s.income, expenses: s.expenses });
  }
  return result;
}
