import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardEvent,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { buckets, categories, categoryRules, notificationSources } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these
// imports, so the screen's transitive expo-router / DbProvider / native-module
// imports are already mocked when it loads.
import AutoLogScreen from '@/app/auto-log';

jest.mock('expo-router', () => {
  // Pulled in inside the factory: babel hoists this call above every import, so
  // a module-scope binding would still be in its TDZ when it runs.
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
    // The screen (and `AiParsingSection`) read their native/persistent state on
    // focus. There is no navigator here, so focus is "mounted".
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});

let mockTestDb: TestDb;
const mockRefresh = jest.fn();
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: mockRefresh, catchUp: null }),
}));

/* --------------------------------------------------------------------------
 * The native listener
 *
 * `modules/notification-listener` calls `requireNativeModule('NotificationListener')`
 * at import time on Android and hands back `null` everywhere else — so under
 * jest the real module is permanently `isAvailable === false` and the screen
 * renders nothing but its "Android only" notice. Mocking the module wrapper
 * (rather than `expo-modules-core`) is the same convention the other screen
 * suites use for their data layer: replace our own boundary, keep the screen
 * itself real.
 * ------------------------------------------------------------------------ */

let mockAvailable = true;
const mockIsPermissionGranted = jest.fn(() => false);
const mockOpenSettings = jest.fn();
const mockGetLaunchableApps = jest.fn(() => [
  { label: 'BPI', packageName: 'com.bpi.app' },
  { label: 'GCash', packageName: 'com.globe.gcash.android' },
]);
const mockSetWatchedPackages = jest.fn();
jest.mock('../../modules/notification-listener', () => ({
  // A getter, not a value: `isAvailable` is a module-load-time constant on the
  // real module, and one test needs the unavailable branch.
  get isAvailable() {
    return mockAvailable;
  },
  isPermissionGranted: () => mockIsPermissionGranted(),
  openSettings: () => mockOpenSettings(),
  getLaunchableApps: () => mockGetLaunchableApps(),
  setWatchedPackages: (packages: string[]) => mockSetWatchedPackages(packages),
}));

