import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { asc, eq } from 'drizzle-orm';
import { transferFeeCategoryId } from '@/db/categoryRepo';
import { addExpense, addTransfer, bucketBalance } from '@/db/repo';
import { buckets, categories, transactions } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these
// imports, so the screen's transitive expo-router / DbProvider imports are
// already mocked when it loads.
import EditTransactionScreen from '@/app/edit-transaction';

let mockTestDb: TestDb;
let mockParams: { id?: string } = {};
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

// Same cold-cache story as jest.setup.ui.js's raised timeout: the first render
// in this file transforms the react-native graph inside the test body, which
// on a cold cache outruns waitFor's own 1000ms default (which `testTimeout`
// does not raise) and fails with "render function has not been called".
configure({ asyncUtilTimeout: 10000 });

beforeEach(() => {
  mockTestDb = createTestDb();
  mockParams = {};
  mockBack.mockClear();
});

/**
 * A ₱1,000 Cash → GCash transfer, optionally with a fee.
 *
 * `link` is what tells the two histories apart: 'linked' is a fee written by
 * today's add screen, 'legacy' one written before `feeForTransactionId`
 * existed — same row, NULL where the link would be.
 */
async function seedTransfer(options: { fee?: number; link?: 'linked' | 'legacy' } = {}) {
  const [cash] = await mockTestDb
    .insert(buckets)
    .values({ name: 'Cash', startingBalance: 1000000 })
    .returning();
  const [gcash] = await mockTestDb
    .insert(buckets)
    .values({ name: 'GCash', startingBalance: 0 })
    .returning();
  const transfer = await addTransfer(mockTestDb, {
    amount: 100000,
    bucketId: cash.id,
    toBucketId: gcash.id,
    date: '2026-07-04',
  });
  let fee;
  if (options.fee !== undefined) {
    const categoryId = await transferFeeCategoryId(mockTestDb);
    fee = await addExpense(mockTestDb, {
      amount: options.fee,
      bucketId: cash.id,
      date: '2026-07-04',
      categoryId,
      note: 'Transfer fee',
      feeForTransactionId: options.link === 'legacy' ? undefined : transfer.id,
    });
  }
  mockParams = { id: String(transfer.id) };
  return { cash, gcash, transfer, fee };
}

/** Waits past the first paint, when the transaction/fee queries are still out. */
async function openScreen() {
  await render(<EditTransactionScreen />);
  await waitFor(() => expect(screen.getByTestId('amount-input')).toBeTruthy());
}

async function saveChanges() {
  await fireEvent.press(screen.getByTestId('submit'));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
}

/** Rows in write order, so [transfer, fee]. */
function allTransactions() {
  return mockTestDb.select().from(transactions).orderBy(asc(transactions.id));
}

