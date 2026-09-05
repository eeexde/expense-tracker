import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { TourProvider, useTour } from '@/onboarding/TourProvider';
import { ONBOARDING_COMPLETED_KEY, TourStep } from '@/onboarding/tourSteps';

const mockNavigate = jest.fn();
// Mutable so individual tests can put `usePathname()` at whatever the "current
// tab" is meant to be, rather than being stuck with the module's fixed value.
let mockPathname = '/';
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPathname,
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
      <Text testID="rect">{tour.rect ? JSON.stringify(tour.rect) : 'null'}</Text>
      <Text testID="next" onPress={tour.next}>
        next
      </Text>
      <Text testID="skip" onPress={tour.skip}>
        skip
      </Text>
      <Text testID="start" onPress={tour.start}>
        start
      </Text>
      <Text testID="register" onPress={() => tour.registerTarget('thing', { x: 1, y: 2, width: 3, height: 4 })}>
        register
      </Text>
    </>
  );
}

beforeEach(() => {
  mockTestDb = createTestDb();
  mockNavigate.mockClear();
  mockPathname = '/';
});

/**
 * Taps without `fireEvent`, which awaits an `act` scope of its own — nesting
 * that inside an outer `act` leaves both scopes open at once, which is what
 * React means by "overlapping act() calls". Calling `onPress` straight off
 * the `Text` instance's props lands two presses in one tick the way a real
 * same-tick double tap does. Mirrors `pressInTick` in
 * `src/__tests__/auto-log.test.tsx` (that one reads `onClick` because it
 * targets a `Pressable`'s host node; a bare `Text` exposes `onPress` itself).
 */
function pressInTick(testID: string) {
  const press = screen.getByTestId(testID).props.onPress as (() => void) | undefined;
  if (!press) throw new Error(`no onPress on ${testID}`);
  press();
}

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

  it('writes the flag when two next() calls land in the same tick', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));

    // One act scope, so both taps land before React re-renders in response to
    // the first — a genuine same-tick double-tap on the last step, not two
    // sequential awaited presses.
    await act(async () => {
      pressInTick('next');
      pressInTick('next');
    });

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBe('true'),
    );
    expect(screen.getByTestId('state')).toHaveTextContent('inactive');
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

describe('navigation guard', () => {
  // usePathname() strips group segments, so it never equals a group-qualified
  // href like '/(tabs)/transactions' even when that tab is already on screen.
  // The guard has to compare through TAB_PATHNAMES instead of comparing
  // pathname directly against step.tab — otherwise router.navigate fires on
  // every render, for every step, forever.
  it('does not navigate when the current pathname already matches the step, even across a re-render', async () => {
    mockPathname = '/'; // what usePathname() returns while on '/(tabs)'
    const steps: TourStep[] = [{ id: 'home', tab: '/(tabs)', title: 'Home', body: 'Body.' }];

    const view = await render(
      <TourProvider steps={steps}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('home'));
    expect(mockNavigate).not.toHaveBeenCalled();

    // Force a re-render of the same tree — the buggy guard
    // (`pathname !== step.tab`) is never true here since pathname ('/') can
    // never equal the group-qualified href ('/(tabs)'), so it re-navigates on
    // every single render.
    view.rerender(
      <TourProvider steps={steps}>
        <Probe />
      </TourProvider>,
    );

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the group-qualified href, exactly once, when the step is on a different tab', async () => {
    mockPathname = '/'; // current tab is '/(tabs)'; the step below wants transactions
    const steps: TourStep[] = [
      { id: 'transactions', tab: '/(tabs)/transactions', title: 'Transactions', body: 'Body.' },
    ];

    const view = await render(
      <TourProvider steps={steps}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('transactions'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    // Must be the group-qualified href router.navigate needs, not the
    // stripped form usePathname() returns — a "fix" that passed
    // TAB_PATHNAMES[step.tab] (or pathname itself) to navigate would still
    // satisfy the guard but send the router the wrong string.
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/transactions');

    view.rerender(
      <TourProvider steps={steps}>
        <Probe />
      </TourProvider>,
    );

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('target registry reset on replay', () => {
  it('clears previously registered rects when the tour goes inactive, so a replay does not reuse stale ones', async () => {
    const steps: TourStep[] = [
      { id: 'one', tab: '/(tabs)', targetId: 'thing', title: 'One', body: 'Body.' },
    ];

    render(
      <TourProvider steps={steps}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
    expect(screen.getByTestId('rect')).toHaveTextContent('null');

    await fireEvent.press(screen.getByTestId('register'));
    await waitFor(() =>
      expect(screen.getByTestId('rect')).toHaveTextContent(
        JSON.stringify({ x: 1, y: 2, width: 3, height: 4 }),
      ),
    );

    // End the run without unregistering — the same thing a real target does
    // when its screen unmounts on the way to a different tab, which does not
    // always happen before the tour itself goes inactive.
    await fireEvent.press(screen.getByTestId('skip'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('inactive'));

    await fireEvent.press(screen.getByTestId('start'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));

    // The replay's first render must not show the previous run's stale rect
    // before the (possibly slower, possibly on a different tab) real target
    // has had a chance to register itself again.
    expect(screen.getByTestId('rect')).toHaveTextContent('null');
  });
});
