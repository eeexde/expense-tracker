# Notification Auto-Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-log expenses/incomes from Android bank/e-wallet notifications, with a review inbox and 2-day auto-commit, per `docs/superpowers/specs/2026-07-10-notification-auto-log-design.md`.

**Architecture:** A local Expo Module (Kotlin `NotificationListenerService`) buffers matched notifications to a JSON-lines file; on app open/foreground, JS drains the buffer, parses each entry (`notificationParser.ts`), and either commits a transaction (high confidence), queues it in `pending_notifications` (medium), or discards (no amount). Category comes from keyword rules. Everything else is standard drizzle/expo-router work following existing repo patterns.

**Tech Stack:** Expo 57 (managed/CNG — no `android/` dir; local module in `modules/` autolinks), drizzle-orm + expo-sqlite (better-sqlite3 in tests), expo-router, Kotlin Expo Module, Jest (`logic` project for pure/db tests).

**Conventions (from codebase — follow exactly):**
- Money = integer centavos. Dates = `'YYYY-MM-DD'` local. `type Db = any` in repos (works with both drivers).
- Tests: `src/db/*.test.ts` / `src/lib/*.test.ts` use `createTestDb()` from `src/db/testDb.ts`. Run with `npm test -- --selectProjects=logic`.
- Migrations: edit `src/db/schema.ts`, then `npx drizzle-kit generate` (writes to `drizzle/`).
- Imports use `@/` alias for `src/`.
- iOS/web: feature must no-op. All native calls behind `Platform.OS === 'android'` guards.

---

### Task 1: Schema + migration

**Files:**
- Modify: `src/db/schema.ts`
- Generate: `drizzle/0003_*.sql` (via drizzle-kit)
- Test: `src/db/schema.test.ts` (append)

- [ ] **Step 1: Add tables + column to `src/db/schema.ts`**

Append after `utangPayments` (before the type exports), and add one column to `transactions`:

```ts
// In transactions table, after utangId:
    /** Gmail-of-notifications dedup: raw notification key that produced this txn. */
    sourceNotifKey: text('source_notif_key'),
```

```ts
/** Maps a source app's notifications to a bucket. */
export const notificationSources = sqliteTable('notification_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bucketId: integer('bucket_id')
    .notNull()
    .references(() => buckets.id),
  packageName: text('package_name').notNull(),
  /** Extra text filter (e.g. card last-4) when several cards share one app. */
  matchKeyword: text('match_keyword'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

/** Captured notifications awaiting review; kept after commit/discard for dedup. */
export const pendingNotifications = sqliteTable('pending_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id')
    .notNull()
    .references(() => notificationSources.id),
  rawTitle: text('raw_title'),
  rawText: text('raw_text').notNull(),
  parsedAmount: integer('parsed_amount'),
  parsedMerchant: text('parsed_merchant'),
  parsedType: text('parsed_type', { enum: ['expense', 'income'] }),
  notifKey: text('notif_key').notNull().unique(),
  /** ISO timestamp (UTC) from the Android side. */
  postedAt: text('posted_at').notNull(),
  status: text('status', { enum: ['pending', 'committed', 'discarded'] })
    .notNull()
    .default('pending'),
});

/** First matching keyword (by priority asc, then id asc) assigns the category. */
export const categoryRules = sqliteTable('category_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull(),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  priority: integer('priority').notNull().default(0),
});
```

Add type exports at the bottom:

```ts
export type NotificationSource = typeof notificationSources.$inferSelect;
export type PendingNotification = typeof pendingNotifications.$inferSelect;
export type CategoryRule = typeof categoryRules.$inferSelect;
```

- [ ] **Step 2: Generate migration**

Run: `npx drizzle-kit generate`
Expected: new `drizzle/0003_<name>.sql` containing `CREATE TABLE notification_sources`, `pending_notifications`, `category_rules`, and `ALTER TABLE transactions ADD source_notif_key`. `drizzle/migrations.js` updated automatically.

- [ ] **Step 3: Add failing-then-passing schema test**

