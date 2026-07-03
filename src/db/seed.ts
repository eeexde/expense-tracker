import { buckets, categories } from './schema';

/** Any drizzle db over our schema (expo-sqlite in app, better-sqlite3 in tests). */
type AnyDb = {
  select: (...args: never[]) => any;
  insert: (table: any) => any;
};

export const PRESET_BUCKETS = [
  { name: 'Cash on Hand', icon: '💵', color: '#2E7D32' },
  { name: 'GCash', icon: '📱', color: '#0057E7' },
  { name: 'Maya', icon: '💳', color: '#00A650' },
  { name: 'BDO', icon: '🏦', color: '#003A70' },
  { name: 'BPI', icon: '🏦', color: '#B11116' },
  { name: 'Savings', icon: '🐷', color: '#E65100' },
] as const;

export const PRESET_EXPENSE_CATEGORIES = [
  { name: 'Load', icon: '📶' },
  { name: 'Transport', icon: '🚌' },
  { name: 'Electricity', icon: '⚡' },
  { name: 'Water', icon: '🚰' },
  { name: 'Groceries', icon: '🛒' },
  { name: 'Eating Out', icon: '🍽️' },
  { name: 'Remittance', icon: '📦' },
  { name: 'Internet', icon: '🌐' },
  { name: 'Rent', icon: '🏠' },
  { name: 'Installment', icon: '🧾' },
  { name: 'Debt', icon: '🤝' },
  { name: 'Others', icon: '🗂️' },
] as const;

export const PRESET_INCOME_CATEGORIES = [
  { name: 'Freelance', icon: '💻' },
  { name: 'Sideline', icon: '🛠️' },
  { name: 'Debt', icon: '🤝' },
  { name: 'Others', icon: '🗂️' },
] as const;

/** Insert presets only when tables are empty. Safe to run every boot. */
export async function seedIfEmpty(db: any): Promise<void> {
  const existingBuckets = await db.select().from(buckets);
  if (existingBuckets.length === 0) {
    await db.insert(buckets).values(PRESET_BUCKETS.map((b) => ({ ...b, startingBalance: 0 })));
  }
  const existingCategories = await db.select().from(categories);
  if (existingCategories.length === 0) {
    await db.insert(categories).values([
      ...PRESET_EXPENSE_CATEGORIES.map((c) => ({ ...c, type: 'expense' as const })),
      ...PRESET_INCOME_CATEGORIES.map((c) => ({ ...c, type: 'income' as const })),
    ]);
  }
}
