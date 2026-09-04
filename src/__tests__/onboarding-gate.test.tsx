import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { TourProvider, useTour } from '@/onboarding/TourProvider';
import { ONBOARDING_COMPLETED_KEY, TourStep } from '@/onboarding/tourSteps';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/(tabs)',
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

const STEPS: TourStep[] = [
  { id: 'one', tab: '/(tabs)', title: 'One', body: 'First step.' },
  { id: 'two', tab: '/(tabs)', title: 'Two', body: 'Second step.' },
];

/** Minimal consumer: shows the current step and exposes the controls. */
function Probe() {
  const tour = useTour();
  return (
    <>
      <Text testID="state">{tour.active ? (tour.step?.id ?? 'none') : 'inactive'}</Text>
      <Text testID="next" onPress={tour.next}>
        next
      </Text>
      <Text testID="skip" onPress={tour.skip}>
        skip
      </Text>
      <Text testID="start" onPress={tour.start}>
        start
      </Text>
    </>
  );
}

beforeEach(() => {
  mockTestDb = createTestDb();
  mockNavigate.mockClear();
});

describe('onboarding first-run gate', () => {
  it('starts itself when the completed flag is absent', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
  });

  it('stays closed when the flag is already set', async () => {
    await setSetting(mockTestDb, ONBOARDING_COMPLETED_KEY, 'true');

    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    // Give the gate's read a chance to resolve before asserting the negative.
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('inactive'));
    expect(screen.getByTestId('state')).toHaveTextContent('inactive');
  });

  it('writes the flag when the last step is finished', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
    await fireEvent.press(screen.getByTestId('next'));
    await fireEvent.press(screen.getByTestId('next'));

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBe('true'),
    );
    expect(screen.getByTestId('state')).toHaveTextContent('inactive');
  });

  it('writes the flag when skipped', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
    await fireEvent.press(screen.getByTestId('skip'));

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBe('true'),
    );
  });

  it('replays on demand after completion', async () => {
    await setSetting(mockTestDb, ONBOARDING_COMPLETED_KEY, 'true');

    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('inactive'));
    await fireEvent.press(screen.getByTestId('start'));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
  });
});
