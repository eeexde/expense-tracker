import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { addExpense, addTransfer } from '@/db/repo';
import { buckets, recurring } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
import { colors, currentMonth } from '@/theme';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these imports,
// so the screen's transitive expo-router / DbProvider imports are already mocked
// when it loads.
import TransactionsScreen from '@/app/(tabs)/transactions';

let mockTestDb: TestDb;
const mockPush = jest.fn();
let mockParams: { bucketId?: string; at?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

// Same cold-cache story as jest.config.js's `testTimeout`: the first render in
// this file transforms the react-native graph inside the test body, which on a
// cold CI cache outruns the 1000ms default and fails the first `waitFor` with
// "render function has not been called".
configure({ asyncUtilTimeout: 10000 });

const month = currentMonth();
const day = (d: string) => `${month}-${d}`;

async function makeBuckets() {
  const [cash] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
  const [gcash] = await mockTestDb.insert(buckets).values({ name: 'GCash' }).returning();
  return { cash, gcash };
}

/** Waits past the first paint, when the queries have not resolved yet. */
async function waitForScreen() {
  await waitFor(() => expect(screen.getByTestId('filter-type-all')).toBeTruthy());
}

/** The amount Text renders `[sign, formatted]`, so join rather than index. */
function amountTextOf(txnId: number): string {
  const children = screen.getByTestId(`amount-${txnId}`).props.children;
  return (Array.isArray(children) ? children : [children]).join('');
}

function amountColorOf(txnId: number): string {
  return StyleSheet.flatten(screen.getByTestId(`amount-${txnId}`).props.style).color;
}

beforeEach(() => {
  mockTestDb = createTestDb();
  mockPush.mockClear();
  mockParams = {};
});

/* -------------------------------------------------------------------------- */

describe('add-transaction entry point', () => {
  it('pushes /add-transaction from the FAB', async () => {
    await render(<TransactionsScreen />);
    await waitForScreen();

    fireEvent.press(screen.getByTestId('add-transaction-fab'));
    expect(mockPush).toHaveBeenCalledWith('/add-transaction');
  });

  it('leaves room under the last row for the FAB', async () => {
    await render(<TransactionsScreen />);
    await waitForScreen();

    const list = screen.getByTestId('transaction-list');
    const padding = StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom;
    // 60dp button + its 24dp bottom inset.
    expect(padding).toBeGreaterThanOrEqual(84);
  });
});

describe('transfers under a bucket filter', () => {
  it('shows the transfer on both buckets, signed from each side', async () => {
    const { cash, gcash } = await makeBuckets();
    const transfer = await addTransfer(mockTestDb, {
      amount: 30000,
      bucketId: cash.id,
      toBucketId: gcash.id,
      date: day('03'),
    });

    await render(<TransactionsScreen />);
    await waitForScreen();

    // Source bucket: money out.
    fireEvent.press(screen.getByTestId(`filter-bucket-${cash.id}`));
    await waitFor(() => expect(screen.getByTestId(`transaction-row-${transfer.id}`)).toBeTruthy());
    expect(amountTextOf(transfer.id)).toContain('−₱300.00');
    expect(amountColorOf(transfer.id)).toBe(colors.expense);

    // Destination bucket: the same row, money in — this is the leg the list
    // used to drop.
    fireEvent.press(screen.getByTestId(`filter-bucket-${gcash.id}`));
    await waitFor(() => expect(amountTextOf(transfer.id)).toContain('+₱300.00'));
    expect(amountColorOf(transfer.id)).toBe(colors.income);
  });

  it('stays neutral with no bucket filter', async () => {
    const { cash, gcash } = await makeBuckets();
    const transfer = await addTransfer(mockTestDb, {
      amount: 30000,
      bucketId: cash.id,
      toBucketId: gcash.id,
      date: day('03'),
    });

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`transaction-row-${transfer.id}`)).toBeTruthy());
    expect(amountTextOf(transfer.id)).toContain('₱300.00');
    expect(amountTextOf(transfer.id)).not.toContain('+');
    expect(amountColorOf(transfer.id)).toBe(colors.transfer);
  });
});

