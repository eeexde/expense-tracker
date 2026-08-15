import { act, fireEvent, render, RenderResult } from '@testing-library/react-native';
import {
  Dimensions,
  Keyboard,
  KeyboardEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  FormTextInput,
  isFieldObscured,
  KeyboardAwareForm,
  keyboardSlack,
  revealScrollDelta,
} from '@/components/form';

/**
 * `Keyboard` events come from native, so there is nothing to fire. Reaching for
 * the emitter the module is built on drives exactly the listeners the hooks
 * subscribe to. Both the `Will` and the `Did` variant go out so these hold
 * whichever pair the current `Platform.OS` selects.
 */
const keyboardEmitter = (
  Keyboard as unknown as { _emitter: { emit: (name: string, event?: KeyboardEvent) => void } }
)._emitter;

/** Dispatches the keyboard-up pair without an `act` of its own — see below. */
function emitShow(height: number) {
  const event: KeyboardEvent = {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { height, screenX: 0, screenY: 800 - height, width: 400 },
  };
  keyboardEmitter.emit('keyboardWillShow', event);
  keyboardEmitter.emit('keyboardDidShow', event);
}

function emitHide() {
  keyboardEmitter.emit('keyboardWillHide');
  keyboardEmitter.emit('keyboardDidHide');
}

/**
 * Calls the viewport's `onLayout` the way native does, rather than through
 * `fireEvent` — `fireEvent` opens an `act` of its own, and the point of several
 * of the tests below is to control whether a layout and a keyboard event land
 * in the same React batch.
 */
function emitLayout(view: RenderResult, height: number) {
  const onLayout = view.getByTestId('form-viewport').props.onLayout as (e: {
    nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
  }) => void;
  onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } });
}

async function showKeyboard(height: number) {
  await act(async () => emitShow(height));
}

async function hideKeyboard() {
  await act(async () => emitHide());
}

async function layoutViewport(view: RenderResult, height: number) {
  await act(async () => emitLayout(view, height));
}

interface JsonNode {
  props?: Record<string, unknown>;
  children?: (JsonNode | string)[];
}

function findNode(node: JsonNode | string | null, match: (n: JsonNode) => boolean): JsonNode | null {
  if (node == null || typeof node === 'string') return null;
  if (match(node)) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, match);
    if (hit) return hit;
  }
  return null;
}

/** The only host element in the tree carrying a `contentContainerStyle`. */
function contentPaddingBottom(view: RenderResult): number {
  const scrollView = findNode(view.toJSON(), (n) => n.props?.contentContainerStyle != null);
  return StyleSheet.flatten(scrollView!.props!.contentContainerStyle as never).paddingBottom;
}

const renderForm = () =>
  render(
    <KeyboardAwareForm>
      <Text>body</Text>
    </KeyboardAwareForm>,
  );

const realPlatform = Platform.OS;
function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

/**
 * `Keyboard` remembers the last event it saw (`isVisible`/`metrics`, which the
 * hook now seeds from) on the module singleton, so a test that leaves the
 * keyboard up would leak into the next one.
 */
/* --------------------------------------------------------------------------
 * Field reveal
 *
 * RN's jest preset assigns one shared `MockNativeMethods` object onto the
 * View/TextInput/ScrollView mock prototypes, so `measureInWindow` is a single
 * no-op `jest.fn()` behind every node — and the reveal's two nested measure
 * callbacks therefore never run unless a test stubs it. Everything below
 * `reveal()`'s two `measureInWindow` calls was untested until this stub existed.
 * ------------------------------------------------------------------------ */

