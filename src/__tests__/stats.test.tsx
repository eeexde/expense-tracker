import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createElement } from 'react';
import { View } from 'react-native';
import { addExpense } from '@/db/repo';
import { buckets } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
import { currentMonth } from '@/theme';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these imports,
// so the screen's transitive DbProvider / statsRepo imports are already mocked
// when it loads.
import StatsScreen from '@/app/(tabs)/stats';

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

// The real charts animate on a timer that outlives the test environment (the
// callback re-imports react-native after teardown and takes the worker down
// with it). Stubs keep this suite on what it is about: which of the three
// branches — loading, empty, chart — the screen picks.
// Deref'd at render time, not factory time: the factory runs while this
// module's own bindings are still in their TDZ.
const mockChart = (testID: string) => createElement(View, { testID });
jest.mock('react-native-gifted-charts', () => ({
  BarChart: () => mockChart('trend-chart'),
  PieChart: () => mockChart('category-chart'),
}));

// Runs the real queries by default. `render` awaits act, which flushes the
// query's microtasks, so the only way to observe a loading branch is to hold
// the corresponding promise open.
const mockSixMonthTrend = jest.fn();
const mockExpensesByCategory = jest.fn();
const mockMonthSummary = jest.fn();
jest.mock('../db/statsRepo', () => ({
  ...jest.requireActual('../db/statsRepo'),
  sixMonthTrend: (...args: unknown[]) => mockSixMonthTrend(...args),
  expensesByCategory: (...args: unknown[]) => mockExpensesByCategory(...args),
  monthSummary: (...args: unknown[]) => mockMonthSummary(...args),
}));
const realStatsRepo = jest.requireActual<typeof import('../db/statsRepo')>('../db/statsRepo');

const mockAllBucketBalances = jest.fn();
jest.mock('../db/repo', () => ({
  ...jest.requireActual('../db/repo'),
  allBucketBalances: (...args: unknown[]) => mockAllBucketBalances(...args),
}));
const realRepo = jest.requireActual<typeof import('../db/repo')>('../db/repo');

beforeEach(() => {
  mockTestDb = createTestDb();
  mockSixMonthTrend.mockImplementation(realStatsRepo.sixMonthTrend);
  mockExpensesByCategory.mockImplementation(realStatsRepo.expensesByCategory);
  mockMonthSummary.mockImplementation(realStatsRepo.monthSummary);
  mockAllBucketBalances.mockImplementation(realRepo.allBucketBalances);
});

/**
 * sixMonthTrend always returns six points, zero-filled for months with no
 * activity, so the bar data is never empty once the query resolves. Gating the
 * empty state on its length therefore made "No data yet." a loading placeholder
 * that vanished at exactly the wrong moment: a fresh install ended up staring at
 * 12 flat bars under a fabricated ₱0–₱3 money axis.
 */
describe('stats last-6-months section', () => {
  it('shows a spinner, not the empty state, while the trend is still loading', async () => {
    mockSixMonthTrend.mockImplementation(() => new Promise(() => {}));

    await render(<StatsScreen />);

    expect(screen.getByTestId('trend-loading')).toBeTruthy();
    expect(screen.queryByText('No data yet.')).toBeNull();
    expect(screen.queryByTestId('trend-chart')).toBeNull();
  });

  it('shows the empty state, not a chart, when six months hold no activity', async () => {
    await render(<StatsScreen />);

    expect(screen.getByText('No data yet.')).toBeTruthy();
    expect(screen.queryByTestId('trend-chart')).toBeNull();
    expect(screen.queryByTestId('trend-loading')).toBeNull();
  });

  it('charts the trend once there is activity', async () => {
    const [bucket] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await addExpense(mockTestDb, {
      amount: 250000,
      bucketId: bucket.id,
      date: `${currentMonth()}-15`,
    });

    await render(<StatsScreen />);

    expect(screen.getByTestId('trend-chart')).toBeTruthy();
    expect(screen.queryByText('No data yet.')).toBeNull();
  });
});

/**
 * Same defect class one section up: the donut's slices are empty both while
 * `expensesByCategory` is still in flight and when the month genuinely has no
 * expenses, so gating on `slices.length` alone made "No expenses this month."
 * a loading placeholder.
 */