// `llmController` imports react-native-executorch at module scope, which is not
// in `transformIgnorePatterns`' allowlist. The AI section is a separate concern
// with its own coverage; here it only has to render nothing.
jest.mock('@/lib/llmController', () => ({
  llmSupported: false,
  isModelDownloaded: jest.fn(async () => false),
  downloadModel: jest.fn(async () => {}),
  deleteModel: jest.fn(async () => {}),
  getDownloadProgress: jest.fn(() => 0),
  getLastDownloadError: jest.fn(() => null),
  getModelState: jest.fn(() => 'absent'),
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

/* --------------------------------------------------------------------------
 * Field reveal
 *
 * RN's jest preset assigns one shared `MockNativeMethods` object onto the
 * View/TextInput/ScrollView mock prototypes, so `measureInWindow` is a single
 * no-op `jest.fn()` behind every node — which means the reveal's two nested
 * measure callbacks never run and the whole path is invisible to a test that
 * does not stub it.
 *
 * The two sheets land on different halves of the reveal's scroll dispatch. The
 * rule sheet drives a `ScrollView` (`scrollTo`); the source sheet's fields ride
 * in a `FlatList` header/footer, and a `FlatList` has no `scrollTo` at all — it
 * is the sole caller of the `scrollToOffset` branch in `useRevealField`.
 * ------------------------------------------------------------------------ */

type Measurable = { prototype: { measureInWindow: jest.Mock } };
const measureInWindow = (View as unknown as Measurable).prototype.measureInWindow;
const scrollTo = (ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype
  .scrollTo;
// Not a prototype mock from the preset — `FlatList` is a real class component,
// so this is a spy. Stubbed out rather than called through: the assertion is
// which scroll API the reveal picked, and the real one would just forward to
// the `scrollTo` mock above and blur the two branches together.
const scrollToOffset = jest
  .spyOn(FlatList.prototype, 'scrollToOffset')
  .mockImplementation(() => {});

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

/**
 * The bottom-anchored box `useKeyboardSheetLift` pads: the nearest ancestor of
 * the sheet's reveal viewport that carries an `onLayout`. Reached by walking up
 * rather than by a testID of its own, so the screen needs no test-only markup.
 */
function sheetAnchor(viewportTestID: string) {
  let node = screen.getByTestId(viewportTestID).parent;
  while (node && node.props.onLayout == null) node = node.parent;
  if (!node) throw new Error(`no onLayout anchor above ${viewportTestID}`);
  return node;
}

async function layoutAnchor(viewportTestID: string, height: number) {
  await fireEvent(sheetAnchor(viewportTestID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
  });
}

function anchorPaddingBottom(viewportTestID: string): number {
  return StyleSheet.flatten(sheetAnchor(viewportTestID).props.style).paddingBottom;
}

const realPlatform = Platform.OS;
function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

/** Seeds one bucket + one category and returns their ids. */
async function seedTargets(): Promise<{ bucketId: number; categoryId: number }> {
  const [bucket] = await mockTestDb.insert(buckets).values({ name: 'Cash' }).returning();
  const [category] = await mockTestDb
    .insert(categories)
    .values({ name: 'Food', type: 'expense' })
    .returning();
  return { bucketId: bucket.id, categoryId: category.id };
}

async function openSourceSheet() {
  await render(<AutoLogScreen />);
  await fireEvent.press(screen.getByText('＋ Add source'));
  await waitFor(() => expect(screen.getByTestId('source-package')).toBeTruthy());
}

async function openRuleSheet() {
  await render(<AutoLogScreen />);
  await fireEvent.press(screen.getByText('＋ Add rule'));
  await waitFor(() => expect(screen.getByTestId('rule-keyword')).toBeTruthy());
}

beforeEach(() => {
  mockTestDb = createTestDb();
  mockAvailable = true;
  mockIsPermissionGranted.mockReturnValue(false);
  mockSetWatchedPackages.mockClear();
  mockOpenSettings.mockClear();
});

afterEach(async () => {
  setPlatform(realPlatform);
  // `Keyboard` keeps the last event it saw on the module singleton, and
  // `useKeyboardHeight` seeds itself from it — so a test that leaves the
  // keyboard up hands the next one a sheet that is already at that height.
  await act(async () => {
    keyboardEmitter.emit('keyboardWillHide');
    keyboardEmitter.emit('keyboardDidHide');
  });
  // Shared across every mocked native component in this module registry, so
  // leaving an implementation behind would leak into the next test.
  measureInWindow.mockReset();
  scrollTo.mockReset();
  scrollToOffset.mockClear();
});

describe('auto-log screen', () => {
  it('offers nothing but the platform notice where the listener does not exist', async () => {
    mockAvailable = false;

    await render(<AutoLogScreen />);

    expect(
      screen.getByText('Auto-log from notifications is only available on Android.'),
    ).toBeTruthy();
    expect(screen.queryByText('＋ Add source')).toBeNull();
  });

  it('reports the permission the native module actually grants', async () => {
    mockIsPermissionGranted.mockReturnValue(true);

    await render(<AutoLogScreen />);

    expect(screen.getByText('Listening ✓')).toBeTruthy();
    expect(screen.queryByText('Permission needed')).toBeNull();
  });
});

/**
 * Both sheets are pinned to the bottom of the screen and capped at 90% of it,
 * so their fields sit under the IME with nothing to scroll them clear until the
 * sheet mounts a `RevealFieldProvider` of its own — `FormTextInput` alone is a
 * plain `TextInput` when the context above it is the `null` default.
 */
describe('auto-log source sheet reveal', () => {
  it('scrolls the package field into view when it takes focus', async () => {
    await openSourceSheet();
    // The sheet's scroll viewport ends at 500; the package field's bottom edge
    // is 8 past it, and wants REVEAL_MARGIN (16) of clearance on top.
    stubGeometry({
      'source-sheet-viewport': [0, 300, 400, 200],
      'source-package': [0, 460, 400, 48],
    });

    await fireEvent(screen.getByTestId('source-package'), 'focus');

    // A `FlatList` has no `scrollTo`, so this is the one surface in the app
    // that reaches the `scrollToOffset` branch of the reveal.
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 24, animated: true });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls the keyword field in the list footer into view too', async () => {
    await openSourceSheet();
    // The footer field sits below the whole app list, which is exactly why this
    // sheet needs the reveal more than the other one.
    stubGeometry({
      'source-sheet-viewport': [0, 300, 400, 200],
      'source-keyword': [0, 600, 400, 48],
    });

    await fireEvent(screen.getByTestId('source-keyword'), 'focus');

    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 164, animated: true });
  });

  it('leaves a field that already clears the sheet viewport alone', async () => {
    await openSourceSheet();
    // Bottom edge at 400, viewport bottom at 500: 84 of room to spare even
    // after the margin. Scrolling here would make the list twitch on focus.
    stubGeometry({
      'source-sheet-viewport': [0, 300, 400, 200],
      'source-package': [0, 352, 400, 48],
    });

    await fireEvent(screen.getByTestId('source-package'), 'focus');

    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('reveals the focused field again once the keyboard height lands', async () => {
    setPlatform('android');
    await openSourceSheet();

    // The tap comes first, while the sheet still has the whole screen and the
    // package field is comfortably inside it.
    stubGeometry({
      'source-sheet-viewport': [0, 100, 400, 600],
      'source-package': [0, 460, 400, 48],
    });
    await fireEvent(screen.getByTestId('source-package'), 'focus');
    expect(scrollToOffset).not.toHaveBeenCalled();

    // Then the IME arrives, the sheet lifts, and its viewport loses the bottom
    // 200 — which is the moment the field goes under.
    stubGeometry({
      'source-sheet-viewport': [0, 100, 400, 400],
      'source-package': [0, 460, 400, 48],
    });
    await layoutAnchor('source-sheet-viewport', 800);
    await showKeyboard(312);

    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 24, animated: true });
  });

  it('lifts the sheet by the keyboard the backdrop did not absorb, on Android', async () => {
    setPlatform('android');
    await openSourceSheet();

    await layoutAnchor('source-sheet-viewport', 800);
    await showKeyboard(312);

    // Nothing shrank the anchor, which is exactly the edge-to-edge Android
    // case: the sheet has to carry the whole keyboard itself.
    expect(anchorPaddingBottom('source-sheet-viewport')).toBe(312);
  });
});