type Measurable = { prototype: { measureInWindow: jest.Mock } };
const measureInWindow = (View as unknown as Measurable).prototype.measureInWindow;
const scrollTo = (ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype
  .scrollTo;

/** Window-coordinate boxes (`x, y, width, height`) keyed by the node's testID. */
function stubGeometry(boxes: Record<string, [number, number, number, number]>) {
  measureInWindow.mockImplementation(function (
    this: { props?: { testID?: string } },
    callback: (x: number, y: number, width: number, height: number) => void,
  ) {
    const box = boxes[this?.props?.testID ?? ''];
    if (box) callback(...box);
  });
}

afterEach(async () => {
  await hideKeyboard();
  setPlatform(realPlatform);
  // Shared across every mocked native component in this module registry.
  measureInWindow.mockReset();
  scrollTo.mockReset();
});

describe('keyboardSlack', () => {
  it('asks for the whole keyboard when nothing resized the viewport', () => {
    // Android under edge-to-edge: the window is never resized, so the
    // scrollable has to absorb the lot.
    expect(keyboardSlack(300, 800, 800)).toBe(300);
  });

  it('asks for nothing when the viewport already lost the full keyboard', () => {
    // Either the window resized or the KeyboardAvoidingView padded it. Adding
    // more on top would double-count.
    expect(keyboardSlack(300, 800, 500)).toBe(0);
  });

  it('asks only for the part the viewport did not lose', () => {
    expect(keyboardSlack(300, 800, 700)).toBe(200);
  });

  it('never goes negative when the viewport shrank by more than the keyboard', () => {
    expect(keyboardSlack(300, 800, 400)).toBe(0);
  });

  it('is zero while the keyboard is down', () => {
    expect(keyboardSlack(0, 800, 800)).toBe(0);
  });

  it('ignores a viewport that grew past its baseline', () => {
    expect(keyboardSlack(300, 600, 800)).toBe(300);
  });
});

describe('revealScrollDelta', () => {
  it('leaves a field that already clears the keyboard alone', () => {
    expect(revealScrollDelta({ fieldBottom: 300, viewportBottom: 800, slack: 300, margin: 16 })).toBe(
      0,
    );
  });

  it('scrolls a field that sits under the keyboard', () => {
    // Keyboard top is 800 - 300 = 500. The field's bottom is at 560 and wants
    // 16 of clearance, so 76 has to be scrolled away.
    expect(revealScrollDelta({ fieldBottom: 560, viewportBottom: 800, slack: 300, margin: 16 })).toBe(
      76,
    );
  });

  it('still clears the viewport bottom with no keyboard up', () => {
    expect(revealScrollDelta({ fieldBottom: 820, viewportBottom: 800, slack: 0, margin: 16 })).toBe(
      36,
    );
  });

  it('treats the viewport bottom as the limit once the keyboard is fully absorbed', () => {
    // slack 0 means something already lifted the viewport clear of the IME, so
    // a field inside the viewport needs no scrolling.
    expect(revealScrollDelta({ fieldBottom: 700, viewportBottom: 800, slack: 0, margin: 16 })).toBe(
      0,
    );
  });
});

describe('isFieldObscured', () => {
  // Keyboard top is 800 - 300 = 500.
  it('is true for a field the keyboard cuts across', () => {
    expect(
      isFieldObscured({ fieldTop: 460, fieldBottom: 520, viewportBottom: 800, slack: 300, margin: 16 }),
    ).toBe(true);
  });

  it('is true for a field sitting just above the keyboard, inside the margin', () => {
    expect(
      isFieldObscured({ fieldTop: 430, fieldBottom: 490, viewportBottom: 800, slack: 300, margin: 16 }),
    ).toBe(true);
  });

  it('is false for a field that already clears the keyboard', () => {
    expect(
      isFieldObscured({ fieldTop: 300, fieldBottom: 360, viewportBottom: 800, slack: 300, margin: 16 }),
    ).toBe(false);
  });

  it('is false for a field scrolled entirely below the keyboard line', () => {
    // The user dragged the form up to look at the chips; the focused field went
    // with it. An IME height change must not drag it back.
    expect(
      isFieldObscured({ fieldTop: 640, fieldBottom: 700, viewportBottom: 800, slack: 300, margin: 16 }),
    ).toBe(false);
  });

  it('measures against the viewport bottom once the window itself resized', () => {
    // slack 0: the keyboard line is the viewport's own bottom edge.
    expect(
      isFieldObscured({ fieldTop: 460, fieldBottom: 520, viewportBottom: 500, slack: 0, margin: 16 }),
    ).toBe(true);
    expect(
      isFieldObscured({ fieldTop: 560, fieldBottom: 620, viewportBottom: 500, slack: 0, margin: 16 }),
    ).toBe(false);
  });
});

describe('KeyboardAwareForm', () => {
  it('lets the KeyboardAvoidingView compensate on every platform', async () => {
    const view = await renderForm();
    // `behavior={undefined}` drops KeyboardAvoidingView into its `default:`
    // case, which renders a bare `<View style={style}>` and compensates for
    // nothing. `behavior="padding"` is the branch that composes a
    // `paddingBottom` onto that style — so its presence is the assertion.
    const avoidingView = view.getByTestId('form-viewport').parent!;
    expect(StyleSheet.flatten(avoidingView.props.style)).toHaveProperty('paddingBottom');
  });

  it('pads the content by the measured keyboard height, not a constant', async () => {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);

    await layoutViewport(view, 800);
    await showKeyboard(312);

    expect(contentPaddingBottom(view)).toBe(resting + 312);
  });

  it('drops the padding again once the keyboard goes away', async () => {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);

    await layoutViewport(view, 800);
    await showKeyboard(312);
    await hideKeyboard();

    expect(contentPaddingBottom(view)).toBe(resting);
  });

  it('adds nothing when the viewport already shrank by the keyboard height', async () => {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);

    await layoutViewport(view, 800);
    await showKeyboard(312);
    // A window resize (or the KeyboardAvoidingView) took the room off already.
    await layoutViewport(view, 488);

    expect(contentPaddingBottom(view)).toBe(resting);
  });

  it('adds only the shortfall when the viewport shrank by less than the keyboard', async () => {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);

    await layoutViewport(view, 800);
    await showKeyboard(312);
    await layoutViewport(view, 600);

    expect(contentPaddingBottom(view)).toBe(resting + 112);
  });
});

