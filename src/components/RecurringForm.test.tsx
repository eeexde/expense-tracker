import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecurringForm } from './RecurringForm';
import { Bucket, Category } from '@/db/schema';

const bucket = (id: number, name: string): Bucket => ({
  id,
  name,
  icon: 'cash',
  color: '#2E7D32',
  type: 'bucket',
  startingBalance: 0,
  archived: false,
});

const buckets: Bucket[] = [bucket(1, 'Cash'), bucket(2, 'GCash'), bucket(3, 'Maya')];
const categories: Category[] = [];

const base = {
  name: 'Rent',
  amount: 500000,
  frequency: 'monthly' as const,
  dayDue: 1,
  bucketId: 1,
  fallbackBucketIds: [] as number[],
};

/** The chips are rendered twice — as the primary row, then as the "add" row. */
const addFallback = async (name: string) => {
  const chips = screen.getAllByText(name);
  await fireEvent.press(chips[chips.length - 1]);
};

describe('RecurringForm bucket chain', () => {
  it('submits with no fallbacks when none were added', async () => {
    const onSubmit = jest.fn();
    await render(<RecurringForm buckets={buckets} categories={categories} initial={base} onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText('Save'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fallbackBucketIds: [] }));
  });

  it('appends fallbacks in the order they were picked', async () => {
    const onSubmit = jest.fn();
    await render(<RecurringForm buckets={buckets} categories={categories} initial={base} onSubmit={onSubmit} />);

    await addFallback('Maya');
    await addFallback('GCash');
    await fireEvent.press(screen.getByText('Save'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fallbackBucketIds: [3, 2] }));
  });

  it('reorders a fallback and drops one that is removed', async () => {
    const onSubmit = jest.fn();
    await render(
      <RecurringForm
        buckets={buckets}
        categories={categories}
        initial={{ ...base, fallbackBucketIds: [2, 3] }}
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Move Maya earlier'));
    await fireEvent.press(screen.getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fallbackBucketIds: [3, 2] }));

    await fireEvent.press(screen.getByLabelText('Remove Maya from the chain'));
    await fireEvent.press(screen.getByText('Save'));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ fallbackBucketIds: [2] }));
  });

  /** A bucket sits in the chain once — promoting it must not leave a duplicate. */
  it('drops a fallback that is promoted to primary', async () => {
    const onSubmit = jest.fn();
    await render(
      <RecurringForm
        buckets={buckets}
        categories={categories}
        initial={{ ...base, fallbackBucketIds: [2, 3] }}
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(screen.getAllByText('GCash')[0]); // the primary chip row
    await fireEvent.press(screen.getByText('Save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ bucketId: 2, fallbackBucketIds: [3] }),
    );
  });
});
