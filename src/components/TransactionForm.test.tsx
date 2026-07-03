import { fireEvent, render, screen } from '@testing-library/react-native';
import { TransactionForm } from './TransactionForm';
import { Bucket, Category } from '@/db/schema';

const buckets: Bucket[] = [
  { id: 1, name: 'Cash', icon: '💵', color: '#2E7D32', startingBalance: 0, archived: false },
  { id: 2, name: 'GCash', icon: '📱', color: '#0057E7', startingBalance: 0, archived: false },
];

const categories: Category[] = [
  { id: 10, name: 'Groceries', icon: '🛒', type: 'expense' },
  { id: 11, name: 'Freelance', icon: '💼', type: 'income' },
];

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
});
