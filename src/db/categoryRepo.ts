import { and, eq } from 'drizzle-orm';
import { Category, categories, categoryRules, recurring, transactions } from './schema';

type Db = any;

export type CategoryType = 'expense' | 'income';

export interface NewCategoryInput {
  name: string;
  icon?: string;
  type: CategoryType;
}

/** Active categories of a type — what the pickers offer for new entries. */
export async function listCategories(db: Db, type?: CategoryType): Promise<Category[]> {
  const conditions = [eq(categories.archived, false)];
  if (type) conditions.push(eq(categories.type, type));
  return db
    .select()
    .from(categories)
    .where(and(...conditions));
}

export async function createCategory(db: Db, input: NewCategoryInput): Promise<Category> {
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required');
  const [row] = await db
    .insert(categories)
    .values({ name, icon: input.icon, type: input.type })
    .returning();
  return row;
}

export interface CategoryPatch {
  name?: string;
  icon?: string;
}

export async function updateCategory(db: Db, id: number, patch: CategoryPatch): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new Error('Category name is required');
  }
  await db
    .update(categories)
    .set({ ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) })
    .where(eq(categories.id, id));
}

/**
 * True when any transaction, recurring rule, or auto-log rule still tags this
 * category — such categories are archived, never deleted, so history keeps its
 * labels.
 */
export async function categoryHasReferences(db: Db, id: number): Promise<boolean> {
  const [txn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.categoryId, id))
    .limit(1);
  if (txn) return true;
  const [rule] = await db
    .select({ id: recurring.id })
    .from(recurring)
    .where(eq(recurring.categoryId, id))
    .limit(1);
  if (rule) return true;
  const [catRule] = await db
    .select({ id: categoryRules.id })
    .from(categoryRules)
    .where(eq(categoryRules.categoryId, id))
    .limit(1);
  return Boolean(catRule);
}

/** Categories with history are archived, never deleted — labels stay intact. */
export async function archiveCategory(db: Db, id: number): Promise<void> {
  await db.update(categories).set({ archived: true }).where(eq(categories.id, id));
}

/** Hard delete — only allowed while nothing references the category. */
export async function deleteCategory(db: Db, id: number): Promise<void> {
  if (await categoryHasReferences(db, id)) {
    throw new Error('Category has history — archive it instead of deleting');
  }
  await db.delete(categories).where(eq(categories.id, id));
}