/**
 * The premise the lift was built on — "Android never resizes the window, so the
 * whole keyboard has to be absorbed here" — only holds where edge-to-edge is
 * on, i.e. device SDK 35+. Below that the dialog goes through
 * `disableEdgeToEdge()`, `SOFT_INPUT_ADJUST_RESIZE` applies, the viewport
 * shrinks by the keyboard height, and the correct extra slack is 0.
 *
 * Which of the two events reaches JS first — the keyboard event or the
 * `onLayout` carrying the resize it caused — is not guaranteed, and neither is
 * whether they land in the same React batch. Every ordering has to arrive at
 * the same answer, because a poisoned baseline does not heal: padding a flex:1
 * anchor does not re-fire its own `onLayout`.
 */
describe('KeyboardAwareForm on a device that resizes the window', () => {
  const KEYBOARD = 300;
  const FULL = 800;
  const SHRUNK = FULL - KEYBOARD;

  /** Extra room the form asked for on top of its resting padding. */
  async function slackAfter(order: (view: RenderResult) => Promise<void>) {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);
    await layoutViewport(view, FULL);
    await order(view);
    return contentPaddingBottom(view) - resting;
  }

  it('adds nothing when the resize is reported after the keyboard event', async () => {
    // The control: this ordering was already correct.
    const slack = await slackAfter(async (view) => {
      await showKeyboard(KEYBOARD);
      await layoutViewport(view, SHRUNK);
    });
    expect(slack).toBe(0);
  });

  it('adds nothing when the resize lands in the same batch as the keyboard event', async () => {
    const slack = await slackAfter(async (view) => {
      await act(async () => {
        emitShow(KEYBOARD);
        emitLayout(view, SHRUNK);
      });
    });
    expect(slack).toBe(0);
  });

  it('adds nothing when the resize is dispatched before the keyboard event', async () => {
    const slack = await slackAfter(async (view) => {
      await act(async () => {
        emitLayout(view, SHRUNK);
        emitShow(KEYBOARD);
      });
    });
    expect(slack).toBe(0);
  });

  it('stays right when the resized viewport lays out a second time', async () => {
    // A re-layout at the already-shrunk height must not be mistaken for a new
    // baseline — that is the "does not recover" half of the bug.
    const slack = await slackAfter(async (view) => {
      await act(async () => {
        emitLayout(view, SHRUNK);
        emitShow(KEYBOARD);
      });
      await layoutViewport(view, SHRUNK);
    });
    expect(slack).toBe(0);
  });

  it('re-baselines from the restored viewport once the keyboard goes away', async () => {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);
    await layoutViewport(view, FULL);
    await showKeyboard(KEYBOARD);
    await layoutViewport(view, SHRUNK);
    await hideKeyboard();
    await layoutViewport(view, FULL);
    // And a second keyboard, on a screen that this time does not resize.
    await showKeyboard(KEYBOARD);

    expect(contentPaddingBottom(view) - resting).toBe(KEYBOARD);
  });

  it('picks up a keyboard that was already up before the form mounted', async () => {
    // Android emits `keyboardDidShow` only when the height changes, and tracks
    // that per ReactRootView rather than per subscriber, so mounting under a
    // steady IME delivers no event at all.
    // Resting padding has to be read from a form that mounted with nothing up —
    // the whole point is that this one asks for slack before its first layout.
    const resting = contentPaddingBottom(await renderForm());

    await showKeyboard(KEYBOARD);
    const view = await renderForm();

    await layoutViewport(view, FULL);
    expect(contentPaddingBottom(view) - resting).toBe(KEYBOARD);

    // The first layout it ever saw was taken with the keyboard up, so the
    // baseline is a high-water mark rather than that first reading.
    await layoutViewport(view, SHRUNK);
    expect(contentPaddingBottom(view) - resting).toBe(0);
  });
});

