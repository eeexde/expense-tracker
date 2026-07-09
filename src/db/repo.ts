import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import {
  Bucket,
  buckets,
  installments,
  recurring,
  Transaction,
  transactions,
  utangPayments,
} from './schema';

/**
 * Works against both drizzle drivers (expo-sqlite on device,
 * better-sqlite3 in tests) — they share the same query API.
 */
type Db = any;

export interface NewTransactionInput {
  amount: number;
  bucketId: number;
  date: string; // YYYY-MM-DD
  categoryId?: number;
  note?: string;
  receiptPhotoUri?: string;
  recurringId?: number;
  installmentId?: number;
  /** Links this expense/income to an open utang it pays down. */
  utangId?: number;
  /** Dedup/trace key when the txn came from a captured notification. */
  sourceNotifKey?: string;
}

function assertPositive(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Amount must be a positive integer of centavos, got ${amount}`);
  }
}

export async function addExpense(db: Db, input: NewTransactionInput): Promise<Transaction> {
  assertPositive(input.amount);
  const [row] = await db
    .insert(transactions)
    .values({ ...input, type: 'expense' })
    .returning();
  return row;
}

export async function addIncome(db: Db, input: NewTransactionInput): Promise<Transaction> {
  assertPositive(input.amount);
  const [row] = await db
    .insert(transactions)
    .values({ ...input, type: 'income' })
    .returning();
  return row;
}

export async function addTransfer(
  db: Db,
  input: NewTransactionInput & { toBucketId: number },
): Promise<Transaction> {
  assertPositive(input.amount);
  if (input.toBucketId === input.bucketId) {
    throw new Error('Transfer needs two different buckets');
  }
  const [row] = await db
    .insert(transactions)
    .values({ ...input, type: 'transfer' })
    .returning();
  return row;
}

export interface TransactionPatch {
  amount?: number;
  bucketId?: number;
  /** null clears the field (e.g. category removed while editing). */
  toBucketId?: number | null;
  categoryId?: number | null;
  note?: string | null;
  date?: string;
}

export async function updateTransaction(
  db: Db,
  id: number,
  patch: TransactionPatch,
): Promise<void> {
  if (patch.amount !== undefined) assertPositive(patch.amount);
  await db.update(transactions).set(patch).where(eq(transactions.id, id));
}

export async function deleteTransaction(db: Db, id: number): Promise<void> {
  await db.delete(transactions).where(eq(transactions.id, id));
}

export interface TransactionFilter {
  month?: string; // YYYY-MM
  type?: 'expense' | 'income' | 'transfer';
  bucketId?: number;
  categoryId?: number;
  limit?: number;
}

export async function listTransactions(
  db: Db,
  filter: TransactionFilter = {},
): Promise<Transaction[]> {
  const conditions = [];
  if (filter.month) conditions.push(like(transactions.date, `${filter.month}-%`));
  if (filter.type) conditions.push(eq(transactions.type, filter.type));
  if (filter.bucketId !== undefined) conditions.push(eq(transactions.bucketId, filter.bucketId));
  if (filter.categoryId !== undefined)
    conditions.push(eq(transactions.categoryId, filter.categoryId));
  let query = db
    .select()
    .from(transactions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(transactions.date), desc(transactions.id));
  if (filter.limit) query = query.limit(filter.limit);
  return query;
}

/** startingBalance + income − expenses − transfers out + transfers in. */
export async function bucketBalance(db: Db, bucketId: number): Promise<number> {
  const [bucket] = await db.select().from(buckets).where(eq(buckets.id, bucketId));
  if (!bucket) throw new Error(`No bucket ${bucketId}`);
  const [{ delta }] = await db
    .select({
      delta: sql<number>`coalesce(sum(
        case
          when ${transactions.type} = 'income' and ${transactions.bucketId} = ${bucketId} then ${transactions.amount}
          when ${transactions.type} = 'expense' and ${transactions.bucketId} = ${bucketId} then -${transactions.amount}
          when ${transactions.type} = 'transfer' and ${transactions.bucketId} = ${bucketId} then -${transactions.amount}
          when ${transactions.type} = 'transfer' and ${transactions.toBucketId} = ${bucketId} then ${transactions.amount}
          else 0
        end), 0)`,
    })
    .from(transactions);
  return bucket.startingBalance + delta;
}

export interface BucketWithBalance {
  bucket: Bucket;
  balance: number;
}

export async function allBucketBalances(db: Db): Promise<BucketWithBalance[]> {
  const active: Bucket[] = await db.select().from(buckets).where(eq(buckets.archived, false));
  const result: BucketWithBalance[] = [];
  for (const bucket of active) {
    result.push({ bucket, balance: await bucketBalance(db, bucket.id) });
  }
  return result;
}

export async function totalMoney(db: Db): Promise<number> {
  const balances = await allBucketBalances(db);
  return balances.reduce((acc, b) => acc + b.balance, 0);
}

/** Buckets with history are archived, never deleted — history stays intact. */
export async function archiveBucket(db: Db, id: number): Promise<void> {
  await db.update(buckets).set({ archived: true }).where(eq(buckets.id, id));
}

export interface NewBucketInput {
  name: string;
  icon?: string;
  color?: string;
  type?: 'bucket' | 'credit';
  startingBalance?: number;
}

export async function createBucket(db: Db, input: NewBucketInput): Promise<Bucket> {
  const name = input.name.trim();
  if (!name) throw new Error('Bucket name is required');
  if (input.startingBalance !== undefined && !Number.isInteger(input.startingBalance)) {
    throw new Error('Starting balance must be integer centavos');
  }
  const [row] = await db
    .insert(buckets)
    .values({ ...input, name })
    .returning();
  return row;
}

export async function updateBucket(
  db: Db,
  id: number,
  patch: Partial<NewBucketInput>,
): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new Error('Bucket name is required');
  }
  if (patch.startingBalance !== undefined && !Number.isInteger(patch.startingBalance)) {
    throw new Error('Starting balance must be integer centavos');
  }
  await db
    .update(buckets)
    .set({ ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) })
    .where(eq(buckets.id, id));
}

/**
 * True when any row still points at the bucket — transactions (either side),
 * utang payments, recurring rules, or installment plans.
 */
export async function bucketHasReferences(db: Db, id: number): Promise<boolean> {
  const [txn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(or(eq(transactions.bucketId, id), eq(transactions.toBucketId, id)))
    .limit(1);
  if (txn) return true;
  const [payment] = await db
    .select({ id: utangPayments.id })
    .from(utangPayments)
    .where(eq(utangPayments.bucketId, id))
    .limit(1);
  if (payment) return true;
  const [rule] = await db
    .select({ id: recurring.id })
    .from(recurring)
    .where(eq(recurring.bucketId, id))
    .limit(1);
  if (rule) return true;
  const [plan] = await db
    .select({ id: installments.id })
    .from(installments)
    .where(eq(installments.bucketId, id))
    .limit(1);
  return Boolean(plan);
}

/** Hard delete — only allowed while nothing references the bucket. */
export async function deleteBucket(db: Db, id: number): Promise<void> {
  if (await bucketHasReferences(db, id)) {
    throw new Error('Bucket has history — archive it instead of deleting');
  }
  await db.delete(buckets).where(eq(buckets.id, id));
}
