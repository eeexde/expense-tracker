import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  Alert,
  Keyboard,
  KeyboardEvent,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  buckets,
  notificationSources,
  pendingNotifications,
  transactions,
} from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these
// imports, so the screen's transitive expo-router / DbProvider imports are
// already mocked when it loads.
import NotificationInboxScreen from '@/app/notification-inbox';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

let mockTestDb: TestDb;
const mockRefresh = jest.fn();
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: mockRefresh, catchUp: null }),
}));

/** See keyboard-aware-form.test.tsx — native events, so drive the emitter. */
const keyboardEmitter = (
  Keyboard as unknown as { _emitter: { emit: (name: string, event?: KeyboardEvent) => void } }
)._emitter;

async function showKeyboard(height: number) {
  const event: KeyboardEvent = {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { height, screenX: 0, screenY: 800 - height, width: 400 },
  };
  await act(async () => {
    keyboardEmitter.emit('keyboardWillShow', event);
    keyboardEmitter.emit('keyboardDidShow', event);
  });
}

async function layoutAnchor(height: number) {
  await fireEvent(screen.getByTestId('edit-sheet-anchor'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
  });
}

function anchorPaddingBottom(): number {
  return StyleSheet.flatten(screen.getByTestId('edit-sheet-anchor').props.style).paddingBottom;
}

/* --------------------------------------------------------------------------
 * Field reveal
 *
 * RN's jest preset assigns one shared `MockNativeMethods` object onto the
 * View/TextInput/ScrollView mock prototypes, so `measureInWindow` is a single
 * no-op `jest.fn()` behind every node — which means the reveal's two nested
 * measure callbacks never run and the whole path is invisible to a test that
 * does not stub it. Same story for `scrollTo`, which is what makes it an
 * assertable outcome here.
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

/** Seeds one pending row with its bucket + source and returns that row's id. */
async function seedPending(): Promise<number> {
  const [bucket] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
  const [source] = await mockTestDb
    .insert(notificationSources)
    .values({ bucketId: bucket.id, packageName: 'com.bank.app' })
    .returning();
  const [row] = await mockTestDb
    .insert(pendingNotifications)
    .values({
      sourceId: source.id,
      rawText: 'Php150.00 spent at JOLLIBEE',
      parsedAmount: 15000,
      parsedMerchant: 'Jollibee',
      parsedType: 'expense',
      notifKey: 'notif-1',
      postedAt: new Date().toISOString(),
    })
    .returning();
  return row.id;
}

/** Opens the edit sheet on a seeded pending row and returns that row's id. */
async function openEditSheet(): Promise<number> {
  const id = await seedPending();
  await render(<NotificationInboxScreen />);
  await waitFor(() => expect(screen.getByTestId(`edit-${id}`)).toBeTruthy());
  await fireEvent.press(screen.getByTestId(`edit-${id}`));
  return id;
}

const realPlatform = Platform.OS;
function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

// Real by default; one test below holds the commit open to keep a save in
// flight across a render, which is the only way to observe the sheet's own
// dismissal guards.
const mockCommitPending = jest.fn();
jest.mock('../db/notificationRepo', () => ({
  ...jest.requireActual('../db/notificationRepo'),
  commitPending: (...args: unknown[]) => mockCommitPending(...args),
}));
const realNotificationRepo =
  jest.requireActual<typeof import('../db/notificationRepo')>('../db/notificationRepo');

beforeEach(() => {
  mockTestDb = createTestDb();
  mockCommitPending.mockImplementation(realNotificationRepo.commitPending);
});

afterEach(async () => {
  setPlatform(realPlatform);
  // `Keyboard` keeps the last event it saw on the module singleton, and
  // `useKeyboardHeight` seeds itself from it — so a test that leaves the
  // keyboard up hands the next one a form that is already at that height, and
  // its own `showKeyboard` then changes nothing and fires no effect.
  await act(async () => {
    keyboardEmitter.emit('keyboardWillHide');
    keyboardEmitter.emit('keyboardDidHide');
  });
  // Shared across every mocked native component in this module registry, so
  // leaving an implementation behind would leak into the next test.
  measureInWindow.mockReset();
  scrollTo.mockReset();
});

/**
 * The edit sheet is bottom-anchored inside a `Modal`, and until round 4 it had
 * no keyboard avoidance of any kind — the note field sat under the IME and the
 * user typed blind. It gets the same treatment as auto-log's sheets: a
 * `KeyboardAvoidingView` backdrop plus an anchor padded by `useKeyboardSheetLift`.
 */