/**
 * iOS subscribes the `Will` pair, but the seed a form mounting under an
 * already-up keyboard depends on — `Keyboard.isVisible()` / `Keyboard.metrics()`
 * — reads `_currentlyShowing`, which RN writes *only* from the `Did` pair
 * (Keyboard.js: the `KeyboardImpl` constructor subscribes `keyboardDidShow` and
 * `keyboardDidHide`, nothing else assigns it). So for the ~250ms of the iOS
 * dismissal animation the module still reports a full-height visible keyboard.
 *
 * The `emitShow`/`emitHide` helpers above fire `Will` and `Did` together, which
 * is precisely the state that never happens on device — so this one drives the
 * emitter directly.
 */
describe('KeyboardAwareForm mounting mid-dismissal on iOS', () => {
  it('lets go of a keyboard that had already started leaving', async () => {
    setPlatform('ios');
    const resting = contentPaddingBottom(await renderForm());

    await showKeyboard(312);
    // The `Will` half only: the keyboard is animating out and RN's record of it
    // has not been cleared yet.
    await act(async () => keyboardEmitter.emit('keyboardWillHide'));
    expect(Keyboard.isVisible()).toBe(true);

    // Navigating to a modal form inside that window — reachable any time an
    // input is focused when the navigation starts — seeds the leaving keyboard.
    const view = await renderForm();
    await layoutViewport(view, 800);
    expect(contentPaddingBottom(view) - resting).toBe(312);

    // `willHide` has been and gone, so `didHide` is the only event left that
    // can clear it. Without the iOS backstop this form keeps a keyboard-sized
    // dead gap under its submit button until a full focus/blur cycle.
    await act(async () => keyboardEmitter.emit('keyboardDidHide'));
    expect(contentPaddingBottom(view)).toBe(resting);
  });
});