describe('editing a transfer that carries a fee', () => {
  it('prefills the fee as the percentage it was charged at', async () => {
    await seedTransfer({ fee: 1500, link: 'linked' }); // ₱15 on ₱1,000 = 1.5%
    await openScreen();
    expect(screen.getByTestId('fee-input').props.value).toBe('1.5');
  });

  it('recomputes the fee when the amount changes', async () => {
    const { cash, gcash, fee } = await seedTransfer({ fee: 1500, link: 'linked' });
    await openScreen();

    // ₱1,000 → ₱2,000 at the same 1.5%: the fee has to follow, or it stays
    // describing a transfer that no longer exists.
    await fireEvent.changeText(screen.getByTestId('amount-input'), '2000');
    await saveChanges();

    const [transfer, feeRow] = await allTransactions();
    expect(transfer.amount).toBe(200000);
    expect(feeRow.id).toBe(fee!.id); // updated in place, not re-created
    expect(feeRow.amount).toBe(3000);
    expect(await allTransactions()).toHaveLength(2);

    // ₱10,000 − ₱2,000 sent − ₱30 fee, and the destination still gets it all.
    expect(await bucketBalance(mockTestDb, cash.id)).toBe(797000);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(200000);
  });

  it('moves the fee to the new sending bucket', async () => {
    const { cash, gcash, fee } = await seedTransfer({ fee: 1500, link: 'linked' });
    const [wallet] = await mockTestDb
      .insert(buckets)
      .values({ name: 'Wallet', startingBalance: 500000 })
      .returning();
    await openScreen();

    await fireEvent.press(screen.getByTestId(`bucket-${wallet.id}`));
    await saveChanges();

    const [transfer, feeRow] = await allTransactions();
    expect(transfer.bucketId).toBe(wallet.id);
    // The charge follows the sender, or bucketBalance keeps docking the old one.
    expect(feeRow.id).toBe(fee!.id);
    expect(feeRow.bucketId).toBe(wallet.id);

    expect(await bucketBalance(mockTestDb, cash.id)).toBe(1000000); // untouched again
    expect(await bucketBalance(mockTestDb, wallet.id)).toBe(398500);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(100000);
  });

  it('deletes the fee row when the fee is cleared', async () => {
    const { cash, gcash } = await seedTransfer({ fee: 1500, link: 'linked' });
    await openScreen();

    await fireEvent.changeText(screen.getByTestId('fee-input'), '');
    await saveChanges();

    const left = await allTransactions();
    expect(left).toHaveLength(1);
    expect(left[0].type).toBe('transfer');
    expect(await bucketBalance(mockTestDb, cash.id)).toBe(900000);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(100000);
  });

  it('adds a fee to a transfer that was saved without one', async () => {
    const { cash, gcash, transfer } = await seedTransfer();
    await openScreen();

    await fireEvent.changeText(screen.getByTestId('fee-input'), '2');
    await saveChanges();

    const [, feeRow] = await allTransactions();
    expect(feeRow.type).toBe('expense');
    expect(feeRow.amount).toBe(2000);
    expect(feeRow.bucketId).toBe(cash.id);
    expect(feeRow.feeForTransactionId).toBe(transfer.id);
    const [category] = await mockTestDb
      .select()
      .from(categories)
      .where(eq(categories.id, feeRow.categoryId!));
    expect(category.name).toBe('Transfer Fee');

    expect(await bucketBalance(mockTestDb, cash.id)).toBe(898000);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(100000);
  });

  it('leaves everything alone when the form is saved untouched', async () => {
    const { cash, gcash, fee } = await seedTransfer({ fee: 1500, link: 'linked' });
    await openScreen();
    await saveChanges();

    const [transfer, feeRow] = await allTransactions();
    expect(transfer.amount).toBe(100000);
    expect(feeRow.id).toBe(fee!.id);
    expect(feeRow.amount).toBe(1500);
    expect(await bucketBalance(mockTestDb, cash.id)).toBe(898500);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(100000);
  });

  it('puts a fee no percentage reproduces back as a fixed amount, unchanged', async () => {
    // ₱18.51 on ₱1,000 is 1.851% exactly, so pick one that is not: the seed
    // below charges ₱18.51 on ₱1,002.98.
    const [cash] = await mockTestDb
      .insert(buckets)
      .values({ name: 'Cash', startingBalance: 1000000 })
      .returning();
    const [gcash] = await mockTestDb.insert(buckets).values({ name: 'GCash' }).returning();
    const transfer = await addTransfer(mockTestDb, {
      amount: 100298,
      bucketId: cash.id,
      toBucketId: gcash.id,
      date: '2026-07-04',
    });
    const categoryId = await transferFeeCategoryId(mockTestDb);
    await addExpense(mockTestDb, {
      amount: 1851,
      bucketId: cash.id,
      date: '2026-07-04',
      categoryId,
      note: 'Transfer fee',
      feeForTransactionId: transfer.id,
    });
    mockParams = { id: String(transfer.id) };

    await openScreen();
    expect(screen.getByTestId('fee-input').props.value).toBe('18.51');

    // Saving untouched must re-charge the same centavos, not a rounded percent.
    await saveChanges();
    const [, feeRow] = await allTransactions();
    expect(feeRow.amount).toBe(1851);
  });
});

