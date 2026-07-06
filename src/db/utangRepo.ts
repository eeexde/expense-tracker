import { and, eq } from 'drizzle-orm';
import { addExpense, addIncome } from './repo';
import { categories, Utang, utang, utangPayments } from './schema';

type Db = any;

export interface NewUtangInput {
  personName: string;
  direction: 'iOwe' | 'owedToMe';
  originalAmount: number;
  note?: string;
}

export interface NewUtangPaymentInput {
  utangId: number;
  amount: number;
  date: string;
  bucketId: number;
}

export interface UtangWithRemaining extends Utang {
  remaining: number;
}

export async function addUtang(db: Db, input: NewUtangInput): Promise<Utang> {
  if (!Number.isInteger(input.originalAmount) || input.originalAmount <= 0) {
    throw new Error('Utang amount must be positive centavos');
  }
  const [row] = await db.insert(utang).values(input).returning();
  return row;
}

export interface UtangPatch {
  personName?: string;
  direction?: 'iOwe' | 'owedToMe';
  originalAmount?: number;
  note?: string | null;
}

/**
 * Edits the debt itself. The amount can't drop below what's already paid,
 * and direction only flips while nothing has been paid — payments were
 * logged as expenses/incomes matching the old direction.
 */
export async function updateUtang(db: Db, id: number, patch: UtangPatch): Promise<void> {
  const [debt] = await db.select().from(utang).where(eq(utang.id, id));
  if (!debt) throw new Error(`No utang ${id}`);
  if (patch.personName !== undefined && !patch.personName.trim()) {
    throw new Error('Name is required');
  }
  if (patch.originalAmount !== undefined) {
    if (!Number.isInteger(patch.originalAmount) || patch.originalAmount <= 0) {
      throw new Error('Utang amount must be positive centavos');
    }
    const paid = debt.originalAmount - (await utangRemaining(db, id));
    if (patch.originalAmount < paid) {
      throw new Error(`New amount is below what was already paid (${paid} centavos)`);
    }
  }
  if (patch.direction !== undefined && patch.direction !== debt.direction) {
    const payments = await db.select().from(utangPayments).where(eq(utangPayments.utangId, id));
    if (payments.length > 0) {
      throw new Error('Direction is locked once a payment exists');
    }
  }
  await db
    .update(utang)
    .set({
      ...patch,
      ...(patch.personName !== undefined ? { personName: patch.personName.trim() } : {}),
    })
    .where(eq(utang.id, id));
}

async function utangCategoryId(db: Db, type: 'expense' | 'income'): Promise<number | undefined> {
  const [cat] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.name, 'Debt'), eq(categories.type, type)));
  return cat?.id;
}

export interface UtangPaymentOptions {
  /**
   * When false, only the payment row is written — the caller logs its own
   * transaction (e.g. an expense already saved with a utang link).
   */
  createTransaction?: boolean;
}

/**
 * A payment is real money: iOwe payments log as an expense from the bucket,
 * owedToMe collections log as income into it.
 */
export async function addUtangPayment(
  db: Db,
  input: NewUtangPaymentInput,
  options: UtangPaymentOptions = {},
): Promise<void> {
  const { createTransaction = true } = options;
  const [debt] = await db.select().from(utang).where(eq(utang.id, input.utangId));
  if (!debt) throw new Error(`No utang ${input.utangId}`);
  const remaining = await utangRemaining(db, input.utangId);
  if (input.amount > remaining) {
    throw new Error(`Payment exceeds remaining balance (${remaining} centavos)`);
  }
  if (createTransaction) {
    const txnInput = {
      amount: input.amount,
      bucketId: input.bucketId,
      date: input.date,
      utangId: input.utangId,
      note:
        debt.direction === 'iOwe' ? `Paid ${debt.personName}` : `Payment from ${debt.personName}`,
    };
    if (debt.direction === 'iOwe') {
      await addExpense(db, { ...txnInput, categoryId: await utangCategoryId(db, 'expense') });
    } else {
      await addIncome(db, { ...txnInput, categoryId: await utangCategoryId(db, 'income') });
    }
  }
  await db.insert(utangPayments).values(input);
}

/**
 * Payment path for a transaction saved with a utang link: the transaction
 * itself is the money log, so only the payment row is recorded here.
 * Expenses pay down my own debts (iOwe); incomes collect what's owed to me.
 */
export async function recordLinkedUtangPayment(
  db: Db,
  kind: 'expense' | 'income',
  input: NewUtangPaymentInput,
): Promise<void> {
  const [debt] = await db.select().from(utang).where(eq(utang.id, input.utangId));
  if (!debt) throw new Error(`No utang ${input.utangId}`);
  const expected = kind === 'expense' ? 'iOwe' : 'owedToMe';
  if (debt.direction !== expected) {
    throw new Error(
      kind === 'expense'
        ? 'An expense can only pay a debt I owe'
        : 'An income can only collect a debt owed to me',
    );
  }
  await addUtangPayment(db, input, { createTransaction: false });
}

/** Every debt that still has a balance, both directions. */
export async function listOpenUtang(db: Db): Promise<UtangWithRemaining[]> {
  const rows: Utang[] = await db.select().from(utang);
  const result: UtangWithRemaining[] = [];
  for (const row of rows) {
    const remaining = await utangRemaining(db, row.id);
    if (remaining > 0) result.push({ ...row, remaining });
  }
  return result;
}

export async function utangRemaining(db: Db, utangId: number): Promise<number> {
  const [debt] = await db.select().from(utang).where(eq(utang.id, utangId));
  if (!debt) throw new Error(`No utang ${utangId}`);
  const payments = await db.select().from(utangPayments).where(eq(utangPayments.utangId, utangId));
  const paid = payments.reduce((acc: number, p: { amount: number }) => acc + p.amount, 0);
  return debt.originalAmount - paid;
}

export async function listUtang(
  db: Db,
  direction: 'iOwe' | 'owedToMe',
): Promise<UtangWithRemaining[]> {
  const rows: Utang[] = await db.select().from(utang).where(eq(utang.direction, direction));
  const result: UtangWithRemaining[] = [];
  for (const row of rows) {
    result.push({ ...row, remaining: await utangRemaining(db, row.id) });
  }
  return result;
}

export async function utangTotals(db: Db): Promise<{ iOwe: number; owedToMe: number }> {
  const sumRemaining = async (direction: 'iOwe' | 'owedToMe') => {
    const list = await listUtang(db, direction);
    return list.reduce((acc, u) => acc + u.remaining, 0);
  };
  return { iOwe: await sumRemaining('iOwe'), owedToMe: await sumRemaining('owedToMe') };
}
