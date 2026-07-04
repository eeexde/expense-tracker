import { buckets, categories } from './schema';

/** Any drizzle db over our schema (expo-sqlite in app, better-sqlite3 in tests). */
type AnyDb = {
  select: (...args: never[]) => any;
  insert: (table: any) => any;
};

/** Icon values are keys into the one-color icon set (components/Icon.tsx). */
export const PRESET_BUCKETS = [
  { name: 'Cash on Hand', icon: 'cash', color: '#2E7D32' },
  { name: 'GCash', icon: 'phone', color: '#0057E7' },
  { name: 'Maya', icon: 'card', color: '#00A650' },
  { name: 'BDO', icon: 'bank', color: '#003A70' },
  { name: 'BPI', icon: 'bank', color: '#B11116' },
  { name: 'Savings', icon: 'savings', color: '#E65100' },
] as const;

export const PRESET_EXPENSE_CATEGORIES = [
  { name: 'Load', icon: 'signal' },
  { name: 'Transport', icon: 'bus' },
  { name: 'Electricity', icon: 'zap' },
  { name: 'Water', icon: 'droplet' },
  { name: 'Groceries', icon: 'cart' },
  { name: 'Eating Out', icon: 'dining' },
  { name: 'Remittance', icon: 'box' },
  { name: 'Internet', icon: 'globe' },
  { name: 'Rent', icon: 'home' },
  { name: 'Installment', icon: 'receipt' },
  { name: 'Debt', icon: 'users' },
  { name: 'Others', icon: 'folder' },
] as const;

export const PRESET_INCOME_CATEGORIES = [
  { name: 'Freelance', icon: 'laptop' },
  { name: 'Sideline', icon: 'wrench' },
  { name: 'Debt', icon: 'users' },
  { name: 'Others', icon: 'folder' },
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
