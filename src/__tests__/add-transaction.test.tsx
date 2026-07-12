import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buckets, categories, installments, transactions } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';

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

import AddTransactionScreen from '@/app/add-transaction';

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
});
