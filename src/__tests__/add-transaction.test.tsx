import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buckets, categories, installments, recurring, transactions } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
import { runCatchUp } from '@/lib/recurringEngine';
// Import ordering is irrelevant to mocking: babel-plugin-jest-hoist lifts the
// jest.mock() calls below above all imports, so this screen's transitive
// imports of expo-router / DbProvider are already mocked when it loads.
import AddTransactionScreen from '@/app/add-transaction';

const mockRouterBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockRouterBack, push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

let mockTestDb: TestDb;
const mockRefresh = jest.fn();
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: mockRefresh, catchUp: null }),
}));

// Stands in for Android killing the app mid-save. The ledger move never
// returns — the save stops dead there, exactly as the process would. Nothing
// else is stubbed, so runCatchUp's real recovery still runs afterwards.
let mockLedgerDies = false;
jest.mock('@/db/installmentRepo', () => {
  const actual = jest.requireActual('@/db/installmentRepo');
  return {
    ...actual,
    recordLinkedInstallmentPayment: async (...args: unknown[]) => {
      if (mockLedgerDies) await new Promise(() => {});
      return actual.recordLinkedInstallmentPayment(...args);
    },
  };
});

beforeEach(() => {
  mockLedgerDies = false;
});

describe('add-transaction linked installment payment', () => {
  it('advances both the remaining balance and the months count', async () => {
    mockTestDb = createTestDb();
    const [b] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await mockTestDb.insert(categories).values({ name: 'Bills', type: 'expense' });
    const [plan] = await mockTestDb
      .insert(installments)
      .values({
        itemName: 'Phone',
        totalAmount: 600000,
        monthlyDue: 100000,
        monthsTotal: 6,
        dayDue: 15,
        bucketId: b.id,
        startDate: '2026-07-01',
      })
      .returning();

    await render(<AddTransactionScreen />);

    await waitFor(() => expect(screen.getByTestId(`installment-${plan.id}`)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    await fireEvent.press(screen.getByTestId(`installment-${plan.id}`));
    await fireEvent.press(screen.getByTestId('submit'));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());

    const [after] = await mockTestDb.select().from(installments);
    expect(after.amountPaid).toBe(100000);
    expect(after.monthsPaid).toBe(1);
    const txns = await mockTestDb.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].installmentId).toBe(plan.id);
  });

  it('logs the money before the ledger, so a crash leaves the plan behind and not ahead', async () => {
    mockTestDb = createTestDb();
    const [b] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await mockTestDb.insert(categories).values({ name: 'Bills', type: 'expense' });
    const [plan] = await mockTestDb
      .insert(installments)
      .values({
        itemName: 'Phone',
        totalAmount: 600000,
        monthlyDue: 100000,
        monthsTotal: 6,
        dayDue: 15,
        bucketId: b.id,
        startDate: '2026-07-01',
      })
      .returning();

    await render(<AddTransactionScreen />);
    await waitFor(() => expect(screen.getByTestId(`installment-${plan.id}`)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    await fireEvent.press(screen.getByTestId(`installment-${plan.id}`));

    mockLedgerDies = true;
    fireEvent.press(screen.getByTestId('submit')); // save() stops dead at the ledger

    // The expense is durable — the money is logged and the bucket balance moved.
    await waitFor(
      async () => expect(await mockTestDb.select().from(transactions)).toHaveLength(1),
      { timeout: 2000 },
    );
    const [txn] = await mockTestDb.select().from(transactions);
    expect(txn.installmentId).toBe(plan.id);
    // The plan is merely behind, which is recoverable. Phantom progress
    // (amountPaid moved with no expense behind it) never is.
    const [crashed] = await mockTestDb.select().from(installments);
    expect(crashed.amountPaid).toBe(0);

    // Next cold open reconciles it.
    mockLedgerDies = false;
    await runCatchUp(mockTestDb, '2026-07-16');
    const [healed] = await mockTestDb.select().from(installments);
    expect(healed.amountPaid).toBe(100000);
    expect(healed.monthsPaid).toBe(1);
    expect(await mockTestDb.select().from(transactions)).toHaveLength(1);
  });
});

describe('add-transaction linked recurring rule', () => {
  it('lets a manual expense stand in for that due, so catch-up posts nothing', async () => {
    mockTestDb = createTestDb();
    const [b] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
    await mockTestDb.insert(categories).values({ name: 'Bills', type: 'expense' });
    const [rule] = await mockTestDb
      .insert(recurring)
      .values({
        name: 'Rent',
        amount: 1200000,
        bucketId: b.id,
        frequency: 'monthly',
        dayDue: 15,
        startDate: '2026-07-01',
      })
      .returning();

    await render(<AddTransactionScreen />);

    // The user pays rent themselves, on the due date, for a different amount
    // than the rule says — the point of the link is that their number wins.
    await waitFor(() => expect(screen.getByTestId(`recurring-${rule.id}`)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('amount-input'), '11500');
    await fireEvent.changeText(screen.getByTestId('date-input'), '2026-07-15');
    await fireEvent.press(screen.getByTestId(`recurring-${rule.id}`));
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());

    const saved = await mockTestDb.select().from(transactions);
    expect(saved).toHaveLength(1);
    expect(saved[0].recurringId).toBe(rule.id);
    expect(saved[0].amount).toBe(1150000);

    // Catch-up sees the due already covered and leaves it alone — no duplicate,
    // and no ledger side-effect to undo, because a rule holds no balance.
    const { posted } = await runCatchUp(mockTestDb, '2026-07-31');
    expect(posted).toEqual([]);
    expect(await mockTestDb.select().from(transactions)).toHaveLength(1);

    // The next month is still owed, so the rule keeps running.
    await runCatchUp(mockTestDb, '2026-08-31');
    const after = await mockTestDb.select().from(transactions);
    expect(after.map((t) => t.date)).toEqual(['2026-07-15', '2026-08-15']);
  });
});