describe('duplicate highlight', () => {
  it('marks same-amount same-date rows and nothing else', async () => {
    const { cash } = await makeBuckets();
    const first = await addExpense(mockTestDb, {
      amount: 25000,
      bucketId: cash.id,
      date: day('04'),
    });
    const second = await addExpense(mockTestDb, {
      amount: 25000,
      bucketId: cash.id,
      date: day('04'),
    });
    const other = await addExpense(mockTestDb, {
      amount: 25000,
      bucketId: cash.id,
      date: day('05'),
    });

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`transaction-row-${other.id}`)).toBeTruthy());

    expect(screen.getByTestId(`duplicate-marker-${first.id}`)).toBeTruthy();
    expect(screen.getByTestId(`duplicate-marker-${second.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`duplicate-marker-${other.id}`)).toBeNull();

    // Subtle: one step up the surface ramp, not a danger colour.
    const tint = StyleSheet.flatten(
      screen.getByTestId(`transaction-row-${first.id}`).props.style,
    ).backgroundColor;
    expect(tint).toBe(colors.surface);
  });

  it('does not flag a recurring posting against a manual entry', async () => {
    const { cash } = await makeBuckets();
    const [rule] = await mockTestDb
      .insert(recurring)
      .values({
        name: 'Rent',
        amount: 25000,
        bucketId: cash.id,
        frequency: 'monthly',
        dayDue: 4,
        startDate: day('01'),
      })
      .returning();
    const posted = await addExpense(mockTestDb, {
      amount: 25000,
      bucketId: cash.id,
      date: day('04'),
      recurringId: rule.id,
    });
    const byHand = await addExpense(mockTestDb, {
      amount: 25000,
      bucketId: cash.id,
      date: day('04'),
    });

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`transaction-row-${byHand.id}`)).toBeTruthy());

    expect(screen.queryByTestId(`duplicate-marker-${posted.id}`)).toBeNull();
    expect(screen.queryByTestId(`duplicate-marker-${byHand.id}`)).toBeNull();
  });
});

describe('bucket filter from a home-screen card', () => {
  function chipSelected(testID: string): boolean {
    return Boolean(screen.getByTestId(testID).props.accessibilityState?.selected);
  }

  it('pre-selects the bucket the params name', async () => {
    const { cash, gcash } = await makeBuckets();
    mockParams = { bucketId: String(gcash.id), at: '1' };

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`filter-bucket-${gcash.id}`)).toBeTruthy());

    expect(chipSelected(`filter-bucket-${gcash.id}`)).toBe(true);
    expect(chipSelected(`filter-bucket-${cash.id}`)).toBe(false);
  });

  it('follows a press on a different card', async () => {
    const { cash, gcash } = await makeBuckets();
    mockParams = { bucketId: String(gcash.id), at: '1' };

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`filter-bucket-${gcash.id}`)).toBeTruthy());

    mockParams = { bucketId: String(cash.id), at: '2' };
    screen.rerender(<TransactionsScreen />);
    await waitFor(() => expect(chipSelected(`filter-bucket-${cash.id}`)).toBe(true));
    expect(chipSelected(`filter-bucket-${gcash.id}`)).toBe(false);
  });

  it('re-applies a second press on the SAME card', async () => {
    const { gcash } = await makeBuckets();
    mockParams = { bucketId: String(gcash.id), at: '1' };

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`filter-bucket-${gcash.id}`)).toBeTruthy());

    // User widens the filter by hand...
    fireEvent.press(screen.getByTestId('filter-bucket-all'));
    await waitFor(() => expect(chipSelected('filter-bucket-all')).toBe(true));

    // ...then taps the same card again. Only the nonce differs, and without it
    // this press would be indistinguishable from the one already applied.
    mockParams = { bucketId: String(gcash.id), at: '2' };
    screen.rerender(<TransactionsScreen />);
    await waitFor(() => expect(chipSelected(`filter-bucket-${gcash.id}`)).toBe(true));
  });

  it('keeps a hand-picked filter when the tab is revisited with stale params', async () => {
    const { cash, gcash } = await makeBuckets();
    mockParams = { bucketId: String(gcash.id), at: '1' };

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId(`filter-bucket-${gcash.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`filter-bucket-${cash.id}`));
    await waitFor(() => expect(chipSelected(`filter-bucket-${cash.id}`)).toBe(true));

    // Returning to the tab re-renders with the route's unchanged params; the
    // user's own choice must survive.
    screen.rerender(<TransactionsScreen />);
    await waitFor(() => expect(chipSelected(`filter-bucket-${cash.id}`)).toBe(true));
    expect(chipSelected(`filter-bucket-${gcash.id}`)).toBe(false);
  });
});
