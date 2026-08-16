import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Bucket, Category } from '@/db/schema';
import { BucketForm } from '@/components/BucketForm';
import { InstallmentForm } from '@/components/InstallmentForm';
import { RecurringForm } from '@/components/RecurringForm';
import { UtangForm } from '@/components/UtangForm';

/**
 * Validation and error-reporting for the four shared add/edit forms.
 *
 * Every invalid field has to say *what* is wrong in text, not only in border
 * colour: colour-alone signalling fails WCAG and tells a screen-reader user
 * nothing at all. The `accessibilityHint` assertions cover the case where the
 * message is not the next thing in the reading order.
 */

const AMOUNT_ERROR = 'Invalid amount — use numbers like 1200.50.';
const DAY_ERROR = 'Day must be a whole number from 1 to 31.';
const MONTHS_ERROR = 'Months must be a whole number from 1 to 60.';
const BALANCE_ERROR = 'Invalid balance — use numbers like 1200.50, or -1200.50 for money owed.';
const COLOR_ERROR = 'Invalid color — use a 6-digit hex like #2E7D32.';

const bucket: Bucket = {
  id: 1,
  name: 'Cash',
  icon: 'wallet',
  color: '#2E7D32',
  type: 'bucket',
  startingBalance: 0,
  archived: false,
};

const category: Category = { id: 1, name: 'Bills', icon: 'tag', type: 'expense', archived: false };

describe('BucketForm zero starting balance', () => {
  // ₱0 is the schema default for buckets.starting_balance, so a bucket created
  // without an explicit balance prefills "0.00" here. Parsing that as an
  // *amount* (which rejects zero) made `valid` false from the first render and
  // permanently disabled Save — the bucket could never be renamed, recoloured
  // or re-iconed again, with no workaround anywhere in the UI.
  it('keeps Save enabled when editing a bucket whose balance is zero', async () => {
    const onSubmit = jest.fn();
    await render(
      <BucketForm
        initial={{ name: 'Wallet', icon: 'wallet', type: 'bucket', startingBalance: 0 }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId('submit')).toBeEnabled();
    expect(screen.queryByText(BALANCE_ERROR)).toBeNull();

    await fireEvent.changeText(screen.getByTestId('bucket-name'), 'Wallet renamed');
    await fireEvent.press(screen.getByTestId('submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet renamed', startingBalance: 0 }),
    );
  });

  it('accepts a balance typed back down to zero', async () => {
    const onSubmit = jest.fn();
    await render(
      <BucketForm
        initial={{ name: 'Wallet', icon: 'wallet', type: 'bucket', startingBalance: 50000 }}
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.changeText(screen.getByTestId('bucket-balance'), '0');
    expect(screen.queryByText(BALANCE_ERROR)).toBeNull();
    await fireEvent.press(screen.getByTestId('submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startingBalance: 0 }));
  });

  it('still records a negative credit-card balance, and never -0', async () => {
    const onSubmit = jest.fn();
    await render(<BucketForm initial={{ name: 'BPI', type: 'credit' }} onSubmit={onSubmit} />);

    await fireEvent.changeText(screen.getByTestId('bucket-balance'), '-1200.50');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startingBalance: -120050 }));

    onSubmit.mockClear();
    await fireEvent.changeText(screen.getByTestId('bucket-balance'), '-0.00');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(Object.is(onSubmit.mock.calls[0][0].startingBalance, 0)).toBe(true);
  });
});