describe('notification inbox edit sheet', () => {
  it('lets the KeyboardAvoidingView compensate on every platform', async () => {
    await openEditSheet();

    // `behavior="padding"` is the only KeyboardAvoidingView branch that composes
    // a `paddingBottom` onto its own style, so its presence is the assertion.
    const avoidingView = screen.getByTestId('edit-sheet-anchor').parent!;
    expect(StyleSheet.flatten(avoidingView.props.style)).toHaveProperty('paddingBottom');
  });

  it('lifts the sheet by the keyboard the backdrop did not absorb, on Android', async () => {
    setPlatform('android');
    await openEditSheet();

    await layoutAnchor(800);
    await showKeyboard(312);

    // Nothing shrank the anchor, which is exactly the edge-to-edge Android case:
    // the sheet has to carry the whole keyboard itself.
    expect(anchorPaddingBottom()).toBe(312);
  });

  it('drops the lift again once the keyboard goes away', async () => {
    setPlatform('android');
    await openEditSheet();

    await layoutAnchor(800);
    await showKeyboard(312);
    await act(async () => {
      keyboardEmitter.emit('keyboardWillHide');
      keyboardEmitter.emit('keyboardDidHide');
    });

    expect(anchorPaddingBottom()).toBe(0);
  });

  it('adds no lift on top of a backdrop that already shrank the anchor', async () => {
    setPlatform('android');
    await openEditSheet();

    await layoutAnchor(800);
    await showKeyboard(312);
    // The KeyboardAvoidingView padded the backdrop; double-counting here would
    // push the sheet a full keyboard height off the top of the IME.
    await layoutAnchor(488);

    expect(anchorPaddingBottom()).toBe(0);
  });

  it('leaves the lift to the KeyboardAvoidingView on iOS', async () => {
    setPlatform('ios');
    await openEditSheet();

    await layoutAnchor(800);
    await showKeyboard(312);

    expect(anchorPaddingBottom()).toBe(0);
  });

  /**
   * The screen used to gate its writes on a `busyId` useState read from the
   * render closure, so a second press in the same tick sailed past it and
   * committed the row twice. The repo's commit chain now makes the second
   * write a no-op at the data layer; the assertion that the guard itself came
   * back is the absence of the "already committed" alert it would raise.
   */
  it('ignores a same-tick double tap on Confirm', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const id = await seedPending();
    await render(<NotificationInboxScreen />);
    await waitFor(() => expect(screen.getByTestId(`confirm-${id}`)).toBeTruthy());

    // One act scope, so both presses land before React re-renders with the
    // button disabled — a same-tick double tap, not two separate taps.
    await act(async () => {
      fireEvent.press(screen.getByTestId(`confirm-${id}`));
      fireEvent.press(screen.getByTestId(`confirm-${id}`));
    });

    await waitFor(async () => {
      expect(await mockTestDb.select().from(transactions)).toHaveLength(1);
    });
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  /**
   * `useSubmitGuard` covers the write paths — the cards and the Save button —
   * but not the two ways out of the sheet itself. Dismissing mid-save discarded
   * the typed amount/note/bucket while the write was still running, so the
   * failure alert landed over the list with nothing left to correct and re-enter.
   */
  it('blocks Cancel and hardware back while the save is in flight', async () => {
    let releaseCommit = () => {};
    mockCommitPending.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCommit = () => resolve();
        }),
    );

    await openEditSheet();
    await fireEvent.changeText(screen.getByTestId('edit-note'), 'Chickenjoy');
    await act(async () => {
      fireEvent.press(screen.getByTestId('submit'));
    });

    // Cancel: still the sheet, still what was typed into it.
    await fireEvent.press(screen.getByTestId('edit-cancel'));
    expect(screen.getByTestId('edit-note').props.value).toBe('Chickenjoy');

    // Android's hardware back, which reaches the Modal's `onRequestClose`
    // rather than the button — the only node in the tree carrying one.
    const [modal] = screen.container.queryAll((node) => node.props.onRequestClose != null);
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(screen.getByTestId('edit-note').props.value).toBe('Chickenjoy');

    // And the sheet still closes on its own once the write lands.
    await act(async () => {
      releaseCommit();
    });
    await waitFor(() => expect(screen.queryByTestId('edit-note')).toBeNull());
  });

  /**
   * The sheet lift clears the *sheet* of the keyboard, which is all it ever
   * did. Note is the last of five stacked fields inside a sheet capped at 90%
   * of the screen, so it can still sit below the sheet's own scroll viewport —
   * the original "typing blind" report, unfixed until the sheet mounted a
   * reveal context of its own. `FormTextInput` was already in place here, but
   * with no `RevealFieldProvider` above it the context default is null and its
   * `onFocus` hook was a guaranteed no-op.
   */
  it('scrolls the note field into view when it takes focus', async () => {
    await openEditSheet();
    stubGeometry({
      // The sheet's scroll viewport ends at 500; the note's bottom edge is 8
      // past it, and wants REVEAL_MARGIN (16) of clearance on top.
      'edit-sheet-viewport': [0, 300, 400, 200],
      'edit-note': [0, 460, 400, 48],
    });

    await fireEvent(screen.getByTestId('edit-note'), 'focus');

    expect(scrollTo).toHaveBeenCalledWith({ y: 24, animated: true });
  });

  it('reveals the focused note again once the keyboard height lands', async () => {
    setPlatform('android');
    await openEditSheet();

    // The tap comes first, while the sheet still has the whole screen and the
    // note is comfortably inside it.
    stubGeometry({
      'edit-sheet-viewport': [0, 100, 400, 600],
      'edit-note': [0, 460, 400, 48],
    });
    await fireEvent(screen.getByTestId('edit-note'), 'focus');
    expect(scrollTo).not.toHaveBeenCalled();

    // Then the IME arrives, the sheet lifts, and its viewport loses the bottom
    // 200 — which is the moment the note goes under.
    stubGeometry({
      'edit-sheet-viewport': [0, 100, 400, 400],
      'edit-note': [0, 460, 400, 48],
    });
    await layoutAnchor(800);
    await showKeyboard(312);

    expect(scrollTo).toHaveBeenCalledWith({ y: 24, animated: true });
  });

  it('still saves what was typed into the note field', async () => {
    await openEditSheet();

    await fireEvent.changeText(screen.getByTestId('edit-note'), 'Chickenjoy');
    await fireEvent.press(screen.getByTestId('submit'));

    await waitFor(async () => {
      const rows = await mockTestDb.select().from(transactions);
      expect(rows).toHaveLength(1);
      expect(rows[0].note).toBe('Chickenjoy');
    });
  });
});
