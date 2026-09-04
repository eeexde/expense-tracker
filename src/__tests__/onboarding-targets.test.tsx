import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buckets } from '@/db/schema';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { createTestDb, TestDb } from '@/db/testDb';
import { ONBOARDING_COMPLETED_KEY } from '@/onboarding/tourSteps';
import HomeScreen from '@/app/(tabs)/index';
import SettingsScreen from '@/app/settings';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: jest.fn() }),
  usePathname: () => '/(tabs)',
  useLocalSearchParams: () => ({}),
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

beforeEach(() => {
  mockTestDb = createTestDb();
  mockPush.mockClear();
});

describe('tour targets on real screens', () => {
  // The guard that matters: every screen test in this repo renders bare, with
  // no TourProvider anywhere above it. TourTarget has to be inert there.
  it('home still renders with no provider in the tree', async () => {
    await mockTestDb.insert(buckets).values({ name: 'Cash' });

    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Total money')).toBeTruthy());
    expect(screen.getByLabelText('Add transaction')).toBeTruthy();
  });
});

describe('settings replay row', () => {
  it('clears the completed flag so the tour runs again', async () => {
    await setSetting(mockTestDb, ONBOARDING_COMPLETED_KEY, 'true');

    await render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByTestId('replay-walkthrough')).toBeTruthy());
    fireEvent.press(screen.getByTestId('replay-walkthrough'));

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBeNull(),
    );
  });
});
