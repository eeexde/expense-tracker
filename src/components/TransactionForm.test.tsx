import { fireEvent, render, screen } from '@testing-library/react-native';
import { TransactionForm } from './TransactionForm';
import { Bucket, Category, Recurring } from '@/db/schema';

const buckets: Bucket[] = [
  { id: 1, name: 'Cash', icon: 'cash', color: '#2E7D32', type: 'bucket', startingBalance: 0, archived: false },
  { id: 2, name: 'GCash', icon: 'phone', color: '#0057E7', type: 'bucket', startingBalance: 0, archived: false },
];

const categories: Category[] = [
  { id: 10, name: 'Groceries', icon: 'cart', type: 'expense' },
  { id: 11, name: 'Freelance', icon: 'laptop', type: 'income' },
];

const plan = {
  id: 7,
  itemName: 'Phone',
  totalAmount: 600000,
  monthlyDue: 100000,
  monthsTotal: 6,
  monthsPaid: 0,
  amountPaid: 0,
  dayDue: 10,
  bucketId: 1,
  startDate: '2026-01-01',
  remaining: 600000,
};

// Due on the 15th of every month, from before any date these tests use.
const rent: Recurring = {
  id: 3,
  name: 'Rent',
  amount: 1200000,
  categoryId: null,
  bucketId: 1,
  frequency: 'monthly',
  dayDue: 15,
  startDate: '2026-01-01',
  endDate: null,
  active: true,
  lastPostedDate: null,
};