describe('auto-log rule sheet reveal', () => {
  it('scrolls the rule keyword field into view when it takes focus', async () => {
    await openRuleSheet();
    stubGeometry({
      'rule-sheet-viewport': [0, 300, 400, 200],
      'rule-keyword': [0, 460, 400, 48],
    });

    await fireEvent(screen.getByTestId('rule-keyword'), 'focus');

    // A plain `ScrollView` this time, so the other half of the dispatch.
    expect(scrollTo).toHaveBeenCalledWith({ y: 24, animated: true });
  });

  it('lifts the sheet by the keyboard the backdrop did not absorb, on Android', async () => {
    setPlatform('android');
    await openRuleSheet();

    await layoutAnchor('rule-sheet-viewport', 800);
    await showKeyboard(312);

    expect(anchorPaddingBottom('rule-sheet-viewport')).toBe(312);
  });
});

describe('auto-log source sheet save', () => {
  it('writes the source and re-pushes the watched packages to the listener', async () => {
    await seedTargets();
    await openSourceSheet();

    await fireEvent.changeText(screen.getByTestId('source-package'), 'com.bpi.app');
    await fireEvent.press(screen.getByText('Cash'));
    await fireEvent.press(screen.getByTestId('submit'));

    await waitFor(async () => {
      const rows = await mockTestDb.select().from(notificationSources);
      expect(rows).toHaveLength(1);
      expect(rows[0].packageName).toBe('com.bpi.app');
    });
    // The native listener only watches what it has been told about, and the row
    // it was just given is enabled by default.
    expect(mockSetWatchedPackages).toHaveBeenCalledWith(['com.bpi.app']);
    // Saving closes the sheet.
    await waitFor(() => expect(screen.queryByTestId('source-package')).toBeNull());
  });

  it('stores no match keyword when the optional field holds only spaces', async () => {
    await seedTargets();
    await openSourceSheet();

    await fireEvent.changeText(screen.getByTestId('source-package'), 'com.bpi.app');
    await fireEvent.press(screen.getByText('Cash'));
    await fireEvent.changeText(screen.getByTestId('source-keyword'), '   ');
    await fireEvent.press(screen.getByTestId('submit'));

    // A blank keyword has to become "no filter" — stored as-is it is a filter
    // that matches nothing, and the source silently stops auto-logging.
    await waitFor(async () => {
      const rows = await mockTestDb.select().from(notificationSources);
      expect(rows).toHaveLength(1);
      expect(rows[0].matchKeyword).toBeNull();
    });
  });

  it('keeps Save disabled until a bucket is picked', async () => {
    await seedTargets();
    await openSourceSheet();

    await fireEvent.changeText(screen.getByTestId('source-package'), 'com.bpi.app');
    // A package with nowhere to log to: `addSource` would happily insert a row
    // with whatever `bucketId` came last.
    expect(screen.getByTestId('submit').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByText('Cash'));
    expect(screen.getByTestId('submit').props.accessibilityState.disabled).toBe(false);
  });

  it('ignores a same-tick double tap on Save', async () => {
    await seedTargets();
    await openSourceSheet();
    await fireEvent.changeText(screen.getByTestId('source-package'), 'com.bpi.app');
    await fireEvent.press(screen.getByText('Cash'));

    // One act scope, so both presses land before React re-renders with the
    // button disabled — a same-tick double tap, not two separate taps.
    await act(async () => {
      fireEvent.press(screen.getByTestId('submit'));
      fireEvent.press(screen.getByTestId('submit'));
    });

    await waitFor(async () => {
      expect(await mockTestDb.select().from(notificationSources)).toHaveLength(1);
    });
  });
});