describe('deleting a transfer that carries a fee', () => {
  it('takes the linked fee with it and restores both balances', async () => {
    const { cash, gcash } = await seedTransfer({ fee: 1500, link: 'linked' });
    await openScreen();

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(screen.getByText('Delete this transaction'));
    const [, message, actions] = alert.mock.calls[0] as unknown as [
      string,
      string | undefined,
      { text: string; onPress?: () => Promise<void> }[],
    ];
    // The second row vanishing from the list is announced, not silent.
    expect(message).toMatch(/transfer fee is deleted with it/i);
    await actions.find((a) => a.text === 'Delete')!.onPress!();
    alert.mockRestore();

    expect(await allTransactions()).toHaveLength(0);
    expect(await bucketBalance(mockTestDb, cash.id)).toBe(1000000);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(0);
  });
});

describe('a fee from before the link column existed', () => {
  it('is left untouched by an edit, and is never adopted or deleted', async () => {
    const { cash, gcash, fee } = await seedTransfer({ fee: 1500, link: 'legacy' });
    await openScreen();

    // The screen says so rather than pretending the fee field is the whole story.
    expect(screen.getByTestId('legacy-fee-notice')).toBeTruthy();
    // And it does not pretend to own it: the field comes up empty.
    expect(screen.getByTestId('fee-input').props.value).toBe('');

    await fireEvent.changeText(screen.getByTestId('amount-input'), '2000');
    await saveChanges();

    const [transfer, feeRow] = await allTransactions();
    expect(transfer.amount).toBe(200000);
    // Untouched: same id, same amount, still unlinked.
    expect(feeRow.id).toBe(fee!.id);
    expect(feeRow.amount).toBe(1500);
    expect(feeRow.feeForTransactionId).toBeNull();

    expect(await bucketBalance(mockTestDb, cash.id)).toBe(798500);
    expect(await bucketBalance(mockTestDb, gcash.id)).toBe(200000);
  });

  it('survives deleting the transfer, as an ordinary standalone expense', async () => {
    const { cash, fee } = await seedTransfer({ fee: 1500, link: 'legacy' });
    await openScreen();

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(screen.getByText('Delete this transaction'));
    const [, message, actions] = alert.mock.calls[0] as unknown as [
      string,
      string | undefined,
      { text: string; onPress?: () => Promise<void> }[],
    ];
    // Nothing is promised about a fee this screen does not own.
    expect(message).toBeUndefined();
    await actions.find((a) => a.text === 'Delete')!.onPress!();
    alert.mockRestore();

    const left = await allTransactions();
    expect(left.map((t) => t.id)).toEqual([fee!.id]);
    expect(await bucketBalance(mockTestDb, cash.id)).toBe(998500);
  });

  it('never shows the notice for an unrelated transfer on another day', async () => {
    const { cash, gcash } = await seedTransfer({ fee: 1500, link: 'legacy' });
    const other = await addTransfer(mockTestDb, {
      amount: 50000,
      bucketId: cash.id,
      toBucketId: gcash.id,
      date: '2026-07-09',
    });
    mockParams = { id: String(other.id) };

    await openScreen();
    expect(screen.queryByTestId('legacy-fee-notice')).toBeNull();
  });
});

describe('the fee field on non-transfers', () => {
  it('is not offered while editing an expense', async () => {
    const [cash] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    const spend = await addExpense(mockTestDb, {
      amount: 5000,
      bucketId: cash.id,
      date: '2026-07-04',
    });
    mockParams = { id: String(spend.id) };

    await openScreen();
    expect(screen.queryByTestId('fee-input')).toBeNull();
  });
});
