import { useEffect } from 'react';
import { act, render } from '@testing-library/react-native';
import { DbProvider, useDb } from '@/db/DbProvider';
import { useAppQuery, useAppQueryResult } from '@/db/hooks';
import { addCategoryRule, pendingCount } from '@/db/notificationRepo';
import { addExpense, allBucketBalances, listTransactions, totalMoney } from '@/db/repo';
import {
  buckets as bucketsTable,
  categories as categoriesTable,
  installments as installmentsTable,
  recurring as recurringTable,
} from '@/db/schema';
import { expensesByCategory, monthlyCommitments, monthSummary, sixMonthTrend } from '@/db/statsRepo';
import { createTestDb, TestDb } from '@/db/testDb';
import { listUtang, utangTotals } from '@/db/utangRepo';

// Hoisted above the imports by babel-plugin-jest-hoist. The provider's real
// collaborators open a SQLite handle, talk to expo-notifications and load the
// LLM — none of which this test is about.
jest.mock('@/db/client', () => ({ openAppDb: () => Promise.resolve(mockDb) }));
jest.mock('@/lib/llmController', () => ({ unload: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ notifyPostedDues: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/notificationSync', () => ({
  subscribeLiveCapture: jest.fn(() => () => {}),
  syncNotifications: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('@/lib/recurringEngine', () => ({ runCatchUp: jest.fn(() => Promise.resolve(null)) }));

let mockDb: TestDb;

const MONTH = '2026-08';

/** Counts prepared statements the way the perf pass measured them. */
let prepared = 0;
function instrument(db: TestDb): void {
  const client = (db as any).session.client;
  const original = client.prepare.bind(client);
  client.prepare = (sql: string) => {
    prepared += 1;
    return original(sql);
  };
}
function take(): number {
  const n = prepared;
  prepared = 0;
  return n;
}

/** 8 buckets / 3000 transactions / 40 categories / 20 utang, seeded raw. */
function seed(db: TestDb): void {
  const raw = (db as any).session.client;
  raw.exec('begin');
  for (let i = 1; i <= 8; i += 1) {
    raw
      .prepare('insert into buckets (name, type, starting_balance) values (?, ?, ?)')
      .run(`Bucket ${i}`, i === 8 ? 'credit' : 'bucket', i === 8 ? -50_000 : 100_000);
  }
  for (let i = 1; i <= 40; i += 1) {
    raw
      .prepare('insert into categories (name, type) values (?, ?)')
      .run(`Cat ${i}`, i % 5 === 0 ? 'income' : 'expense');
  }
  for (let i = 1; i <= 20; i += 1) {
    raw
      .prepare(
        'insert into utang (person_name, direction, original_amount, created_at) values (?, ?, ?, ?)',
      )
      .run(`Person ${i}`, i % 2 ? 'iOwe' : 'owedToMe', 100_000 + i, '2026-01-01');
  }
  const insertTxn = raw.prepare(
    `insert into transactions (type, amount, bucket_id, to_bucket_id, category_id, date, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < 3000; i += 1) {
    const type = i % 17 === 0 ? 'transfer' : i % 5 === 0 ? 'income' : 'expense';
    const bucketId = (i % 8) + 1;
    const month = 3 + (i % 6);
    insertTxn.run(
      type,
      100 + i,
      bucketId,
      type === 'transfer' ? ((i + 3) % 8) + 1 : null,
      type === 'transfer' ? null : (i % 40) + 1,
      `2026-0${month}-${String((i % 28) + 1).padStart(2, '0')}`,
      '2026-08-01T00:00:00.000Z',
    );
  }
  raw.exec('commit');
}

/** Per-query run counter, so "did domain B re-run?" is a direct assertion. */
const runs = new Map<string, number>();
function counted<T>(name: string, fn: (db: any) => Promise<T>) {
  return (db: any) => {
    runs.set(name, (runs.get(name) ?? 0) + 1);
    return fn(db);
  };
}
function runsOf(name: string): number {
  return runs.get(name) ?? 0;
}

function HomeTab() {
  useAppQuery(counted('home.total', (db) => totalMoney(db)));
  useAppQuery(counted('home.balances', (db) => allBucketBalances(db)));
  useAppQueryResult(counted('home.recent', (db) => listTransactions(db, { limit: 10 })));
  useAppQuery(counted('home.categories', (db) => db.select().from(categoriesTable)));
  useAppQuery(counted('home.buckets', (db) => db.select().from(bucketsTable)));
  return null;
}

function StatsTab() {
  useAppQueryResult(counted('stats.summary', (db) => monthSummary(db, MONTH)));
  useAppQueryResult(counted('stats.byCategory', (db) => expensesByCategory(db, MONTH)));
  useAppQueryResult(counted('stats.trend', (db) => sixMonthTrend(db, MONTH)));
  useAppQueryResult(counted('stats.balances', (db) => allBucketBalances(db)));
  useAppQuery(counted('stats.total', (db) => totalMoney(db)));
  useAppQuery(counted('stats.commitments', (db) => monthlyCommitments(db)));
  useAppQuery(counted('stats.utang', (db) => utangTotals(db)));
  return null;
}

function UtangTab() {
  useAppQuery(counted('utang.totals', (db) => utangTotals(db)));
  useAppQuery(counted('utang.iOwe', (db) => listUtang(db, 'iOwe')));
  useAppQuery(counted('utang.owedToMe', (db) => listUtang(db, 'owedToMe')));
  return null;
}

function RecurringTab() {
  useAppQuery(counted('recurring.rules', (db) => db.select().from(recurringTable)));
  useAppQuery(counted('recurring.plans', (db) => db.select().from(installmentsTable)));
  return null;
}

function TransactionsTab() {
  useAppQueryResult(counted('txns.list', (db) => listTransactions(db, { month: MONTH })));
  useAppQuery(counted('txns.categories', (db) => db.select().from(categoriesTable)));
  useAppQuery(counted('txns.buckets', (db) => db.select().from(bucketsTable)));
  useAppQuery(counted('txns.inbox', (db) => pendingCount(db)));
  return null;
}

let ctxDb: any;
let ctxRefresh: () => void = () => {};
function Capture() {
  const { db, refresh } = useDb();
  // In an effect, not in the render body: assigning to module scope during
  // render is a side effect, and `react-hooks/globals` rejects it.
  useEffect(() => {
    ctxDb = db;
    ctxRefresh = refresh;
  }, [db, refresh]);
  return null;
}

/** Every tab mounted at once — expo-router keeps them alive once visited. */
async function mountAllTabs(): Promise<void> {
  // `render` must be inside `act`: the provider renders null until `openAppDb`
  // resolves, and that resolution is only flushed by the act it happened in —
  // rendering outside one leaves the children permanently unmounted, however
  // many empty acts follow.
  await act(async () => {
    render(
      <DbProvider>
        <Capture />
        <HomeTab />
        <StatsTab />
        <UtangTab />
        <RecurringTab />
        <TransactionsTab />
      </DbProvider>,
    );
  });
  if (ctxDb === undefined) throw new Error('DbProvider never handed down a context');
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {});
  }
}

beforeAll(() => {
  mockDb = createTestDb();
  seed(mockDb);
  instrument(mockDb);
});

beforeEach(() => {
  runs.clear();
  take();
});

describe('write invalidation is scoped to the tables the write touched', () => {
  it('re-runs only the queries that read `transactions`', async () => {
    await mountAllTabs();
    runs.clear();
    take();

    await act(async () => {
      await addExpense(ctxDb, { amount: 12_345, bucketId: 1, date: '2026-08-16', categoryId: 1 });
    });
    const writeStatements = take();
    await act(async () => {
      ctxRefresh();
    });
    await settle();
    const refetchStatements = take();

    console.log(
      `[perf] one "add transaction" with all 5 tabs mounted: ` +
        `${writeStatements} write + ${refetchStatements} re-query statements`,
    );

    // Queries that read `transactions` must re-run — a stale screen is the
    // worse bug.
    expect(runsOf('home.total')).toBe(1);
    expect(runsOf('home.balances')).toBe(1);
    expect(runsOf('home.recent')).toBe(1);
    expect(runsOf('stats.summary')).toBe(1);
    expect(runsOf('stats.byCategory')).toBe(1);
    expect(runsOf('stats.trend')).toBe(1);
    expect(runsOf('txns.list')).toBe(1);

    // Queries that read no table the write touched must not.
    expect(runsOf('home.categories')).toBe(0);
    expect(runsOf('home.buckets')).toBe(0);
    expect(runsOf('txns.categories')).toBe(0);
    expect(runsOf('txns.buckets')).toBe(0);
    expect(runsOf('txns.inbox')).toBe(0);
    expect(runsOf('utang.totals')).toBe(0);
    expect(runsOf('utang.iOwe')).toBe(0);
    expect(runsOf('utang.owedToMe')).toBe(0);
    expect(runsOf('stats.utang')).toBe(0);
    expect(runsOf('stats.commitments')).toBe(0);
    expect(runsOf('recurring.rules')).toBe(0);
    expect(runsOf('recurring.plans')).toBe(0);

    // The measured regression: 213 statements from one write, from the global
    // version bump plus `allBucketBalances`' scan-per-bucket. Both fixes are
    // needed to stay under this bound.
    expect(refetchStatements).toBeLessThan(40);
  });

  it('leaves every tab alone when the write touches a table none of them read', async () => {
    await mountAllTabs();
    runs.clear();

    await act(async () => {
      await addCategoryRule(ctxDb, { keyword: 'jollibee', categoryId: 1 });
    });
    await act(async () => {
      ctxRefresh();
    });
    await settle();

    expect(runsOf('utang.totals')).toBe(0);
    expect(runsOf('home.balances')).toBe(0);
    expect(runsOf('txns.list')).toBe(0);
  });
});
