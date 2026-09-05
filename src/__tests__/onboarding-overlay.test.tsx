import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React, { useEffect } from 'react';
import { BackHandler, Dimensions, StyleSheet, Text } from 'react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { TourOverlay } from '@/onboarding/TourOverlay';
import { TourProvider, useTour } from '@/onboarding/TourProvider';
import { Rect, TourStep } from '@/onboarding/tourSteps';

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
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

/** Registers a fixed rect for a step's `targetId` as soon as it mounts, so a
 * test can put a spotlight hole at a known location without a real target
 * component. */
function Probe({ id, rect }: { id: string; rect: Rect }) {
  const tour = useTour();
  useEffect(() => {
    tour.registerTarget(id, rect);
    return () => tour.unregisterTarget(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rect.x, rect.y, rect.width, rect.height]);
  return null;
}

/**
 * Walks an SVG path `d` string built from absolute M/H/V/A/Z commands (as
 * produced by `maskPath` in TourOverlay.tsx) and returns the bounding box of
 * every coordinate it visits. Used to check the hole's geometry without
 * hardcoding the rounded-corner path construction itself.
 */
function bboxOfPathCommands(d: string) {
  const tokens = d.trim().split(/\s+/);
  const xs: number[] = [];
  const ys: number[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const cmd = token[0];
    if (cmd === 'M') {
      xs.push(Number(token.slice(1)));
      ys.push(Number(tokens[i + 1]));
      i += 2;
    } else if (cmd === 'H') {
      xs.push(Number(token.slice(1)));
      i += 1;
    } else if (cmd === 'V') {
      ys.push(Number(token.slice(1)));
      i += 1;
    } else if (cmd === 'A') {
      xs.push(Number(tokens[i + 5]));
      ys.push(Number(tokens[i + 6]));
      i += 7;
    } else {
      i += 1; // 'Z'
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
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

  it('clamps the centered fallback card to the top margin on a short viewport', async () => {
    const original = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
    // Short enough that an unclamped centered card (height/2 - 190/2) goes
    // negative: 100/2 - 95 = -45.
    Dimensions.set({
      window: { ...original.window, height: 100 },
      screen: { ...original.screen, height: 100 },
    });
    try {
      await renderOverlay();
      await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));

      const cardStyle = screen.getByTestId('tour-title').parent?.props.style;
      const flat = Array.isArray(cardStyle) ? Object.assign({}, ...cardStyle) : cardStyle;
      expect(flat.top).toBe(16);
    } finally {
      Dimensions.set(original);
    }
  });

  it('renders a spotlight hole around the registered target, punched out with evenodd', async () => {
    const targetRect: Rect = { x: 40, y: 100, width: 120, height: 60 };
    await render(
      <TourProvider steps={[{ ...STEPS[0], targetId: 'probe.target' }]}>
        <Probe id="probe.target" rect={targetRect} />
        <TourOverlay />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    // The card carries `accessibilityViewIsModal`, which makes RNTL treat its
    // siblings (the SVG layer) as hidden from accessibility queries by
    // default — hence `includeHiddenElements` below.
    expect(screen.queryByTestId('tour-dim', { includeHiddenElements: true })).toBeNull();

    const path = screen.getByTestId('tour-spotlight', { includeHiddenElements: true });
    // react-native-svg's extractProps maps the `fillRule="evenodd"` JSX prop
    // to the native constant 0 (`nonzero` would be 1) before it reaches the
    // host RNSVGPath node, so that is what's observable here.
    expect(path.props.fillRule).toBe(0);

    const { width, height } = Dimensions.get('window');
    const [outer, inner] = path.props.d.split(/(?=M)/).filter(Boolean);
    expect(outer.trim()).toBe(`M0 0H${width}V${height}H0Z`);

    // SPOTLIGHT_PAD (8) grows the 120x60 target into a 136x76 hole starting
    // at (32, 92): (40-8, 100-8) to (40+120+8, 100+60+8).
    const bbox = bboxOfPathCommands(inner);
    expect(bbox).toEqual({ minX: 32, maxX: 168, minY: 92, maxY: 168 });
  });

  it('shows the plain dim layer, not a spotlight, when no target is registered', async () => {
    await renderOverlay();
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));

    expect(screen.getByTestId('tour-dim', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('tour-spotlight', { includeHiddenElements: true })).toBeNull();
  });

  describe('android hardware back', () => {
    it('closes the tour on step one and reports the press handled', async () => {
      const remove = jest.fn();
      const addSpy = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove });
      try {
        await renderOverlay();
        await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));

        expect(addSpy).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
        const handler = addSpy.mock.calls[addSpy.mock.calls.length - 1][1];

        let handled: unknown;
        await act(() => {
          handled = handler();
        });

        expect(handled).toBe(true);
        await waitFor(() => expect(screen.queryByTestId('tour-overlay')).toBeNull());
        expect(remove).toHaveBeenCalled();
      } finally {
        addSpy.mockRestore();
      }
    });

    it('moves back one step on a later step and reports the press handled', async () => {
      const remove = jest.fn();
      const addSpy = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove });
      try {
        await renderOverlay();
        await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
        await fireEvent.press(screen.getByTestId('tour-next'));
        await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('Second thing'));

        const handler = addSpy.mock.calls[addSpy.mock.calls.length - 1][1];
        let handled: unknown;
        await act(() => {
          handled = handler();
        });

        expect(handled).toBe(true);
        await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
      } finally {
        addSpy.mockRestore();
      }
    });

    it('removes the subscription when the overlay unmounts', async () => {
      const remove = jest.fn();
      const addSpy = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove });
      try {
        const view = await renderOverlay();
        await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));

        // `unmount` is async in RNTL 14 (it wraps the teardown in `act`), so
        // it must be awaited before the cleanup effect is guaranteed to run.
        await view.unmount();
        expect(remove).toHaveBeenCalled();
      } finally {
        addSpy.mockRestore();
      }
    });
  });

  it('sits above app content as a full-bleed touch-swallowing layer without blocking its own controls', async () => {
    const underneathPress = jest.fn();
    await render(
      <TourProvider steps={STEPS}>
        <Text testID="underneath" onPress={underneathPress}>
          Underneath
        </Text>
        <TourOverlay />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));

    // React Native paints later siblings over earlier ones, and the overlay
    // is mounted after "underneath" here, so its swallow layer is the
    // topmost thing on screen. RNTL's fireEvent targets elements directly
    // rather than hit-testing screen coordinates, so it cannot demonstrate
    // "a tap at (x, y) lands on the overlay instead of the app below" — we
    // assert the structural properties that make that true instead: the
    // overlay's first child is a full-bleed layer that claims every touch
    // that starts on it (per TourOverlay.tsx's own JSX order), and its SVG
    // layer is explicitly non-interactive so it never steals presses from
    // the card's own buttons. `overlay.children` here are the resolved host
    // nodes, not the Pressable/Svg composites, so `onPress` isn't present on
    // them. `pointerEvents` must not be 'none' (that would let touches fall
    // straight through to the app below), and `onStartShouldSetResponder` is
    // the host-level prop Pressable wires up to grab the responder for every
    // touch that starts on it.
    const overlay = screen.getByTestId('tour-overlay');
    const [swallow, svg] = overlay.children as unknown as [
      { type: unknown; props: Record<string, unknown> },
      { type: unknown; props: Record<string, unknown> },
    ];
    expect(swallow.props.style).toBe(StyleSheet.absoluteFill);
    expect(swallow.props.pointerEvents).not.toBe('none');
    expect((swallow.props.onStartShouldSetResponder as () => boolean)?.()).toBe(true);

    expect(svg.props.pointerEvents).toBe('none');

    // The overlay's own buttons still fire through that same layer.
    await fireEvent.press(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('Second thing'));
  });
});
