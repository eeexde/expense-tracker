import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LicenseGate } from '@/components/LicenseGate';

let mockStored: string | null = null;
jest.mock('@/lib/license', () => ({
  loadLicense: jest.fn(async () => mockStored),
  saveLicense: jest.fn(async (s: string) => {
    mockStored = s;
  }),
  verifyLicense: jest.fn((s: string) =>
    s === 'kur-good' ? { ok: true, buyerId: 'b@x.com' } : { ok: false, reason: 'That key is not valid' },
  ),
}));

const Child = () => <Text>UNLOCKED APP</Text>;

describe('LicenseGate', () => {
  beforeEach(() => {
    mockStored = null;
    jest.clearAllMocks();
  });

  it('shows the lock screen when no license is stored', async () => {
    await render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => expect(screen.getByTestId('license-input')).toBeTruthy());
    expect(screen.queryByText('UNLOCKED APP')).toBeNull();
  });

  it('renders children when a valid license is already stored', async () => {
    mockStored = 'kur-good';
    await render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => expect(screen.getByText('UNLOCKED APP')).toBeTruthy());
  });

  it('unlocks after pasting a valid key', async () => {
    await render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => screen.getByTestId('license-input'));
    await fireEvent.changeText(screen.getByTestId('license-input'), 'kur-good');
    await fireEvent.press(screen.getByTestId('license-unlock'));
    await waitFor(() => expect(screen.getByText('UNLOCKED APP')).toBeTruthy());
  });

  it('shows an error and stays locked on an invalid key', async () => {
    await render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => screen.getByTestId('license-input'));
    await fireEvent.changeText(screen.getByTestId('license-input'), 'kur-bad');
    await fireEvent.press(screen.getByTestId('license-unlock'));
    await waitFor(() => expect(screen.getByText('That key is not valid')).toBeTruthy());
    expect(screen.queryByText('UNLOCKED APP')).toBeNull();
  });
});
