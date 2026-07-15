import { buckets, categories, categoryRules, recurring } from './schema';
import { createTestDb, TestDb } from './testDb';
import { addExpense } from './repo';
import {
  archiveCategory,
  categoryHasReferences,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './categoryRepo';

describe('categoryRepo', () => {
  let db: TestDb;
  let cashId: number;

  beforeEach(async () => {
    db = createTestDb();
    const [cash] = await db.insert(buckets).values({ name: 'Cash' }).returning();
    cashId = cash.id;
  });

  it('creates a category and lists it by type, active only', async () => {
    const food = await createCategory(db, { name: '  Groceries ', icon: 'cart', type: 'expense' });
    await createCategory(db, { name: 'Freelance', icon: 'laptop', type: 'income' });
    expect(food.name).toBe('Groceries'); // trimmed

    const expense = await listCategories(db, 'expense');
    expect(expense.map((c) => c.name)).toEqual(['Groceries']);
    const all = await listCategories(db);
    expect(all).toHaveLength(2);
  });

  it('rejects a blank name on create and update', async () => {
    await expect(createCategory(db, { name: '   ', type: 'expense' })).rejects.toThrow(/required/);
    const c = await createCategory(db, { name: 'Load', type: 'expense' });
    await expect(updateCategory(db, c.id, { name: ' ' })).rejects.toThrow(/required/);
  });

  it('updates name and icon, keeping type', async () => {
    const c = await createCategory(db, { name: 'Load', icon: 'signal', type: 'expense' });
    await updateCategory(db, c.id, { name: 'Mobile Load', icon: 'phone' });
    const [row] = await listCategories(db, 'expense');
    expect(row.name).toBe('Mobile Load');
    expect(row.icon).toBe('phone');
    expect(row.type).toBe('expense');
  });

  it('hard-deletes an unreferenced category', async () => {
    const c = await createCategory(db, { name: 'Temp', type: 'expense' });
    expect(await categoryHasReferences(db, c.id)).toBe(false);
    await deleteCategory(db, c.id);
    expect(await listCategories(db)).toHaveLength(0);
  });

  it('refuses to delete a category with transaction history', async () => {
    const c = await createCategory(db, { name: 'Groceries', type: 'expense' });
    await addExpense(db, { amount: 5000, bucketId: cashId, date: '2026-07-01', categoryId: c.id });
    expect(await categoryHasReferences(db, c.id)).toBe(true);
    await expect(deleteCategory(db, c.id)).rejects.toThrow(/archive/i);
  });

  it('detects recurring and category-rule references', async () => {
    const c1 = await createCategory(db, { name: 'Rent', type: 'expense' });
    await db
      .insert(recurring)
      .values({
        name: 'Rent',
        amount: 100000,
        bucketId: cashId,
        categoryId: c1.id,
        frequency: 'monthly',
        dayDue: 1,
        startDate: '2026-07-01',
      });
    expect(await categoryHasReferences(db, c1.id)).toBe(true);

    const c2 = await createCategory(db, { name: 'Transport', type: 'expense' });
    await db.insert(categoryRules).values({ keyword: 'grab', categoryId: c2.id });
    expect(await categoryHasReferences(db, c2.id)).toBe(true);
  });

  it('archives a referenced category, hiding it from the active list', async () => {
    const c = await createCategory(db, { name: 'Groceries', type: 'expense' });
    await addExpense(db, { amount: 5000, bucketId: cashId, date: '2026-07-01', categoryId: c.id });
    await archiveCategory(db, c.id);
    expect(await listCategories(db, 'expense')).toHaveLength(0);
    // Row still exists for history lookups.
    const all = await db.select().from(categories);
    expect(all).toHaveLength(1);
    expect(all[0].archived).toBe(true);
  });
});