/**
 * `orientation: "portrait"` in app.json rules rotation out on a normal window,
 * but Android ignores `screenOrientation` in multi-window — and a divider drag
 * shrinks the window for real, mid-typing, with the keyboard still up. The
 * high-water baseline only re-takes its mark while the keyboard is *down*, so
 * on its own it rejects that shrink for as long as the IME stays visible.
 */
describe('KeyboardAwareForm in a window that shrinks while the keyboard is up', () => {
  const original = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  afterEach(() => {
    Dimensions.set(original);
  });

  it('re-baselines on a window-metrics change instead of rejecting the shrink', async () => {
    const view = await renderForm();
    const resting = contentPaddingBottom(view);
    await layoutViewport(view, 800);
    await showKeyboard(300);
    expect(contentPaddingBottom(view) - resting).toBe(300);

    // The divider takes 300dp off the window. `Dimensions` is the one signal
    // that says the shrink did not come from the IME — RN derives it from the
    // activity's window bounds, which an `adjustResize` keyboard never moves.
    await act(async () => {
      Dimensions.set({
        window: { width: 400, height: 500, scale: 2, fontScale: 1 },
        screen: { width: 400, height: 800, scale: 2, fontScale: 1 },
      });
    });
    await layoutViewport(view, 500);

    // The high-water mark alone keeps the baseline at 800 forever, and
    // 300 - (800 - 500) clamps to 0: under edge-to-edge the lower fields and
    // the submit button then sit under the IME with no way to scroll to them,
    // and it does not heal until the keyboard is dismissed.
    expect(contentPaddingBottom(view) - resting).toBe(300);
  });
});

describe('FormTextInput', () => {
  it('renders a plain TextInput, props and all', async () => {
    const view = await render(
      <KeyboardAwareForm>
        <FormTextInput testID="field" placeholder="Note" />
      </KeyboardAwareForm>,
    );
    expect(view.getByPlaceholderText('Note')).toBeTruthy();
  });

  it('still runs a caller-supplied onFocus', async () => {
    const onFocus = jest.fn();
    const view = await render(
      <KeyboardAwareForm>
        <FormTextInput testID="field" onFocus={onFocus} />
      </KeyboardAwareForm>,
    );

    await fireEvent(view.getByTestId('field'), 'focus');

    expect(onFocus).toHaveBeenCalled();
  });

  /**
   * `FormTextInput` only does anything when a `RevealFieldProvider` is above it
   * — `KeyboardAwareForm` mounts one, a bare `ScrollView` does not. Both halves
   * are asserted here, because "the field is a `FormTextInput`" is exactly the
   * thing that looked like the wiring and wasn't on the sheets.
   */
  it('scrolls a focused field out from under the keyboard', async () => {
    stubGeometry({
      'form-viewport': [0, 0, 400, 800],
      field: [0, 700, 400, 48],
    });
    const view = await render(
      <KeyboardAwareForm>
        <FormTextInput testID="field" />
      </KeyboardAwareForm>,
    );
    await layoutViewport(view, 800);
    await showKeyboard(300);

    await fireEvent(view.getByTestId('field'), 'focus');

    // Keyboard top is 800 - 300 = 500; the field's bottom is 748 and wants 16
    // of clearance.
    expect(scrollTo).toHaveBeenCalledWith({ y: 264, animated: true });
  });

  it('does nothing for a field outside any reveal provider', async () => {
    stubGeometry({
      'form-viewport': [0, 0, 400, 800],
      field: [0, 700, 400, 48],
    });
    const view = await render(
      <ScrollView>
        <FormTextInput testID="field" />
      </ScrollView>,
    );
    await showKeyboard(300);

    await fireEvent(view.getByTestId('field'), 'focus');

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