describe('stats where-the-money-went section', () => {
  it('shows a spinner, not the empty state, while the breakdown is still loading', async () => {
    mockExpensesByCategory.mockImplementation(() => new Promise(() => {}));

    await render(<StatsScreen />);

    expect(screen.getByTestId('category-loading')).toBeTruthy();
    expect(screen.queryByText('No expenses this month.')).toBeNull();
    expect(screen.queryByTestId('category-chart')).toBeNull();
  });

  it('shows the empty state, not a chart, when the month has no expenses', async () => {
    await render(<StatsScreen />);

    expect(screen.getByText('No expenses this month.')).toBeTruthy();
    expect(screen.queryByTestId('category-chart')).toBeNull();
    expect(screen.queryByTestId('category-loading')).toBeNull();
  });

  /**
   * The donut and the peso total in its centre come from two independently
   * resolving queries. Gating only on the breakdown draws the chart around a
   * ₱0.00 centre until the summary lands.
   */
  it('waits for the centre total too, not just the breakdown', async () => {
    const [bucket] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await addExpense(mockTestDb, {
      amount: 250000,
      bucketId: bucket.id,
      date: `${currentMonth()}-15`,
    });
    mockMonthSummary.mockImplementation(() => new Promise(() => {}));

    await render(<StatsScreen />);

    expect(screen.getByTestId('category-loading')).toBeTruthy();
    expect(screen.queryByTestId('category-chart')).toBeNull();
  });

  it('charts the breakdown once there are expenses', async () => {
    const [bucket] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await addExpense(mockTestDb, {
      amount: 250000,
      bucketId: bucket.id,
      date: `${currentMonth()}-15`,
    });

    await render(<StatsScreen />);

    expect(screen.getByTestId('category-chart')).toBeTruthy();
    expect(screen.queryByText('No expenses this month.')).toBeNull();
    expect(screen.queryByTestId('category-loading')).toBeNull();
  });
});

/**
 * Third instance of the same defect class. `allBucketBalances` returns nothing
 * to map both while it is in flight and on a fresh install, so a card that
 * always renders showed a lone "Total ₱0.00" row as its loading state.
 */
describe('stats money-per-bucket section', () => {
  it('shows a spinner, not an empty card, while the balances are still loading', async () => {
    mockAllBucketBalances.mockImplementation(() => new Promise(() => {}));

    await render(<StatsScreen />);

    expect(screen.getByTestId('bucket-loading')).toBeTruthy();
    expect(screen.queryByText('No buckets yet.')).toBeNull();
  });

  it('shows the empty state once it knows there are no buckets', async () => {
    await render(<StatsScreen />);

    expect(screen.getByText('No buckets yet.')).toBeTruthy();
    expect(screen.queryByTestId('bucket-loading')).toBeNull();
  });

  it('lists the buckets once they load', async () => {
    await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();

    await render(<StatsScreen />);

    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.queryByText('No buckets yet.')).toBeNull();
    expect(screen.queryByTestId('bucket-loading')).toBeNull();
  });
});

/**
 * The bars are an SVG with nothing readable in it, so the section used to have
 * no non-visual equivalent at all — where the donut directly above it has
 * always duplicated its data in a text legend. `mockSixMonthTrend` is stubbed
 * here rather than seeded through the repo so the six months are fixed values
 * that do not move with the calendar.
 */
describe('stats last-6-months text equivalent', () => {
  const TREND = [
    { ym: '2026-03', income: 100000, expenses: 40000 },
    { ym: '2026-04', income: 0, expenses: 0 },
    { ym: '2026-05', income: 0, expenses: 0 },
    { ym: '2026-06', income: 0, expenses: 0 },
    { ym: '2026-07', income: 0, expenses: 0 },
    { ym: '2026-08', income: 250000, expenses: 125050 },
  ];

  it('states every charted month in text, not only in the bars', async () => {
    mockSixMonthTrend.mockResolvedValue(TREND);

    await render(<StatsScreen />);

    expect(screen.getByTestId('trend-chart')).toBeTruthy();
    // Both ends of the range, and both series of the busiest month. Without the
    // text rows these amounts exist nowhere outside the SVG.
    expect(screen.getByText('+₱1,000.00')).toBeTruthy();
    expect(screen.getByText('−₱400.00')).toBeTruthy();
    expect(screen.getByText('+₱2,500.00')).toBeTruthy();
    expect(screen.getByText('−₱1,250.50')).toBeTruthy();
  });

  it('reads each month as one labelled node rather than three fragments', async () => {
    mockSixMonthTrend.mockResolvedValue(TREND);

    await render(<StatsScreen />);

    // The row is `accessible`, so a screen reader gets the month and both
    // series together — the colored +/− pair alone would be meaningless.
    expect(
      screen.getByLabelText('August 2026: income ₱2,500.00, expenses ₱1,250.50'),
    ).toBeTruthy();
  });
});

