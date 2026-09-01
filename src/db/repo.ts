import { and, desc, eq, isNotNull, like, ne, or, sql } from 'drizzle-orm';
import {
  Bucket,
  buckets,
  installments,
  Recurring,
  recurring,
  recurringBuckets,
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

/**
 * Rules still on the schedule, for the add-transaction form's "cover recurring"
 * link. Paused/ended rules are excluded: linking to one would suppress nothing,
 * since the poster only ever looks at active rules.
 */
export async function listActiveRecurring(db: Db): Promise<Recurring[]> {
  return db.select().from(recurring).where(eq(recurring.active, true)).orderBy(recurring.name);
}

/**
 * startingBalance + income − expenses − transfers out + transfers in.
 *
 * The `where` is not a filter in the accounting sense: every row it drops
 * matches none of the `case` arms and would contribute the `else 0`. It is
 * there so the sum rides `idx_txn_bucket` instead of scanning the table.
 */
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
    .from(transactions)
    .where(or(eq(transactions.bucketId, bucketId), eq(transactions.toBucketId, bucketId)));
  return bucket.startingBalance + delta;
}

export interface BucketWithBalance {
  bucket: Bucket;
  balance: number;
}

/**
 * Every bucket's delta in two grouped passes instead of one full scan per
 * bucket. The signs are the same four rules `bucketBalance` spells out, split
 * by which side of the row the bucket sits on:
 *
 * - the row's own `bucketId` gets +income / −expense / −transfer;
 * - a transfer's `toBucketId` gets +amount.
 *
 * `toBucketId <> bucketId` reproduces the `case`'s first-match-wins ordering:
 * a (rejected at write time, but possible in old data) self-transfer hits the
 * "transfer out" arm and never reaches the "transfer in" one, so it must not
 * be counted twice here either. Rows with a null `toBucketId` fall out of that
 * same comparison, as they fell out of the `= bucketId` arm.
 */
async function bucketDeltas(db: Db): Promise<Map<number, number>> {
  const outgoing: { bucketId: number; delta: number }[] = await db
    .select({
      bucketId: transactions.bucketId,
      delta: sql<number>`coalesce(sum(
        case
          when ${transactions.type} = 'income' then ${transactions.amount}
          when ${transactions.type} = 'expense' then -${transactions.amount}
          when ${transactions.type} = 'transfer' then -${transactions.amount}
          else 0
        end), 0)`,
    })
    .from(transactions)
    .groupBy(transactions.bucketId);
  const incoming: { bucketId: number; delta: number }[] = await db
    .select({
      bucketId: transactions.toBucketId,
      delta: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, 'transfer'),
        isNotNull(transactions.toBucketId),
        ne(transactions.toBucketId, transactions.bucketId),
      ),
    )
    .groupBy(transactions.toBucketId);

  const deltas = new Map<number, number>();
  for (const row of [...outgoing, ...incoming]) {
    deltas.set(row.bucketId, (deltas.get(row.bucketId) ?? 0) + row.delta);
  }
  return deltas;
}

export async function allBucketBalances(db: Db): Promise<BucketWithBalance[]> {
  const active: Bucket[] = await db.select().from(buckets).where(eq(buckets.archived, false));
  const deltas = await bucketDeltas(db);
  return active.map((bucket) => ({
    bucket,
    balance: bucket.startingBalance + (deltas.get(bucket.id) ?? 0),
  }));
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
 * utang payments, recurring rules (as the primary bucket or as a link in their
 * fallback chain), or installment plans.
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
  const [link] = await db
    .select({ id: recurringBuckets.id })
    .from(recurringBuckets)
    .where(eq(recurringBuckets.bucketId, id))
    .limit(1);
  if (link) return true;
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