Append to `src/db/schema.test.ts` (follow the file's existing style):

```ts
import { categoryRules, notificationSources, pendingNotifications } from './schema';

describe('notification auto-log tables', () => {
  it('inserts a source, a pending notification, and a category rule', async () => {
    const db = createTestDb();
    const [bucket] = await db
      .insert(buckets)
      .values({ name: 'GCash' })
      .returning();
    const [source] = await db
      .insert(notificationSources)
      .values({ bucketId: bucket.id, packageName: 'com.globe.gcash.android' })
      .returning();
    expect(source.enabled).toBe(true);

    const [pending] = await db
      .insert(pendingNotifications)
      .values({
        sourceId: source.id,
        rawText: 'You have sent PHP 150.00 to JOLLIBEE',
        notifKey: 'k1',
        postedAt: '2026-07-10T03:00:00Z',
      })
      .returning();
    expect(pending.status).toBe('pending');

    const [cat] = await db
      .insert(categories)
      .values({ name: 'Eating Out', type: 'expense' })
      .returning();
    const [rule] = await db
      .insert(categoryRules)
      .values({ keyword: 'jollibee', categoryId: cat.id })
      .returning();
    expect(rule.priority).toBe(0);
  });

  it('rejects duplicate notifKey', async () => {
    const db = createTestDb();
    const [bucket] = await db.insert(buckets).values({ name: 'B' }).returning();
    const [source] = await db
      .insert(notificationSources)
      .values({ bucketId: bucket.id, packageName: 'x' })
      .returning();
    const row = { sourceId: source.id, rawText: 't', notifKey: 'dup', postedAt: 'now' };
    await db.insert(pendingNotifications).values(row);
    await expect(db.insert(pendingNotifications).values(row)).rejects.toThrow();
  });
});
```

Adjust imports to match what the test file already imports (it already has `createTestDb`, `buckets`, `categories` — check top of file and merge).

- [ ] **Step 4: Run tests**

Run: `npm test -- --selectProjects=logic src/db/schema.test.ts`
Expected: PASS (migration applied in-memory includes new tables).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts drizzle
git commit -m "feat: schema for notification sources, pending inbox, category rules"
```

---

### Task 2: Notification parser (pure)

**Files:**
- Create: `src/lib/notificationParser.ts`
- Test: `src/lib/notificationParser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/notificationParser.test.ts
import { parseNotification } from './notificationParser';

describe('parseNotification', () => {
  it('parses a GCash send as high-confidence expense', () => {
    const r = parseNotification('You have sent PHP 150.00 to JOLLIBEE MAKATI via GCash.');
    expect(r).toEqual({
      amountCentavos: 15000,
      merchant: 'JOLLIBEE MAKATI',
      direction: 'expense',
      confidence: 'high',
    });
  });

  it('parses a card charge with peso sign and thousands', () => {
    const r = parseNotification('Your card was charged ₱1,234.56 at SM SUPERMALLS on 07/10.');
    expect(r.amountCentavos).toBe(123456);
    expect(r.direction).toBe('expense');
    expect(r.merchant).toBe('SM SUPERMALLS');
    expect(r.confidence).toBe('high');
  });

  it('parses received money as income', () => {
    const r = parseNotification('You have received PHP 500.00 from JUAN DELA CRUZ.');
    expect(r.direction).toBe('income');
    expect(r.amountCentavos).toBe(50000);
    expect(r.confidence).toBe('high');
  });

  it('amount without a direction verb is medium confidence', () => {
    const r = parseNotification('Transaction alert: PHP 99.00 JOLLIBEE ref 12345');
    expect(r.amountCentavos).toBe(9900);
    expect(r.direction).toBeNull();
    expect(r.confidence).toBe('medium');
  });

  it('no amount means none confidence', () => {
    const r = parseNotification('Enjoy 20% off at partner stores this weekend!');
    expect(r.amountCentavos).toBeNull();
    expect(r.confidence).toBe('none');
  });

  it('amount without centavos still parses', () => {
    const r = parseNotification('You paid PHP 1,500 to MERALCO');
    expect(r.amountCentavos).toBe(150000);
    expect(r.direction).toBe('expense');
  });

  it('when both verbs appear, the earlier one wins', () => {
    const r = parseNotification('You received a refund. Previously paid PHP 100.00 at STORE.');
    expect(r.direction).toBe('income');
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- --selectProjects=logic src/lib/notificationParser.test.ts`
Expected: FAIL — cannot find module './notificationParser'.

- [ ] **Step 3: Implement**

```ts
// src/lib/notificationParser.ts
export interface ParsedNotification {
  amountCentavos: number | null;
  merchant: string | null;
  direction: 'expense' | 'income' | null;
  /** high = auto-commit, medium = inbox, none = discard (no amount). */
  confidence: 'high' | 'medium' | 'none';
}

// PHP 1,234.56 | ₱1,234.56 | Php 1500 — currency marker required to avoid
// matching reference numbers or dates.
const AMOUNT = /(?:PHP|Php|php|₱|P)\s*([\d,]+(?:\.\d{1,2})?)\b/;
// GCash "send money" logs as expense per spec.
const EXPENSE_VERB = /\b(spent|paid|purchased?|charged|debited|sent)\b/i;
const INCOME_VERB = /\b(received|refund(?:ed)?|cashback|credited)\b/i;
// "to JOLLIBEE MAKATI via ..." / "at SM SUPERMALLS on 07/10" / "from JUAN."
const MERCHANT =
  /\b(?:at|to|from)\s+([A-Z0-9][A-Za-z0-9 .&'\-]{1,40}?)(?=\s+(?:on|via|last|with|using)\b|[.,!]|$)/;

function centavosFrom(token: string): number {
  const clean = token.replace(/,/g, '');
  const [pesos, cents = ''] = clean.split('.');
  return parseInt(pesos, 10) * 100 + parseInt(cents.padEnd(2, '0') || '0', 10);
}

/**
 * Best-effort extraction from a bank/e-wallet notification. Never throws;
 * nulls mean "couldn't tell". Mirrors receiptParser.ts philosophy.
 */
export function parseNotification(text: string): ParsedNotification {
  const amountMatch = text.match(AMOUNT);
  const amountCentavos = amountMatch ? centavosFrom(amountMatch[1]) : null;

  const expense = text.match(EXPENSE_VERB);
  const income = text.match(INCOME_VERB);
  let direction: 'expense' | 'income' | null = null;
  if (expense && income) {
    direction = (income.index ?? 0) < (expense.index ?? 0) ? 'income' : 'expense';
  } else if (expense) {
    direction = 'expense';
  } else if (income) {
    direction = 'income';
  }

  const merchantMatch = text.match(MERCHANT);
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  const confidence =
    amountCentavos === null ? 'none' : direction === null ? 'medium' : 'high';

  return { amountCentavos, merchant, direction, confidence };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --selectProjects=logic src/lib/notificationParser.test.ts`
Expected: PASS (7 tests). If the merchant regex fights a test, fix the regex, not the test — the sample strings are the contract.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificationParser.ts src/lib/notificationParser.test.ts
git commit -m "feat: notification text parser (amount, merchant, direction, confidence)"
```

---

### Task 3: Notification repo — sources, rules, ingest, commit, expiry

**Files:**
- Create: `src/db/notificationRepo.ts`
- Test: `src/db/notificationRepo.test.ts`
- Modify: `src/db/repo.ts` (one line — `sourceNotifKey` on `NewTransactionInput`)

- [ ] **Step 1: Extend `NewTransactionInput` in `src/db/repo.ts`**

Add to the interface after `utangId?: number;`:

```ts
  /** Dedup/trace key when the txn came from a captured notification. */
  sourceNotifKey?: string;
```

- [ ] **Step 2: Write failing tests**

```ts
// src/db/notificationRepo.test.ts
import { createTestDb, TestDb } from './testDb';
import { buckets, categories, pendingNotifications, transactions } from './schema';
import {
  addCategoryRule,
  addSource,
  commitPending,
  discardPending,
  expirePending,
  ingestCaptured,
  listPending,
  matchCategory,
} from './notificationRepo';

async function setup(db: TestDb) {
  const [bucket] = await db.insert(buckets).values({ name: 'GCash' }).returning();
  const source = await addSource(db, {
    bucketId: bucket.id,
    packageName: 'com.globe.gcash.android',
  });
  return { bucket, source };
}

const NOW = '2026-07-10T08:00:00.000Z';

describe('ingestCaptured', () => {
  it('high confidence commits a transaction immediately', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: 'GCash',
          text: 'You have sent PHP 150.00 to JOLLIBEE via GCash.',
          postedAt: NOW,
          key: 'k1',
        },
      ],
      NOW,
    );
    expect(summary.committed).toBe(1);
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(15000);
    expect(txns[0].type).toBe('expense');
    expect(txns[0].sourceNotifKey).toBe('k1');
    expect(txns[0].date).toBe('2026-07-10');
    const rows = await db.select().from(pendingNotifications);
    expect(rows[0].status).toBe('committed');
  });

  it('medium confidence goes to the inbox', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: 'Transaction alert: PHP 99.00 JOLLIBEE ref 123',
          postedAt: NOW,
          key: 'k2',
        },
      ],
      NOW,
    );
    expect(summary.queued).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(0);
    const pending = await listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].parsedAmount).toBe(9900);
  });

  it('no amount is stored discarded (dedup) with no transaction', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: 'Enjoy 20% off this weekend!',
          postedAt: NOW,
          key: 'k3',
        },
      ],
      NOW,
    );
    expect(summary.discarded).toBe(1);
    expect(await listPending(db)).toHaveLength(0);
    const rows = await db.select().from(pendingNotifications);
    expect(rows[0].status).toBe('discarded');
  });

  it('unmapped package and duplicate keys are skipped', async () => {
    const db = createTestDb();
    await setup(db);
    const entry = {
      packageName: 'com.globe.gcash.android',
      title: null,
      text: 'You have sent PHP 10.00 to X.',
      postedAt: NOW,
      key: 'k4',
    };
    await ingestCaptured(db, [entry], NOW);
    const second = await ingestCaptured(
      db,
      [entry, { ...entry, key: 'k5', packageName: 'com.other.app' }],
      NOW,
    );
    expect(second.committed).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('matchKeyword source only claims matching text', async () => {
    const db = createTestDb();
    const [b1] = await db.insert(buckets).values({ name: 'Card 1111' }).returning();
    const [b2] = await db.insert(buckets).values({ name: 'Card 2222' }).returning();
    await addSource(db, { bucketId: b1.id, packageName: 'com.bank', matchKeyword: '1111' });
    await addSource(db, { bucketId: b2.id, packageName: 'com.bank', matchKeyword: '2222' });
    await ingestCaptured(
      db,
      [
        {
          packageName: 'com.bank',
          title: 'Bank',
          text: 'Card ending 2222 charged PHP 50.00 at STORE.',
          postedAt: NOW,
          key: 'k6',
        },
      ],
      NOW,
    );
    const [txn] = await db.select().from(transactions);
    expect(txn.bucketId).toBe(b2.id);
  });

  it('applies category rules on commit', async () => {
    const db = createTestDb();
    await setup(db);
    const [cat] = await db
      .insert(categories)
      .values({ name: 'Eating Out', type: 'expense' })
      .returning();
    await addCategoryRule(db, { keyword: 'jollibee', categoryId: cat.id });
    await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: 'You have sent PHP 150.00 to JOLLIBEE.',
          postedAt: NOW,
          key: 'k7',
        },
      ],
      NOW,
    );
    const [txn] = await db.select().from(transactions);
    expect(txn.categoryId).toBe(cat.id);
  });
});

describe('matchCategory', () => {
  it('lower priority wins; case-insensitive contains', () => {
    const rules = [
      { id: 1, keyword: 'store', categoryId: 10, priority: 5 },
      { id: 2, keyword: 'jollibee', categoryId: 20, priority: 0 },
    ];
    expect(matchCategory(rules, 'Paid at JOLLIBEE STORE 3')).toBe(20);
    expect(matchCategory(rules, 'Paid at APP STORE')).toBe(10);
    expect(matchCategory(rules, 'Paid at 7-ELEVEN')).toBeNull();
  });
});

describe('inbox actions + expiry', () => {
  async function queueOne(db: TestDb, key: string, postedAt: string) {
    await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: `Transaction alert: PHP 99.00 ref ${key}`,
          postedAt,
          key,
        },
      ],
      postedAt,
    );
  }

  it('commitPending inserts txn with overrides and marks committed', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'p1', NOW);
    const [pending] = await listPending(db);
    await commitPending(db, pending.id, { amount: 12345, note: 'edited' });
    const [txn] = await db.select().from(transactions);
    expect(txn.amount).toBe(12345);
    expect(txn.note).toBe('edited');
    expect(txn.sourceNotifKey).toBe('p1');
    expect(await listPending(db)).toHaveLength(0);
  });

  it('discardPending marks discarded', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'p2', NOW);
    const [pending] = await listPending(db);
    await discardPending(db, pending.id);
    expect(await listPending(db)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('expirePending commits items older than 2 days, leaves fresh ones', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'old', '2026-07-07T08:00:00.000Z');
    await queueOne(db, 'fresh', '2026-07-09T08:00:00.000Z');
    const summary = await expirePending(db, NOW);
    expect(summary.committed).toBe(1);
    expect(await listPending(db)).toHaveLength(1);
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].sourceNotifKey).toBe('old');
  });
});
```

- [ ] **Step 3: Run tests, verify failure**

Run: `npm test -- --selectProjects=logic src/db/notificationRepo.test.ts`
Expected: FAIL — cannot find module './notificationRepo'.

- [ ] **Step 4: Implement `src/db/notificationRepo.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { parseNotification } from '@/lib/notificationParser';
import { addExpense, addIncome } from './repo';
import {
  CategoryRule,
  categoryRules,
  NotificationSource,
  notificationSources,
  PendingNotification,
  pendingNotifications,
  transactions,
} from './schema';

/** Works against both drizzle drivers, same as repo.ts. */
type Db = any;

/** One captured notification, as drained from the native buffer. */
export interface CapturedNotification {
  packageName: string;
  title: string | null;
  text: string;
  postedAt: string; // ISO UTC from the Kotlin side
  key: string;
}

// ---------- sources ----------

export interface NewSourceInput {
  bucketId: number;
  packageName: string;
  matchKeyword?: string | null;
}

export async function addSource(db: Db, input: NewSourceInput): Promise<NotificationSource> {
  const packageName = input.packageName.trim();
  if (!packageName) throw new Error('Package name is required');
  const [row] = await db
    .insert(notificationSources)
    .values({ ...input, packageName })
    .returning();
  return row;
}

export async function listSources(db: Db): Promise<NotificationSource[]> {
  return db.select().from(notificationSources);
}

export async function updateSource(
  db: Db,
  id: number,
  patch: Partial<NewSourceInput> & { enabled?: boolean },
): Promise<void> {
  await db.update(notificationSources).set(patch).where(eq(notificationSources.id, id));
}

export async function deleteSource(db: Db, id: number): Promise<void> {
  // Pending rows reference the source; drop them first (they're just audit).
  await db.delete(pendingNotifications).where(eq(pendingNotifications.sourceId, id));
  await db.delete(notificationSources).where(eq(notificationSources.id, id));
}

/** Distinct enabled package names — pushed down to the native listener. */
export async function watchedPackages(db: Db): Promise<string[]> {
  const rows: NotificationSource[] = await db
    .select()
    .from(notificationSources)
    .where(eq(notificationSources.enabled, true));
  return [...new Set(rows.map((r) => r.packageName))];
}

// ---------- category rules ----------

export interface NewRuleInput {
  keyword: string;
  categoryId: number;
  priority?: number;
}

export async function addCategoryRule(db: Db, input: NewRuleInput): Promise<CategoryRule> {
  const keyword = input.keyword.trim().toLowerCase();
  if (!keyword) throw new Error('Keyword is required');
  const [row] = await db
    .insert(categoryRules)
    .values({ ...input, keyword })
    .returning();
  return row;
}

export async function listCategoryRules(db: Db): Promise<CategoryRule[]> {
  return db.select().from(categoryRules);
}

export async function deleteCategoryRule(db: Db, id: number): Promise<void> {
  await db.delete(categoryRules).where(eq(categoryRules.id, id));
}

/** Pure matcher: lowest priority, then lowest id, case-insensitive contains. */
export function matchCategory(
  rules: Pick<CategoryRule, 'id' | 'keyword' | 'categoryId' | 'priority'>[],
  text: string,
): number | null {
  const haystack = text.toLowerCase();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const rule of sorted) {
    if (haystack.includes(rule.keyword.toLowerCase())) return rule.categoryId;
  }
  return null;
}

// ---------- ingest ----------

export interface IngestSummary {
  committed: number;
  queued: number;
  discarded: number;
  skipped: number;
}

/**
 * Sources for a package: a keyword source claims the notification only when
 * the keyword appears in title+text; keyword-less source is the fallback.
 */
function pickSource(sources: NotificationSource[], haystack: string): NotificationSource | null {
  const withKeyword = sources.filter((s) => s.matchKeyword);
  for (const s of withKeyword) {
    if (haystack.toLowerCase().includes(s.matchKeyword!.toLowerCase())) return s;
  }
  return sources.find((s) => !s.matchKeyword) ?? null;
}

async function keyExists(db: Db, key: string): Promise<boolean> {
  const [pending] = await db
    .select({ id: pendingNotifications.id })
    .from(pendingNotifications)
    .where(eq(pendingNotifications.notifKey, key))
    .limit(1);
  if (pending) return true;
  const [txn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.sourceNotifKey, key))
    .limit(1);
  return Boolean(txn);
}

/** 'YYYY-MM-DD' in the device's local timezone for an ISO timestamp. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function ingestCaptured(
  db: Db,
  captured: CapturedNotification[],
  nowIso: string,
): Promise<IngestSummary> {
  const summary: IngestSummary = { committed: 0, queued: 0, discarded: 0, skipped: 0 };
  const allSources: NotificationSource[] = await db
    .select()
    .from(notificationSources)
    .where(eq(notificationSources.enabled, true));
  const rules: CategoryRule[] = await listCategoryRules(db);

  for (const item of captured) {
    const candidates = allSources.filter((s) => s.packageName === item.packageName);
    const haystack = `${item.title ?? ''} ${item.text}`;
    const source = pickSource(candidates, haystack);
    if (!source) {
      summary.skipped += 1;
      continue;
    }
    if (await keyExists(db, item.key)) {
      summary.skipped += 1;
      continue;
    }

    const parsed = parseNotification(item.text);
    const base = {
      sourceId: source.id,
      rawTitle: item.title,
      rawText: item.text,
      parsedAmount: parsed.amountCentavos,
      parsedMerchant: parsed.merchant,
      parsedType: parsed.direction,
      notifKey: item.key,
      postedAt: item.postedAt,
    };

    if (parsed.confidence === 'none') {
      await db.insert(pendingNotifications).values({ ...base, status: 'discarded' });
      summary.discarded += 1;
    } else if (parsed.confidence === 'high') {
      await insertParsedTransaction(db, source, base, rules);
      await db.insert(pendingNotifications).values({ ...base, status: 'committed' });
      summary.committed += 1;
    } else {
      await db.insert(pendingNotifications).values({ ...base, status: 'pending' });
      summary.queued += 1;
    }
  }
  return summary;
}

type ParsedRow = {
  sourceId: number;
  rawTitle: string | null;
  rawText: string;
  parsedAmount: number | null;
  parsedMerchant: string | null;
  parsedType: 'expense' | 'income' | null;
  notifKey: string;
  postedAt: string;
};

async function insertParsedTransaction(
  db: Db,
  source: NotificationSource,
  row: ParsedRow,
  rules: CategoryRule[],
): Promise<void> {
  const input = {
    amount: row.parsedAmount!,
    bucketId: source.bucketId,
    date: localDateOf(row.postedAt),
    categoryId: matchCategory(rules, row.rawText) ?? undefined,
    note: row.parsedMerchant ?? undefined,
    sourceNotifKey: row.notifKey,
  };
  if (row.parsedType === 'income') await addIncome(db, input);
  else await addExpense(db, input);
}

// ---------- inbox ----------

export interface PendingWithSource {
  pending: PendingNotification;
  source: NotificationSource;
}

export async function listPending(db: Db): Promise<PendingNotification[]> {
  return db
    .select()
    .from(pendingNotifications)
    .where(eq(pendingNotifications.status, 'pending'));
}

export async function pendingCount(db: Db): Promise<number> {
  return (await listPending(db)).length;
}

export interface CommitOverrides {
  amount?: number;
  bucketId?: number;
  categoryId?: number;
  note?: string;
  date?: string;
  type?: 'expense' | 'income';
}

export async function commitPending(
  db: Db,
  id: number,
  overrides: CommitOverrides = {},
): Promise<void> {
  const [row] = await db
    .select()
    .from(pendingNotifications)
    .where(and(eq(pendingNotifications.id, id), eq(pendingNotifications.status, 'pending')));
  if (!row) throw new Error(`No pending notification ${id}`);
  const [source] = await db
    .select()
    .from(notificationSources)
    .where(eq(notificationSources.id, row.sourceId));
  const rules: CategoryRule[] = await listCategoryRules(db);

  const amount = overrides.amount ?? row.parsedAmount;
  if (amount == null) throw new Error('Amount is required to commit');
  const input = {
    amount,
    bucketId: overrides.bucketId ?? source.bucketId,
    date: overrides.date ?? localDateOf(row.postedAt),
    categoryId: overrides.categoryId ?? matchCategory(rules, row.rawText) ?? undefined,
    note: overrides.note ?? row.parsedMerchant ?? undefined,
    sourceNotifKey: row.notifKey,
  };
  const type = overrides.type ?? row.parsedType ?? 'expense';
  if (type === 'income') await addIncome(db, input);
  else await addExpense(db, input);
  await db
    .update(pendingNotifications)
    .set({ status: 'committed' })
    .where(eq(pendingNotifications.id, id));
}

export async function discardPending(db: Db, id: number): Promise<void> {
  await db
    .update(pendingNotifications)
    .set({ status: 'discarded' })
    .where(eq(pendingNotifications.id, id));
}

// ---------- expiry ----------

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export interface ExpirySummary {
  committed: number;
  discarded: number;
}

/**
 * Auto-commit pending items older than 2 days (design: untouched inbox items
 * commit); items with no parsable amount are discarded instead.
 */
export async function expirePending(db: Db, nowIso: string): Promise<ExpirySummary> {
  const cutoff = new Date(new Date(nowIso).getTime() - TWO_DAYS_MS).toISOString();
  const rows: PendingNotification[] = await listPending(db);
  const summary: ExpirySummary = { committed: 0, discarded: 0 };
  for (const row of rows) {
    if (row.postedAt >= cutoff) continue;
    if (row.parsedAmount == null) {
      await discardPending(db, row.id);
      summary.discarded += 1;
    } else {
      await commitPending(db, row.id);
      summary.committed += 1;
    }
  }
  return summary;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --selectProjects=logic src/db/notificationRepo.test.ts`
Expected: PASS (all describe blocks). Then run the whole logic suite to catch regressions: `npm test -- --selectProjects=logic`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/notificationRepo.ts src/db/notificationRepo.test.ts src/db/repo.ts
git commit -m "feat: notification ingest pipeline with inbox, rules, 2-day expiry"
```

---

### Task 4: Native module — Kotlin NotificationListenerService

No unit tests (native code); verified manually in Task 8. Keep files exactly as written.

**Files:**
- Create: `modules/notification-listener/expo-module.config.json`
- Create: `modules/notification-listener/index.ts`
- Create: `modules/notification-listener/android/build.gradle`
- Create: `modules/notification-listener/android/src/main/AndroidManifest.xml`
- Create: `modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt`
- Create: `modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/NotificationBuffer.kt`
- Create: `modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/KuripotNotificationListenerService.kt`

- [ ] **Step 1: Module config**

File `modules/notification-listener/expo-module.config.json` (plain JSON — no comments):

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.notificationlistener.NotificationListenerModule"]
  }
}
```

- [ ] **Step 2: Gradle file**

```groovy
// modules/notification-listener/android/build.gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

group = 'expo.modules.notificationlistener'
version = '1.0.0'

def expoModulesCorePlugin = new File(project(':expo-modules-core').projectDir.absolutePath, 'ExpoModulesCorePlugin.gradle')
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()
useCoreDependencies()
useDefaultAndroidSdkVersions()

android {
  namespace 'expo.modules.notificationlistener'
}
```

- [ ] **Step 3: Manifest — service declaration + launcher queries**

```xml
<!-- modules/notification-listener/android/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- Lets getLaunchableApps() list apps for the source picker (API 30+). -->
  <queries>
    <intent>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent>
  </queries>
  <application>
    <service
      android:name="expo.modules.notificationlistener.KuripotNotificationListenerService"
      android:exported="false"
      android:label="Kuripot"
      android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
      <intent-filter>
        <action android:name="android.service.notification.NotificationListenerService" />
      </intent-filter>
    </service>
  </application>
</manifest>
```

- [ ] **Step 4: Shared buffer object**

```kotlin
// modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/NotificationBuffer.kt
package expo.modules.notificationlistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Bridge between the always-on listener service and the RN app.
 * - Watched packages persist in SharedPreferences (survive app death).
 * - Captured notifications append to a JSON-lines file; the app drains it
 *   on foreground. Appends and drains synchronize on this object.
 */
object NotificationBuffer {
  private const val PREFS = "kuripot_notification_listener"
  private const val KEY_WATCHED = "watched_packages"
  private const val BUFFER_FILE = "notification_buffer.jsonl"

  /** Set by the module while the RN app is alive, for live ingest. */
  @Volatile var onCaptured: ((String) -> Unit)? = null

  fun setWatchedPackages(context: Context, packages: List<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putStringSet(KEY_WATCHED, packages.toSet())
      .apply()
  }

  fun isWatched(context: Context, packageName: String): Boolean {
    val watched = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getStringSet(KEY_WATCHED, emptySet()) ?: emptySet()
    return watched.contains(packageName)
  }

  private fun bufferFile(context: Context) = File(context.filesDir, BUFFER_FILE)

  @Synchronized
  fun append(context: Context, entry: JSONObject) {
    bufferFile(context).appendText(entry.toString() + "\n")
    onCaptured?.invoke(entry.toString())
  }

  /** Read all buffered entries and clear the file. Returns a JSON array string. */
  @Synchronized
  fun drain(context: Context): String {
    val file = bufferFile(context)
    if (!file.exists()) return "[]"
    val array = JSONArray()
    file.readLines().forEach { line ->
      if (line.isNotBlank()) {
        try {
          array.put(JSONObject(line))
        } catch (_: Exception) {
          // corrupt line — drop it rather than wedge the whole drain
        }
      }
    }
    file.delete()
    return array.toString()
  }
}
```

- [ ] **Step 5: Listener service**

```kotlin
// modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/KuripotNotificationListenerService.kt
package expo.modules.notificationlistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.time.Instant

class KuripotNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.isOngoing) return // media players, foreground services
    val pkg = sbn.packageName ?: return
    if (!NotificationBuffer.isWatched(this, pkg)) return

    val extras = sbn.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
      ?: return

    val entry = JSONObject().apply {
      put("packageName", pkg)
      put("title", title ?: JSONObject.NULL)
      put("text", text)
      put("postedAt", Instant.ofEpochMilli(sbn.postTime).toString())
      // sbn.key alone repeats when an app re-posts the same id; postTime
      // disambiguates while still deduping listener-restart replays.
      put("key", "${sbn.key}#${sbn.postTime}")
    }
    NotificationBuffer.append(this, entry)
  }
}
```

- [ ] **Step 6: Expo module**

```kotlin
// modules/notification-listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt
package expo.modules.notificationlistener

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationListener")
    Events("onNotificationCaptured")

    OnCreate {
      NotificationBuffer.onCaptured = { json ->
        sendEvent("onNotificationCaptured", mapOf("entry" to json))
      }
    }

    OnDestroy {
      NotificationBuffer.onCaptured = null
    }

    Function("isPermissionGranted") {
      val context = appContext.reactContext ?: return@Function false
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners",
      ) ?: ""
      enabled.contains(context.packageName)
    }

    Function("openSettings") {
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("setWatchedPackages") { packages: List<String> ->
      val context = appContext.reactContext ?: return@Function
      NotificationBuffer.setWatchedPackages(context, packages)
    }

    Function("drainBuffer") {
      val context = appContext.reactContext ?: return@Function "[]"
      NotificationBuffer.drain(context)
    }

    Function("getLaunchableApps") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, String>>()
      val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val pm = context.packageManager
      pm.queryIntentActivities(intent, 0)
        .map {
          mapOf(
            "label" to it.loadLabel(pm).toString(),
            "packageName" to it.activityInfo.packageName,
          )
        }
        .distinctBy { it["packageName"] }
        .sortedBy { it["label"]?.lowercase() }
    }
  }
}
```

- [ ] **Step 7: TypeScript entry**

```ts
// modules/notification-listener/index.ts
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface CapturedEntry {
  packageName: string;
  title: string | null;
  text: string;
  postedAt: string;
  key: string;
}

export interface LaunchableApp {
  label: string;
  packageName: string;
}

interface NativeModuleShape {
  isPermissionGranted(): boolean;
  openSettings(): void;
  setWatchedPackages(packages: string[]): void;
  drainBuffer(): string;
  getLaunchableApps(): LaunchableApp[];
  addListener(event: string, cb: (payload: { entry: string }) => void): { remove(): void };
}

const native: NativeModuleShape | null =
  Platform.OS === 'android' ? requireNativeModule('NotificationListener') : null;

export const isAvailable = native !== null;

export function isPermissionGranted(): boolean {
  return native?.isPermissionGranted() ?? false;
}

export function openSettings(): void {
  native?.openSettings();
}

export function setWatchedPackages(packages: string[]): void {
  native?.setWatchedPackages(packages);
}

export function drainBuffer(): CapturedEntry[] {
  if (!native) return [];
  try {
    return JSON.parse(native.drainBuffer());
  } catch {
    return [];
  }
}

export function getLaunchableApps(): LaunchableApp[] {
  return native?.getLaunchableApps() ?? [];
}

/** Fires while the app is alive and a watched notification arrives. */
export function addCapturedListener(cb: (entry: CapturedEntry) => void): { remove(): void } {
  if (!native) return { remove: () => {} };
  return native.addListener('onNotificationCaptured', ({ entry }) => {
    try {
      cb(JSON.parse(entry));
    } catch {
      // corrupt payload — skip
    }
  });
}
```

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean (index.ts compiles; Kotlin is validated at build time in Task 8).

```bash
git add modules
git commit -m "feat: native Android notification listener module"
```

---

### Task 5: Sync orchestration + DbProvider wiring

**Files:**
- Create: `src/lib/notificationSync.ts`
- Modify: `src/db/DbProvider.tsx`

- [ ] **Step 1: Create `src/lib/notificationSync.ts`**

No unit test — thin glue over already-tested repo functions and the untestable native module (module import would crash jest's node env; keeping all native touches in this one file preserves testability everywhere else).

```ts
import { AppDb } from '@/db/client';
import {
  CapturedNotification,
  expirePending,
  ingestCaptured,
  watchedPackages,
} from '@/db/notificationRepo';
import {
  addCapturedListener,
  CapturedEntry,
  drainBuffer,
  isAvailable,
  setWatchedPackages,
} from '../../modules/notification-listener';

export interface SyncSummary {
  committed: number;
  queued: number;
}

/**
 * Full sync pass: push watched packages down to the native listener, drain
 * whatever it buffered while we were away, ingest, then run 2-day expiry.
 * Safe no-op off Android.
 */
export async function syncNotifications(db: AppDb): Promise<SyncSummary | null> {
  if (!isAvailable) return null;
  setWatchedPackages(await watchedPackages(db));
  const captured = drainBuffer() as CapturedNotification[];
  const nowIso = new Date().toISOString();
  const ingest = await ingestCaptured(db, captured, nowIso);
  const expiry = await expirePending(db, nowIso);
  return {
    committed: ingest.committed + expiry.committed,
    queued: ingest.queued,
  };
}

/** Live ingest while the app is open. Returns an unsubscribe function. */
export function subscribeLiveCapture(db: AppDb, onChange: () => void): () => void {
  if (!isAvailable) return () => {};
  const sub = addCapturedListener(async (entry: CapturedEntry) => {
    await ingestCaptured(db, [entry], new Date().toISOString());
    onChange();
  });
  return () => sub.remove();
}
```

- [ ] **Step 2: Wire into `src/db/DbProvider.tsx`**

Add imports:

```ts
import { AppState } from 'react-native';
import { subscribeLiveCapture, syncNotifications } from '@/lib/notificationSync';
```

Inside the existing startup effect, after `setDb(instance)` (notification sync is best-effort like `notifyPostedDues`):

```ts
        syncNotifications(instance)
          .then((s) => {
            if (s && (s.committed > 0 || s.queued > 0)) setVersion((v) => v + 1);
          })
          .catch(() => {
            // best-effort; never block startup
          });
```

Add a second effect after the first one (needs `db` in scope, so it depends on `db`):

```ts
  useEffect(() => {
    if (!db) return;
    const unsubscribe = subscribeLiveCapture(db, () => setVersion((v) => v + 1));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncNotifications(db)
          .then((s) => {
            if (s && (s.committed > 0 || s.queued > 0)) setVersion((v) => v + 1);
          })
          .catch(() => {});
      }
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [db]);
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test -- --selectProjects=logic`
Expected: both clean. (The `ui` jest project doesn't render DbProvider directly today; if `TransactionForm.test.tsx` breaks on the new native import chain, add `modules/notification-listener` to a `moduleNameMapper` stub in `jest.config.js` ui project: map `'^.+modules/notification-listener$'` to a manual mock file `src/lib/__mocks__/notificationListenerNative.ts` exporting `isAvailable = false` and no-op functions. Run `npm test` to check whether this is needed at all.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/notificationSync.ts src/db/DbProvider.tsx jest.config.js
git commit -m "feat: drain and ingest captured notifications on open/foreground"
```

---

### Task 6: Auto-log settings screen

**Files:**
- Create: `src/app/auto-log.tsx`
- Modify: `src/app/_layout.tsx` (register screen)
- Modify: `src/app/settings.tsx` (nav row)

UI follows existing screen style (see `src/app/settings.tsx`, `src/app/manage-buckets.tsx` for list/CRUD patterns; use `colors`, `fonts`, `spacing`, `radii` from `@/theme`; `useAppQuery` for reads; `refresh()` after writes).

- [ ] **Step 1: Register the route**

In `src/app/_layout.tsx`, after the `settings` screen:

```tsx
        <Stack.Screen name="auto-log" options={{ presentation: 'modal' }} />
```

- [ ] **Step 2: Add nav row in `src/app/settings.tsx`**

Follow the screen's existing button/row style. Android-only:

```tsx
import { Platform } from 'react-native';
// inside the ScrollView, near the other sections:
{Platform.OS === 'android' && (
  <Pressable style={styles.row} onPress={() => router.push('/auto-log')}>
    <Text style={styles.rowLabel}>Auto-log from notifications</Text>
  </Pressable>
)}
```

(Match `styles.row` / `styles.rowLabel` names to whatever the file actually uses — reuse existing styles, don't invent parallel ones.)

- [ ] **Step 3: Build `src/app/auto-log.tsx`**

Structure (single screen, three sections). Full behavior spec — implementer writes JSX in the file's established idiom:

```tsx
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert, FlatList, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import {
  addCategoryRule, addSource, deleteCategoryRule, deleteSource,
  listCategoryRules, listSources, updateSource,
} from '@/db/notificationRepo';
import { buckets as bucketsTable, categories as categoriesTable } from '@/db/schema';
import {
  getLaunchableApps, isAvailable, isPermissionGranted, openSettings,
} from '../../modules/notification-listener';
import { colors, fonts, radii, spacing } from '@/theme';
```

Behavior requirements:

1. **Permission section.** On Android, show granted/not-granted state from `isPermissionGranted()`; re-check via `useFocusEffect` (user returns from system settings) and a `useState` holding the flag. "Open notification access settings" button calls `openSettings()`. If `!isAvailable` (never on this screen off-Android, but guard anyway) show "Android only".
2. **Sources section.** `useAppQuery(listSources)` joined client-side with `useAppQuery((db) => db.select().from(bucketsTable))` for bucket names. Each row: bucket name + packageName + optional keyword + enabled `Switch` (`updateSource(db, id, { enabled })` then `refresh()`), long-press → `Alert.alert` confirm → `deleteSource` + `refresh()`. "Add source" opens a `Modal` with: app picker (`FlatList` of `getLaunchableApps()`, tap to select; plus a `TextInput` fallback for manual package entry), bucket picker (buttons over non-archived buckets, reuse the option-pill pattern from `TransactionForm`), optional keyword `TextInput`. Save → `addSource` → `refresh()` → close. After any source change, next `syncNotifications` pushes the updated package list down (already wired in Task 5); optionally call `setWatchedPackages(await watchedPackages(db))` directly for immediacy.
3. **Category rules section.** List rules with category names (join with categories query). Row: `keyword → category`, long-press to delete. "Add rule" opens a `Modal`: keyword `TextInput` + category picker (expense+income categories). Save → `addCategoryRule` → `refresh()`.

- [ ] **Step 4: Typecheck + manual smoke via existing tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean. No new UI tests in v1 (screen is thin over tested repo functions; matches existing screens which are untested).

- [ ] **Step 5: Commit**

```bash
git add src/app/auto-log.tsx src/app/_layout.tsx src/app/settings.tsx
git commit -m "feat: auto-log settings screen (permission, sources, category rules)"
```

---

### Task 7: Inbox screen + badge on transactions tab

**Files:**
- Create: `src/app/notification-inbox.tsx`
- Modify: `src/app/_layout.tsx` (register screen)
- Modify: `src/app/(tabs)/transactions.tsx` (badge entry point)

- [ ] **Step 1: Register route**

In `src/app/_layout.tsx`:

```tsx
        <Stack.Screen name="notification-inbox" options={{ presentation: 'modal' }} />
```

- [ ] **Step 2: Badge on transactions tab**

In `src/app/(tabs)/transactions.tsx`, near the existing header controls:

```tsx
import { pendingCount } from '@/db/notificationRepo';
// with the other queries:
const inboxCount = useAppQuery(pendingCount) ?? 0;
// in the header row (match existing header layout/styles):
{inboxCount > 0 && (
  <Pressable style={styles.inboxBadge} onPress={() => router.push('/notification-inbox')}>
    <Text style={styles.inboxBadgeText}>Inbox {inboxCount}</Text>
  </Pressable>
)}
```

Style `inboxBadge` as a small pill (accent background, `radii` rounded, `spacing.xs` padding) consistent with the screen's filter pills.

- [ ] **Step 3: Build `src/app/notification-inbox.tsx`**

Imports mirror auto-log screen. Behavior requirements:

1. Query `listPending` + sources + buckets + categories via `useAppQuery` (join client-side for display names).
2. Each row shows: parsed merchant (or first 60 chars of rawText), amount via `formatPeso(parsedAmount)` (or "no amount"), direction, bucket name, posted date, and days-remaining note: `commits in Xd` where `X = max(0, ceil(2 - (now - postedAt)/86400e3))` — or "will be discarded" when `parsedAmount == null`.
3. Row actions:
   - **Confirm**: `commitPending(db, id)` then `refresh()`.
   - **Edit & confirm**: inline `Modal` with `AmountInput` (existing component), type toggle (expense/income), bucket picker, category picker, note `TextInput`; save calls `commitPending(db, id, overrides)` then `refresh()`.
   - **Discard**: `Alert.alert` confirm → `discardPending(db, id)` → `refresh()`.
4. Empty state text: "No pending notifications."

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/notification-inbox.tsx src/app/_layout.tsx "src/app/(tabs)/transactions.tsx"
git commit -m "feat: notification inbox with confirm/edit/discard and tab badge"
```

---

### Task 8: On-device verification (manual)

No code. Requires a physical/emulated Android device.

- [ ] **Step 1: Build dev client**

Run: `npx expo run:android`
Expected: build succeeds — this is where the Kotlin from Task 4 first compiles. Fix any compile errors in the module (typical: expo-modules-core API drift; check `ExpoModulesCorePlugin.gradle` usage against another installed module under `node_modules/expo-modules-core`).

- [ ] **Step 2: Grant permission**

In app: Settings → "Auto-log from notifications" → "Open notification access settings" → enable Kuripot. Back in app, status flips to granted.

- [ ] **Step 3: Map a test source**

Add source: app = **Shell** (`com.android.shell`) via the manual package input, bucket = GCash. (adb posts notifications as `com.android.shell`.)

- [ ] **Step 4: Post test notifications via adb**

```bash
adb shell cmd notification post -S bigtext -t "GCash" tag1 "You have sent PHP 150.00 to JOLLIBEE via GCash."
adb shell cmd notification post -S bigtext -t "GCash" tag2 "Transaction alert: PHP 99.00 JOLLIBEE ref 12345"
adb shell cmd notification post -S bigtext -t "GCash" tag3 "Enjoy 20% off this weekend!"
```

Expected, app in foreground (live path): first → new expense ₱150.00 appears in transactions; second → Inbox badge shows 1; third → nothing visible.

- [ ] **Step 5: Background path**

Kill the app (swipe away). Post another `cmd notification post` line. Reopen app. Expected: it ingests on startup (drain path) — transaction or inbox item appears.

- [ ] **Step 6: Inbox flows**

Confirm the pending item → becomes a transaction. Post another medium-confidence one, discard it → disappears, no transaction. Duplicate `adb` line reposted → no duplicate transaction (key dedup).

- [ ] **Step 7: Commit any fixes; final full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

```bash
git add -A
git commit -m "fix: on-device adjustments for notification auto-log"
```

---

## Out of scope (per spec)

- iOS anything. Transfers. Gmail/email path. Background expiry timer (expiry runs on app open). Recovering notifications missed while the listener was dead.
