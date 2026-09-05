import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { TourProvider, useTour } from '@/onboarding/TourProvider';
import { TourStep } from '@/onboarding/tourSteps';
import { TourTarget } from '@/onboarding/TourTarget';

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

/**
 * `TourTarget` is only ever exercised on this branch through a `Probe` that
 * calls `registerTarget` directly, bypassing the component entirely — a
 * broken `id`, a dropped `register` call, or a `width === 0 && height === 0`
 * guard that always trips would still pass every other onboarding suite.
 * These tests drive it as its real consumers do: `measureInWindow` on the
 * `View` it wraps, the way `auto-log.test.tsx` and
 * `keyboard-aware-form.test.tsx` stub the same shared prototype mock.
 */
type Measurable = { prototype: { measureInWindow: jest.Mock } };
const measureInWindow = (View as unknown as Measurable).prototype.measureInWindow;

beforeEach(() => {
  mockTestDb = createTestDb();
});

afterEach(() => {
  measureInWindow.mockReset();
});

const STEPS: TourStep[] = [
  { id: 'one', tab: '/(tabs)', targetId: 'probe.thing', title: 'One', body: 'Body.' },
];

/** Surfaces the provider's current measured rect for the active step. */
function RectProbe() {
  const tour = useTour();
  return <Text testID="rect">{tour.rect ? JSON.stringify(tour.rect) : 'null'}</Text>;
}

describe('TourTarget', () => {
  it('registers the measured rect under its own id while a tour is active', async () => {
    measureInWindow.mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(10, 20, 30, 40),
    );

    await render(
      <TourProvider steps={STEPS}>
        <TourTarget id="probe.thing">
          <Text>Target</Text>
        </TourTarget>
        <RectProbe />
      </TourProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('rect')).toHaveTextContent(
        JSON.stringify({ x: 10, y: 20, width: 30, height: 40 }),
      ),
    );
  });

  // Load-bearing: every screen test in this repo renders its screen bare,
  // with no `TourProvider` anywhere above it. A `TourTarget` that measured
  // regardless would pay a real `measureInWindow` cost on every such screen
  // for nothing.
  it('renders children and never measures when there is no provider above it', async () => {
    measureInWindow.mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(1, 2, 3, 4),
    );

    await render(
      <TourTarget id="anything">
        <Text>Bare child</Text>
      </TourTarget>,
    );

    expect(screen.getByText('Bare child')).toBeTruthy();

    // A device fires the wrapper `View`'s own `onLayout` on mount regardless
    // of whether a tour is running — the guard that matters lives inside the
    // callback itself, so the test has to actually fire that event rather
    // than rely on it never happening under RNTL's renderer. The wrapper is
    // the child's direct host-node parent (there is no testID to query by:
    // `TourTarget` carries none, deliberately, since it is not meant to be a
    // test seam).
    const wrapper = screen.getByText('Bare child').parent;
    await act(async () => {
      fireEvent(wrapper, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 5, height: 5 } } });
    });

    expect(measureInWindow).not.toHaveBeenCalled();
  });

  it('unregisters on unmount', async () => {
    measureInWindow.mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(1, 2, 3, 4),
    );

    const view = await render(
      <TourProvider steps={STEPS}>
        <TourTarget id="probe.thing">
          <Text>Target</Text>
        </TourTarget>
        <RectProbe />
      </TourProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('rect')).toHaveTextContent(
        JSON.stringify({ x: 1, y: 2, width: 3, height: 4 }),
      ),
    );

    // Re-render the same provider tree without the target — its unmount
    // cleanup is what has to clear the rect it registered.
    await act(async () => {
      view.rerender(
        <TourProvider steps={STEPS}>
          <RectProbe />
        </TourProvider>,
      );
    });

    await waitFor(() => expect(screen.getByTestId('rect')).toHaveTextContent('null'));
  });
});