describe('auto-log rule sheet save', () => {
  it('writes the rule and closes the sheet', async () => {
    const { categoryId } = await seedTargets();
    await openRuleSheet();

    await fireEvent.changeText(screen.getByTestId('rule-keyword'), 'jollibee');
    await fireEvent.press(screen.getByText('Food'));
    await fireEvent.press(screen.getByTestId('submit'));

    await waitFor(async () => {
      const rows = await mockTestDb.select().from(categoryRules);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ keyword: 'jollibee', categoryId });
    });
    await waitFor(() => expect(screen.queryByTestId('rule-keyword')).toBeNull());
  });

  it('ignores a same-tick double tap on Save', async () => {
    await seedTargets();
    await openRuleSheet();
    await fireEvent.changeText(screen.getByTestId('rule-keyword'), 'jollibee');
    await fireEvent.press(screen.getByText('Food'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('submit'));
      fireEvent.press(screen.getByTestId('submit'));
    });

    await waitFor(async () => {
      expect(await mockTestDb.select().from(categoryRules)).toHaveLength(1);
    });
  });
});

describe('auto-log source list', () => {
  it('takes a disabled source back off the native watch list', async () => {
    const { bucketId } = await seedTargets();
    await mockTestDb
      .insert(notificationSources)
      .values({ bucketId, packageName: 'com.bpi.app' })
      .returning();

    await render(<AutoLogScreen />);
    await waitFor(() => expect(screen.getByText('com.bpi.app')).toBeTruthy());
    await fireEvent(screen.getByRole('switch'), 'valueChange', false);

    // The row survives (it is a pause, not a delete) but the listener must stop
    // being handed the package, or notifications keep arriving for it.
    await waitFor(() => expect(mockSetWatchedPackages).toHaveBeenCalledWith([]));
    expect(await mockTestDb.select().from(notificationSources)).toHaveLength(1);
  });
});

/**
 * Removing a source or a rule used to be `onLongPress` on the whole card and
 * nothing else — no `onPress`, no role, no label, and no alternative delete UI
 * anywhere in the app. A long press is not a gesture TalkBack can be relied on
 * to produce, so both lists were permanently undeletable with a screen reader
 * on. The queries below are deliberately `getByRole('button', { name })` rather
 * than a testID: what these tests are defending is precisely that the control
 * is reachable *as an announced button*, which a testID would not notice.
 */
describe('auto-log row removal without a long press', () => {
  /** Runs the destructive button of the most recent Alert.alert. */
  async function confirmAlert(alert: jest.SpyInstance) {
    const buttons = alert.mock.calls.at(-1)?.[2] as
      | { text: string; style?: string; onPress?: () => void | Promise<void> }[]
      | undefined;
    const destructive = buttons?.find((b) => b.style === 'destructive');
    expect(destructive).toBeDefined();
    await act(async () => {
      await destructive!.onPress?.();
    });
  }

  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alert.mockRestore());

  it('deletes a source from a labelled button, and re-pushes the watch list', async () => {
    const { bucketId } = await seedTargets();
    await mockTestDb
      .insert(notificationSources)
      .values({ bucketId, packageName: 'com.bpi.app' })
      .returning();

    await render(<AutoLogScreen />);
    await waitFor(() => expect(screen.getByText('com.bpi.app')).toBeTruthy());
    mockSetWatchedPackages.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Cash (com.bpi.app)' }));
    await confirmAlert(alert);

    await waitFor(async () => {
      expect(await mockTestDb.select().from(notificationSources)).toHaveLength(0);
    });
    // The listener has to be told, or it keeps waking the app for a source that
    // no longer has anywhere to log to.
    expect(mockSetWatchedPackages).toHaveBeenCalledWith([]);
  });

  it('deletes a category rule from a labelled button', async () => {
    const { categoryId } = await seedTargets();
    await mockTestDb.insert(categoryRules).values({ keyword: 'jollibee', categoryId }).returning();

    await render(<AutoLogScreen />);
    await waitFor(() => expect(screen.getByText('jollibee → Food')).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Remove rule jollibee' }));
    await confirmAlert(alert);

    await waitFor(async () => {
      expect(await mockTestDb.select().from(categoryRules)).toHaveLength(0);
    });
  });
});