/**
 * "Others" folds every category past the top five into one slice. Its percent
 * used to be the *sum of the already-rounded* per-category percents, so
 * everything that rounded to zero vanished from it: the slice was drawn at the
 * right size while its own label disagreed.
 */
describe('stats "Others" percentage', () => {
  it('rounds the summed total, not the sum of the rounded parts', async () => {
    // ₱1,000.00 across 15 categories: five at ₱192.02 (19% each, the donut's
    // five colored slots) and ten at ₱3.99. Each of the ten is 0.399% and
    // rounds to 0, so summing the parts gave "Others" 0% — while ₱39.90 of
    // ₱1,000.00 is 4% and the slice was drawn as such.
    mockExpensesByCategory.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, i) => ({
        categoryId: i + 1,
        categoryName: `Big ${i + 1}`,
        total: 19202,
        pct: 19,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        categoryId: i + 6,
        categoryName: `Tiny ${i + 1}`,
        total: 399,
        pct: 0,
      })),
    ]);
    mockMonthSummary.mockResolvedValue({ income: 0, expenses: 100000, net: -100000 });

    await render(<StatsScreen />);

    // Twice: the donut legend, and the amount list under it.
    expect(screen.getAllByText('Others')).toHaveLength(2);
    // The percent is legend-only, and it is the one this defect got wrong.
    expect(screen.getByText('4%')).toBeTruthy();
    // No slice in this month is genuinely 0%, so a 0% on screen can only be
    // the "Others" defect.
    expect(screen.queryByText('0%')).toBeNull();
  });
});

/**
 * A rejected query used to be rethrown out of `useAppQuery` into the root
 * `ErrorBoundary` — which sits above the router `Stack`, so one dead section
 * replaced the whole app and "Try again" dropped the user at the initial route.
 * It now costs the section that asked for it, and nothing else.
 */
describe('stats query failure', () => {
  it('offers an inline retry in place of the section that failed', async () => {
    mockSixMonthTrend.mockRejectedValue(new Error('db gone'));

    await render(<StatsScreen />);

    await waitFor(() => expect(screen.getByTestId('trend-error')).toBeTruthy());
    // The rest of the screen is still mounted and still usable.
    expect(screen.getByText('Money per bucket')).toBeTruthy();
    expect(screen.getByText('No expenses this month.')).toBeTruthy();
  });

  it('re-runs only the failed query when Retry is pressed', async () => {
    mockSixMonthTrend.mockRejectedValueOnce(new Error('db gone'));

    await render(<StatsScreen />);
    await waitFor(() => expect(screen.getByTestId('trend-error')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('trend-error-retry'));

    await waitFor(() => expect(screen.queryByTestId('trend-error')).toBeNull());
    expect(screen.getByText('No data yet.')).toBeTruthy();
  });

  /**
   * A rejection *after* a result has landed keeps the last good one. The old
   * hook did the opposite: the failure was never cleared on a dep change, and
   * it was rethrown, so a transient rejection on a re-query tore down a screen
   * that had something perfectly good to show.
   */
  it('keeps the last good result when a later run rejects', async () => {
    const [bucket] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await addExpense(mockTestDb, {
      amount: 250000,
      bucketId: bucket.id,
      date: `${currentMonth()}-15`,
    });

    await render(<StatsScreen />);
    expect(screen.getByTestId('trend-chart')).toBeTruthy();

    // Stepping a month back re-runs the month-keyed queries; this one fails.
    mockSixMonthTrend.mockRejectedValue(new Error('db gone'));
    const callsBefore = mockSixMonthTrend.mock.calls.length;
    await fireEvent.press(screen.getByText('‹'));

    await waitFor(() =>
      expect(mockSixMonthTrend.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect(screen.getByTestId('trend-chart')).toBeTruthy();
    expect(screen.queryByTestId('trend-error')).toBeNull();
  });
});
