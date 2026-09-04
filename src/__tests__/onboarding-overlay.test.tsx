import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { TourOverlay } from '@/onboarding/TourOverlay';
import { TourProvider } from '@/onboarding/TourProvider';
import { TourStep } from '@/onboarding/tourSteps';

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/(tabs)',
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

const STEPS: TourStep[] = [
  { id: 'one', tab: '/(tabs)', title: 'First thing', body: 'Body one.' },
  { id: 'two', tab: '/(tabs)', title: 'Second thing', body: 'Body two.' },
  { id: 'three', tab: '/(tabs)', title: 'Third thing', body: 'Body three.' },
];

function renderOverlay() {
  return render(
    <TourProvider steps={STEPS}>
      <TourOverlay />
    </TourProvider>,
  );
}

beforeEach(() => {
  mockTestDb = createTestDb();
});

describe('tour overlay', () => {
  it('shows the first step with a step counter', async () => {
    await renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    expect(screen.getByTestId('tour-body')).toHaveTextContent('Body one.');
    expect(screen.getByTestId('tour-counter')).toHaveTextContent('1 of 3');
  });

  it('advances and returns', async () => {
    await renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    await fireEvent.press(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('Second thing'));
    expect(screen.getByTestId('tour-counter')).toHaveTextContent('2 of 3');

    await fireEvent.press(screen.getByTestId('tour-back'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
  });

  it('hides Back on the first step and labels the last Next as Done', async () => {
    await renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    expect(screen.queryByTestId('tour-back')).toBeNull();

    await fireEvent.press(screen.getByTestId('tour-next'));
    await fireEvent.press(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('Third thing'));
    expect(screen.getByTestId('tour-next')).toHaveTextContent('Done');
  });

  it('closes on skip', async () => {
    await renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-overlay')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tour-skip'));

    await waitFor(() => expect(screen.queryByTestId('tour-overlay')).toBeNull());
  });

  it('closes after the last step', async () => {
    await renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-overlay')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('tour-next'));
    await fireEvent.press(screen.getByTestId('tour-next'));
    await fireEvent.press(screen.getByTestId('tour-next'));

    await waitFor(() => expect(screen.queryByTestId('tour-overlay')).toBeNull());
  });

  it('renders nothing without a provider', async () => {
    await render(<TourOverlay />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('falls back to a centered card when the target never measures', async () => {
    jest.useFakeTimers();
    try {
      await render(
        <TourProvider steps={[{ ...STEPS[0], targetId: 'nobody.registers.this' }]}>
          <TourOverlay />
        </TourProvider>,
      );

      // Before the timeout there is a dim layer but no spotlight and no card.
      await waitFor(() => expect(screen.getByTestId('tour-overlay')).toBeTruthy());
      expect(screen.queryByTestId('tour-title')).toBeNull();

      await act(() => {
        jest.advanceTimersByTime(700);
      });

      await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
      expect(screen.queryByTestId('tour-spotlight')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
