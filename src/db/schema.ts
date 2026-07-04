import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * All money columns are integer centavos.
 * All date columns are 'YYYY-MM-DD' local dates.
 */

export const buckets = sqliteTable('buckets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('💰'),
  color: text('color').notNull().default('#2E7D32'),
  /** Credit cards live mostly in the negative; payments arrive as transfers. */
  type: text('type', { enum: ['bucket', 'credit'] }).notNull().default('bucket'),
  startingBalance: integer('starting_balance').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('🏷️'),
  type: text('type', { enum: ['expense', 'income'] }).notNull(),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    amount: integer('amount').notNull(),
    bucketId: integer('bucket_id')
      .notNull()
      .references(() => buckets.id),
    toBucketId: integer('to_bucket_id').references(() => buckets.id),
    categoryId: integer('category_id').references(() => categories.id),
    note: text('note'),
    receiptPhotoUri: text('receipt_photo_uri'),
    date: text('date').notNull(),
    recurringId: integer('recurring_id').references(() => recurring.id),
    installmentId: integer('installment_id').references(() => installments.id),
    /** Set when this expense/income doubles as a payment on an open utang. */
    utangId: integer('utang_id').references(() => utang.id),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index('idx_txn_date').on(t.date), index('idx_txn_bucket').on(t.bucketId)],
);

export const recurring = sqliteTable('recurring', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  categoryId: integer('category_id').references(() => categories.id),
  bucketId: integer('bucket_id')
    .notNull()
    .references(() => buckets.id),
  frequency: text('frequency', { enum: ['monthly', 'weekly'] }).notNull(),
  /** monthly: 1-31 (29-31 clamp to month end). weekly: 0-6, Sunday=0. */
  dayDue: integer('day_due').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastPostedDate: text('last_posted_date'),
});

export const installments = sqliteTable('installments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemName: text('item_name').notNull(),
  totalAmount: integer('total_amount').notNull(),
  monthlyDue: integer('monthly_due').notNull(),
  monthsTotal: integer('months_total').notNull(),
  monthsPaid: integer('months_paid').notNull().default(0),
  /**
   * Centavos paid so far (auto-posted dues + advance payments). Source of
   * truth for what's left; monthsPaid is kept derived from it for display.
   */
  amountPaid: integer('amount_paid').notNull().default(0),
  dayDue: integer('day_due').notNull(),
  bucketId: integer('bucket_id')
    .notNull()
    .references(() => buckets.id),
  startDate: text('start_date').notNull(),
});

export const utang = sqliteTable('utang', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personName: text('person_name').notNull(),
  direction: text('direction', { enum: ['iOwe', 'owedToMe'] }).notNull(),
  originalAmount: integer('original_amount').notNull(),
  note: text('note'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const utangPayments = sqliteTable('utang_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  utangId: integer('utang_id')
    .notNull()
    .references(() => utang.id),
  amount: integer('amount').notNull(),
  date: text('date').notNull(),
  bucketId: integer('bucket_id')
    .notNull()
    .references(() => buckets.id),
});

export type Bucket = typeof buckets.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Recurring = typeof recurring.$inferSelect;
export type Installment = typeof installments.$inferSelect;
export type Utang = typeof utang.$inferSelect;
export type UtangPayment = typeof utangPayments.$inferSelect;