describe('TransactionForm', () => {
  it('submits an expense with amount in centavos', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={onSubmit} />,
    );

    await fireEvent.changeText(screen.getByTestId('amount-input'), '150.50');
    await fireEvent.press(screen.getByTestId('category-10'));
    await fireEvent.press(screen.getByTestId('submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'expense',
        amount: 15050,
        bucketId: 1,
        categoryId: 10,
      }),
    );
  });

  it('does not submit while amount is invalid', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={onSubmit} />,
    );

    await fireEvent.changeText(screen.getByTestId('amount-input'), 'abc');
    await fireEvent.press(screen.getByTestId('submit'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows income categories when switched to income', async () => {
    await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={jest.fn()} />,
    );

    expect(screen.queryByTestId('category-11')).toBeNull();
    await fireEvent.press(screen.getByTestId('kind-income'));
    expect(screen.getByTestId('category-11')).toBeTruthy();
    expect(screen.queryByTestId('category-10')).toBeNull();
  });

  it('links an expense to an installment and blocks overpayment', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        openInstallments={[plan]}
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(screen.getByTestId('installment-7'));

    // More than the remaining balance can't submit.
    await fireEvent.changeText(screen.getByTestId('amount-input'), '7000');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    // Advance payment worth 2 months goes through with the link attached.
    await fireEvent.changeText(screen.getByTestId('amount-input'), '2000');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'expense', amount: 200000, installmentId: 7 }),
    );
  });

  it('requires a destination bucket for transfers', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={onSubmit} />,
    );

    await fireEvent.press(screen.getByTestId('kind-transfer'));
    await fireEvent.changeText(screen.getByTestId('amount-input'), '500');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('to-bucket-2'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transfer', amount: 50000, bucketId: 1, toBucketId: 2 }),
    );
  });

  it('hides the recurring section when no rules are passed', async () => {
    await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={jest.fn()} />,
    );
    expect(screen.queryByTestId('recurring-3')).toBeNull();
  });

  it('offers recurring rules on expenses only', async () => {
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        activeRecurring={[rent]}
        onSubmit={jest.fn()}
      />,
    );
    expect(screen.getByTestId('recurring-3')).toBeTruthy();

    // Recurring rules post as expenses, so income/transfer have nothing to cover.
    await fireEvent.press(screen.getByTestId('kind-income'));
    expect(screen.queryByTestId('recurring-3')).toBeNull();
    await fireEvent.press(screen.getByTestId('kind-transfer'));
    expect(screen.queryByTestId('recurring-3')).toBeNull();
  });

  it('passes the covered recurring rule to onSubmit, and deselects on re-tap', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        activeRecurring={[rent]}
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.changeText(screen.getByTestId('amount-input'), '12000');
    await fireEvent.press(screen.getByTestId('recurring-3'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'expense', amount: 1200000, recurringId: 3 }),
    );

    onSubmit.mockClear();
    await fireEvent.press(screen.getByTestId('recurring-3'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ recurringId: undefined }),
    );
  });

  it('keeps the three links mutually exclusive in both directions', async () => {
    const onSubmit = jest.fn();
    const debt = {
      id: 5,
      personName: 'Ana',
      direction: 'iOwe' as const,
      originalAmount: 500000,
      note: null,
      createdAt: '2026-01-01',
      remaining: 500000,
    };
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        openUtang={[debt]}
        openInstallments={[plan]}
        activeRecurring={[rent]}
        onSubmit={onSubmit}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('amount-input'), '1000');

    // installment -> recurring drops the installment
    await fireEvent.press(screen.getByTestId('installment-7'));
    await fireEvent.press(screen.getByTestId('recurring-3'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ recurringId: 3, installmentId: undefined, utangId: undefined }),
    );

    // recurring -> installment drops the recurring
    await fireEvent.press(screen.getByTestId('installment-7'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ installmentId: 7, recurringId: undefined }),
    );

    // recurring -> utang drops the recurring
    await fireEvent.press(screen.getByTestId('recurring-3'));
    await fireEvent.press(screen.getByTestId('utang-5'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ utangId: 5, recurringId: undefined }),
    );

    // utang -> recurring drops the utang
    await fireEvent.press(screen.getByTestId('recurring-3'));
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ recurringId: 3, utangId: undefined }),
    );
  });

  it('says whether the date actually replaces the scheduled posting', async () => {
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        activeRecurring={[rent]}
        onSubmit={jest.fn()}
      />,
    );

    await fireEvent.changeText(screen.getByTestId('amount-input'), '12000');
    await fireEvent.changeText(screen.getByTestId('date-input'), '2026-07-15');
    await fireEvent.press(screen.getByTestId('recurring-3'));
    expect(screen.getByText(/scheduled posting for this date will be skipped/i)).toBeTruthy();

    // Off-schedule is legal, just informational — and never blocks submit.
    await fireEvent.changeText(screen.getByTestId('date-input'), '2026-07-16');
    expect(screen.getByText(/isn't one of this rule's due dates/i)).toBeTruthy();
    expect(screen.getByTestId('submit').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('accepts a future date', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={onSubmit} />,
    );

    await fireEvent.changeText(screen.getByTestId('amount-input'), '150');
    await fireEvent.changeText(screen.getByTestId('date-input'), '2099-12-31');
    await fireEvent.press(screen.getByTestId('submit'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ date: '2099-12-31' }));
  });

  it('offers the fee field on transfers only, and only when the screen asks', async () => {
    const { rerender } = await render(
      <TransactionForm buckets={buckets} categories={categories} onSubmit={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('kind-transfer'));
    expect(screen.queryByTestId('fee-input')).toBeNull();

    await rerender(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        offerTransferFee
        onSubmit={jest.fn()}
      />,
    );
    expect(screen.getByTestId('fee-input')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('kind-expense'));
    expect(screen.queryByTestId('fee-input')).toBeNull();
  });

  it('sends a percentage fee in centavos, leaving the transfer amount whole', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        offerTransferFee
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(screen.getByTestId('kind-transfer'));
    await fireEvent.press(screen.getByTestId('to-bucket-2'));
    await fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    await fireEvent.changeText(screen.getByTestId('fee-input'), '2.5');
    await fireEvent.press(screen.getByTestId('submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transfer', amount: 100000, feeAmount: 2500 }),
    );
  });

  it('sends a fixed fee as typed', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        offerTransferFee
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(screen.getByTestId('kind-transfer'));
    await fireEvent.press(screen.getByTestId('to-bucket-2'));
    await fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    await fireEvent.press(screen.getByTestId('segment-fixed'));
    await fireEvent.changeText(screen.getByTestId('fee-input'), '15.50');
    await fireEvent.press(screen.getByTestId('submit'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ feeAmount: 1550 }));
  });

  it('sends no fee for an empty or zero field, and blocks an unparseable one', async () => {
    const onSubmit = jest.fn();
    await render(
      <TransactionForm
        buckets={buckets}
        categories={categories}
        offerTransferFee
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(screen.getByTestId('kind-transfer'));
    await fireEvent.press(screen.getByTestId('to-bucket-2'));
    await fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ feeAmount: undefined }),
    );

    await fireEvent.changeText(screen.getByTestId('fee-input'), '0');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ feeAmount: undefined }),
    );

    onSubmit.mockClear();
    await fireEvent.changeText(screen.getByTestId('fee-input'), '150');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid percentage/i)).toBeTruthy();
  });
});