describe('BucketForm error messages', () => {
  it('explains an unparseable balance in text and to a screen reader', async () => {
    await render(<BucketForm onSubmit={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('bucket-balance'), 'abc');

    expect(screen.getByText(BALANCE_ERROR)).toBeTruthy();
    expect(screen.getByTestId('bucket-balance').props.accessibilityHint).toBe(BALANCE_ERROR);
    expect(screen.getByTestId('submit')).toBeDisabled();
  });

  it('explains an unparseable colour', async () => {
    await render(<BucketForm onSubmit={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('bucket-color'), '#zzz');

    expect(screen.getByText(COLOR_ERROR)).toBeTruthy();
    expect(screen.getByTestId('bucket-color').props.accessibilityHint).toBe(COLOR_ERROR);
  });

  it('labels both fields for a screen reader', async () => {
    await render(<BucketForm onSubmit={jest.fn()} />);
    expect(screen.getByLabelText('Starting balance')).toBeTruthy();
    expect(screen.getByLabelText('Color (optional, hex)')).toBeTruthy();
  });
});

describe('UtangForm amount errors', () => {
  it('explains an unparseable amount in text and to a screen reader', async () => {
    await render(<UtangForm onSubmit={jest.fn()} />);
    const amount = screen.getByLabelText('Amount');
    await fireEvent.changeText(amount, 'abc');

    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();
    expect(amount.props.accessibilityHint).toBe(AMOUNT_ERROR);
  });

  it('keeps the existing below-paid message, and hints it too', async () => {
    await render(
      <UtangForm
        initial={{ personName: 'Juan', direction: 'iOwe', originalAmount: 50000 }}
        paid={20000}
        onSubmit={jest.fn()}
      />,
    );
    const amount = screen.getByLabelText('Amount');
    await fireEvent.changeText(amount, '100');

    expect(screen.getByText('Amount is below the ₱200.00 already paid.')).toBeTruthy();
    expect(amount.props.accessibilityHint).toBe('Amount is below the ₱200.00 already paid.');
  });
});

describe('InstallmentForm errors', () => {
  it('explains every invalid numeric field in text', async () => {
    await render(<InstallmentForm buckets={[bucket]} onSubmit={jest.fn()} />);

    await fireEvent.changeText(screen.getByLabelText('Monthly payment'), 'abc');
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Number of months'), '99');
    expect(screen.getByText(MONTHS_ERROR)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Day of month (1 to 31)'), '45');
    expect(screen.getByText(DAY_ERROR)).toBeTruthy();
  });

  it('hints the error on the field itself', async () => {
    await render(<InstallmentForm buckets={[bucket]} onSubmit={jest.fn()} />);
    const months = screen.getByLabelText('Number of months');
    await fireEvent.changeText(months, '0');
    expect(months.props.accessibilityHint).toBe(MONTHS_ERROR);
  });

  it('says nothing while the defaults are valid', async () => {
    await render(<InstallmentForm buckets={[bucket]} onSubmit={jest.fn()} />);
    expect(screen.queryByText(DAY_ERROR)).toBeNull();
    expect(screen.queryByText(AMOUNT_ERROR)).toBeNull();
    expect(screen.queryByText(MONTHS_ERROR)).toBeNull();
  });
});

describe('RecurringForm errors', () => {
  it('explains an invalid amount and day in text', async () => {
    await render(<RecurringForm buckets={[bucket]} categories={[category]} onSubmit={jest.fn()} />);

    await fireEvent.changeText(screen.getByLabelText('Amount'), '1.234');
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Day of month (1 to 31)'), '32');
    expect(screen.getByText(DAY_ERROR)).toBeTruthy();
  });

  it('hints the error on the field itself', async () => {
    await render(<RecurringForm buckets={[bucket]} categories={[category]} onSubmit={jest.fn()} />);
    const amount = screen.getByLabelText('Amount');
    await fireEvent.changeText(amount, 'abc');
    expect(amount.props.accessibilityHint).toBe(AMOUNT_ERROR);
  });

  it('says nothing while the defaults are valid', async () => {
    await render(<RecurringForm buckets={[bucket]} categories={[category]} onSubmit={jest.fn()} />);
    expect(screen.queryByText(DAY_ERROR)).toBeNull();
    expect(screen.queryByText(AMOUNT_ERROR)).toBeNull();
  });
});
