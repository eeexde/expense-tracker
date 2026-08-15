import {
  createContext,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  KeyboardTypeOptions,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Icon } from './Icon';
import { colors, fonts, radii, spacing } from '@/theme';

/** Shared building blocks for the small add/edit modal forms. */

/**
 * Keyboard for short numeric strings that still need a `-`: `YYYY-MM-DD` dates
 * and signed (credit card) balances. `numbers-and-punctuation` is iOS-only —
 * on Android it silently falls back to the full QWERTY keyboard — so Android
 * gets the phone pad, a digit keypad whose layout also carries `-` and `.`.
 * (RN's Android TextInput lets the input type pick the keyboard without
 * filtering typed characters, so nothing legal gets rejected either way.)
 */
export const SIGNED_NUMERIC_KEYBOARD: KeyboardTypeOptions =
  Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'phone-pad';

/* ---------------------------------------------------------------------------
 * Keyboard avoidance
 *
 * Android is the hard case, and it is the platform this app ships on — but it
 * is not one case, it is two. RN force-enables edge-to-edge
 * (`setDecorFitsSystemWindows(window, false)`) only when the build targets SDK
 * 35+ *and* the device runs SDK 35+: `WindowUtil.isEdgeToEdgeFeatureFlagOn` is
 * set from `AndroidVersion.isAtLeastTargetSdk35()`, which tests
 * `Build.VERSION.SDK_INT` as well as the target. This app targets 36 and has
 * minSdk 24, so the same APK behaves both ways:
 *
 *   - Device on Android 15+: edge-to-edge. A window whose decor does not fit
 *     system windows is *not* resized by `adjustResize` — the IME arrives only
 *     as a `WindowInsetsCompat.Type.ime()` inset, nothing shrinks, and the
 *     whole keyboard has to be absorbed here.
 *   - Device on Android 14 or below: `disableEdgeToEdge()` restores
 *     `setDecorFitsSystemWindows(window, true)` and the window *is* resized by
 *     `SOFT_INPUT_ADJUST_RESIZE`. Everything already moved; the correct extra
 *     lift is 0.
 *
 * Nothing below branches on which one it got, deliberately. The viewport
 * measures itself and `keyboardSlack` subtracts whatever room it already lost,
 * which answers the question directly instead of inferring it from a version
 * probe that would have to stay in sync with RN's own gating.
 *
 * RN reads that inset directly, so `endCoordinates.height` is truthful
 * (ReactRootView.checkForKeyboardEvents: `imeInsets.bottom - barInsets.bottom`).
 * But it derives `endCoordinates.screenY` from `getWindowVisibleDisplayFrame()`,
 * which under edge-to-edge may never shrink — and `screenY` is the only thing
 * `KeyboardAvoidingView._relativeKeyboardHeight` measures against. So the KAV
 * alone cannot be relied on here.
 *
 * The fix is therefore layered, and the layers provably cannot double-count:
 *   1. `KeyboardAvoidingView behavior="padding"`, both platforms. Whatever it
 *      does manage to lift, it lifts.
 *   2. `keyboardSlack()` adds as scroll room only the part of the keyboard the
 *      viewport did *not* already lose — to a window resize, or to layer 1.
 *   3. `revealScrollDelta()` scrolls the focused field above the keyboard, which
 *      is what the original bug was actually about.
 * ------------------------------------------------------------------------- */

/** Breathing room left between a revealed field and the keyboard. */
const REVEAL_MARGIN = spacing.md;

/**
 * Bottom slack a scrollable still has to add for its content to clear the
 * keyboard, given how much of its own viewport it already lost.
 *
 * `baseline - viewport` covers *every* mechanism that already compensated: an
 * Android window resize, an enclosing `KeyboardAvoidingView`, a shrinking
 * parent. Subtracting it is what makes this safe to stack on top of the KAV —
 * when the KAV does the whole job this returns 0.
 */
export function keyboardSlack(keyboardHeight: number, baseline: number, viewport: number): number {
  return Math.max(0, keyboardHeight - Math.max(0, baseline - viewport));
}

/**
 * How far down to scroll so a focused field clears the keyboard.
 *
 * The keyboard's top edge is derived as `viewportBottom - slack` rather than
 * from `Dimensions` or `endCoordinates.screenY`: `slack` is by definition the
 * height of keyboard still overlapping this viewport, so the subtraction needs
 * no screen-coordinate assumptions (and no guessing at nav-bar insets).
 */
export function revealScrollDelta({
  fieldBottom,
  viewportBottom,
  slack,
  margin = REVEAL_MARGIN,
}: {
  /** Field's bottom edge, window coordinates. */
  fieldBottom: number;
  /** Scroll viewport's bottom edge, window coordinates. */
  viewportBottom: number;
  /** Keyboard height still overlapping the viewport — see `keyboardSlack`. */
  slack: number;
  margin?: number;
}): number {
  return Math.max(0, fieldBottom + margin - (viewportBottom - slack));
}

/**
 * Whether the keyboard is cutting into a field, as opposed to the field having
 * been scrolled out from under it.
 *
 * Android re-emits `keyboardDidShow` for every IME height change while it stays
 * visible (suggestion strip, emoji panel, symbols layer), and re-revealing on
 * each of those undoes a scroll the user made on purpose — focus survives a tap
 * elsewhere under `keyboardShouldPersistTaps="handled"`. A field whose top edge
 * is already at or below the keyboard line is not partly visible, so nothing
 * about it is being obscured *now*; it is simply somewhere else.
 */
export function isFieldObscured({
  fieldTop,
  fieldBottom,
  viewportBottom,
  slack,
  margin = REVEAL_MARGIN,
}: {
  fieldTop: number;
  fieldBottom: number;
  /** Scroll viewport's bottom edge, window coordinates. */
  viewportBottom: number;
  /** Keyboard height still overlapping the viewport — see `keyboardSlack`. */
  slack: number;
  margin?: number;
}): boolean {
  const keyboardTop = viewportBottom - slack;
  return fieldTop < keyboardTop && fieldBottom + margin > keyboardTop;
}

/**
 * Measured software-keyboard height in dp, 0 while hidden, plus a ref carrying
 * the same up/down state.
 *
 * `upRef` is written *synchronously inside the listener*, not from an effect
 * keyed on `height`. An effect only runs after React has rendered, so a render
 * triggered by some other event in the same batch — a viewport `onLayout`
 * reporting the very resize this keyboard caused — would still read the stale
 * value. Writing it in the listener closes that window: whichever of the two
 * events is dispatched first, the flag is right by the time anything renders.
 *
 * iOS gets the `Will` events so the change lands with the keyboard animation;
 * Android only ever fires the `Did` pair.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  const upRef = useRef(false);

  useEffect(() => {
    const apply = (next: number) => {
      // Synchronously, inside the listener: a layout dispatched in the same
      // React batch reads this ref from a render-phase updater, so deferring
      // the write to an effect would let that updater see the stale value.
      upRef.current = next > 0;
      setHeight(next);
    };
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e: KeyboardEvent) =>
      apply(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => apply(0));
    // iOS-only backstop for the seed below. `Keyboard.isVisible()`/`metrics()`
    // read `_currentlyShowing`, which the module writes *only* from the `Did`
    // pair (Keyboard.js: the constructor subscribes `keyboardDidShow` /
    // `keyboardDidHide`). Between `willHide` and `didHide` — the ~250ms iOS
    // dismissal animation — it therefore still reports a visible keyboard at
    // its full pre-dismissal height. A form mounting in that window (navigating
    // to a modal form with a field still focused) would seed a keyboard that is
    // already leaving and never hear otherwise: `willHide` has been and gone,
    // and on iOS `didHide` is not otherwise subscribed. That leaves a
    // keyboard-sized dead gap under the submit button until a full focus/blur
    // cycle. Subscribing to it too costs one redundant `apply(0)` per dismissal.
    const didHide = ios ? Keyboard.addListener('keyboardDidHide', () => apply(0)) : null;
    // Seed from the module's own record of the last event. Android re-emits
    // `keyboardDidShow` only when the height changes, and that bookkeeping sits
    // on the ReactRootView rather than per subscriber — so subscribing while
    // the IME is already up at a steady height otherwise delivers nothing at
    // all, and the first layout we see would be an already-compensated one.
    if (Keyboard.isVisible()) apply(Keyboard.metrics()?.height ?? 0);
    return () => {
      show.remove();
      hide.remove();
      didHide?.remove();
    };
  }, []);

  return { height, upRef };
}

/**
 * Tracks a box's height across keyboard changes and reports the keyboard it is
 * still overlapped by. The baseline is only re-taken while the keyboard is
 * down, so a shrink caused by the keyboard never poisons it.
 */
function useKeyboardOverlap() {
  const { height: keyboardHeight, upRef: keyboardUpRef } = useKeyboardHeight();
  const [box, setBox] = useState({ baseline: 0, viewport: 0 });

  // Set by a window-metrics change, consumed by the next `onLayout`.
  //
  // The high-water mark below is one-sided: the only branch that re-takes the
  // baseline outright is the keyboard-down one. So an *honest* shrink with the
  // keyboard up — an Android multi-window divider dragged mid-typing — is
  // rejected for as long as the IME stays visible, and once that shrink reaches
  // the keyboard height the slack clamps to 0, leaving the lower fields and the
  // submit button under the IME with no way to scroll to them.
  //
  // A `Dimensions` change is the signal that the shrink did *not* come from the
  // keyboard, and it is a trustworthy one: RN derives it from the activity's
  // window bounds minus system-bar/cutout insets (DeviceInfoModule
  // .getWindowDisplayMetrics), which the IME does not touch — an `adjustResize`
  // window resize emits no `didUpdateDimensions`. So this cannot re-open the
  // bug the high-water mark was added for.
  const rebaselineRef = useRef(false);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => {
      rebaselineRef.current = true;
    });
    return () => sub.remove();
  }, []);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const height = e.nativeEvent.layout.height;
      // Read and clear out here in the event handler, not inside the updater —
      // updaters have to stay pure, and this one already runs twice under
      // StrictMode.
      const rebaseline = rebaselineRef.current;
      rebaselineRef.current = false;
      setBox((prev) => ({
        viewport: height,
        // Read the flag *here*, inside the updater, on purpose: updaters run in
        // the render phase, which is after every listener in the batch has run,
        // so this sees the keyboard event even when the layout was dispatched
        // first.
        //
        // While the keyboard is up the baseline is a high-water mark rather
        // than simply frozen. A poisoned baseline is by definition *smaller*
        // than the true one — only the keyboard shrinks this box — so `Math.max`
        // rejects it even if the flag somehow still lagged. The keyboard-down
        // branch re-takes the mark outright, so an honest shrink (rotation, a
        // header appearing) still lands — as does one the window metrics just
        // told us about, which is the keyboard-up half of that recovery.
        baseline:
          keyboardUpRef.current && !rebaseline ? Math.max(prev.baseline, height) : height,
      }));
    },
    [keyboardUpRef],
  );

  return {
    keyboardHeight,
    slack: keyboardSlack(keyboardHeight, box.baseline, box.viewport),
    onLayout,
  };
}

/** Lets a `FormTextInput` ask its scrollable to bring it above the keyboard. */
const RevealFieldContext = createContext<((field: TextInput | null) => void) | null>(null);

/**
 * `TextInput` that scrolls itself above the keyboard when focused. Drop-in for
 * `TextInput` — every other prop, including `ref`, passes straight through.
 */
export function FormTextInput({
  ref,
  onFocus,
  ...props
}: TextInputProps & { ref?: RefObject<TextInput | null> }) {
  const reveal = useContext(RevealFieldContext);
  const fallbackRef = useRef<TextInput | null>(null);
  const inputRef = ref ?? fallbackRef;
  return (
    <TextInput
      {...props}
      ref={inputRef}
      onFocus={(e) => {
        reveal?.(inputRef.current);
        onFocus?.(e);
      }}
    />
  );
}

/**
 * Scrollable form body that keeps the fields and the submit button clear of the
 * software keyboard, and scrolls the focused field into view. See the block
 * comment above for why this does not just hand the job to KeyboardAvoidingView.
 */
export function KeyboardAwareForm({
  children,
  contentContainerStyle,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const { keyboardHeight, slack, onLayout } = useKeyboardOverlap();
  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const offsetRef = useRef(0);
  // Last offset we asked for ourselves, 0 for none pending. `onScroll` is
  // throttled to 16ms and an animated `scrollTo` takes far longer than that, so
  // `offsetRef` can still read the pre-scroll offset while the field has
  // already moved. A second reveal landing in that window — the Android `next`
  // chain swapping the short numeric pad for the taller QWERTY — would then
  // measure a delta against a base it has already spent, and stop short of the
  // keyboard.
  const commandedRef = useRef(0);
  const focusedRef = useRef<TextInput | null>(null);
  // Whether the previous run of the re-reveal effect already had a keyboard up.
  const keyboardWasUpRef = useRef(false);
  // Read inside the measure callbacks, which resolve a frame or two after the
  // render that set them. Synced in an effect, not during render — a ref write
  // in the render body is exactly what react-hooks/refs rejects.
  const slackRef = useRef(slack);
  useEffect(() => {
    slackRef.current = slack;
  }, [slack]);

  // Deliberately not cleared on blur: focus events do not have a guaranteed
  // order against the blur of the field being left, and a stale entry is
  // harmless — the re-reveal below only runs while a keyboard is actually up,
  // which means something is focused.
  const reveal = useCallback(
    (field: TextInput | null, { onlyIfObscured = false }: { onlyIfObscured?: boolean } = {}) => {
      focusedRef.current = field;
      const viewport = viewportRef.current;
      if (!field || !viewport) return;
      viewport.measureInWindow((_vx, vy, _vw, vh) => {
        field.measureInWindow((_fx, fy, _fw, fh) => {
          const currentSlack = slackRef.current;
          const viewportBottom = vy + vh;
          const geometry = { fieldBottom: fy + fh, viewportBottom, slack: currentSlack };
          if (onlyIfObscured && !isFieldObscured({ ...geometry, fieldTop: fy })) return;
          const delta = revealScrollDelta({
            fieldBottom: fy + fh,
            viewportBottom,
            slack: currentSlack,
          });
          // Sub-pixel deltas are just measurement noise; scrolling on them makes
          // the list twitch on every focus.
          if (delta > 1) {
            const target = Math.max(offsetRef.current, commandedRef.current) + delta;
            commandedRef.current = target;
            scrollRef.current?.scrollTo({ y: target, animated: true });
          }
        });
      });
    },
    [],
  );

  // The keyboard arrives after the tap that focused the field, so the reveal
  // has to run again once its height is known. Keying this off the height and
  // not off `slack` matters: on a device that resizes the window `slack` stays
  // 0 throughout and only the height moves.
  //
  // Android then re-emits `keyboardDidShow` for every IME height change while
  // it stays visible — suggestion strip, emoji panel, symbols layer — so from
  // the second one on the reveal is conditional. Otherwise scrolling up to look
  // at the chips (focus survives, `keyboardShouldPersistTaps="handled"`) gets
  // undone by the next height change.
  useEffect(() => {
    const up = keyboardHeight > 0;
    const wasUp = keyboardWasUpRef.current;
    keyboardWasUpRef.current = up;
    if (up && focusedRef.current) reveal(focusedRef.current, { onlyIfObscured: wasUp });
  }, [keyboardHeight, reveal]);

  return (
    <KeyboardAvoidingView style={formStyles.fill} behavior="padding">
      <View
        ref={viewportRef}
        style={formStyles.fill}
        onLayout={onLayout}
        // Android flattens layout-only Views, which would leave nothing to
        // measure the viewport against.
        collapsable={false}
        testID="form-viewport"
      >
        <RevealFieldContext.Provider value={reveal}>
          <ScrollView
            ref={scrollRef}
            style={formStyles.fill}
            contentContainerStyle={[
              formStyles.content,
              { paddingBottom: spacing.xl + slack },
              contentContainerStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            // A drag means the offset the user wants is the one on screen, not
            // one we asked for earlier.
            onScrollBeginDrag={() => {
              commandedRef.current = 0;
            }}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              const y = e.nativeEvent.contentOffset.y;
              offsetRef.current = y;
              // Reached what we asked for (or went past it) — the memory of the
              // request has served its purpose.
              if (y >= commandedRef.current) commandedRef.current = 0;
            }}
          >
            {children}
          </ScrollView>
        </RevealFieldContext.Provider>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Bottom lift for a sheet anchored to the bottom of a `KeyboardAvoidingView`
 * backdrop: the slice of keyboard the KAV (or a window resize) did not already
 * take off the anchor's own box. Spread `onLayout` onto the anchor.
 *
 * Android only. On iOS the KAV's own math is sound and rides the `Will` events,
 * so a second measured lift there would only overshoot for the one frame before
 * the anchor's `onLayout` reports the KAV's padding back.
 */
export function useKeyboardSheetLift() {
  const { slack, onLayout } = useKeyboardOverlap();
  return { lift: Platform.OS === 'android' ? slack : 0, onLayout };
}

/**
 * Whether a `number-pad` / `decimal-pad` field can carry a working Return-key
 * chain. Android's numeric IME draws an action key, so "next" really does move
 * focus. iOS renders those pads with no Return key at all, so the chain props
 * are left off there rather than shipping an affordance that only pretends to
 * work. Spread it in — the `onSubmitEditing` closure has to stay inline in the
 * JSX, since react-hooks/refs rejects handing a ref-reading callback to a
 * helper during render:
 *
 * ```tsx
 * {...(NUMERIC_PAD_HAS_RETURN_KEY
 *   ? { ...NUMERIC_PAD_NEXT, onSubmitEditing: () => nextRef.current?.focus() }
 *   : null)}
 * ```
 */
export const NUMERIC_PAD_HAS_RETURN_KEY = Platform.OS === 'android';

/** Static half of the numeric-pad chain; pair with an `onSubmitEditing`. */
export const NUMERIC_PAD_NEXT: Pick<TextInputProps, 'returnKeyType' | 'submitBehavior'> = {
  returnKeyType: 'next',
  submitBehavior: 'submit',
};

/**
 * Guards an async save path. The ref — not the state — is what stops a
 * same-tick double-tap, since a second press fires before React re-renders
 * with the button disabled. Without it a fast double-tap writes twice.
 */
export function useSubmitGuard<A extends unknown[]>(
  run: (...args: A) => void | Promise<void>,
): [submitting: boolean, submit: (...args: A) => Promise<void>] {
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const submit = async (...args: A) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await run(...args);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return [submitting, submit];
}

export function ChipRow({
  items,
  selectedId,
  onSelect,
  testIDPrefix,
}: {
  items: { id: number; label: string; icon?: string }[];
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={formStyles.chipRow}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            style={[formStyles.chip, selected && formStyles.chipActive]}
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            testID={testIDPrefix ? `${testIDPrefix}-${item.id}` : undefined}
          >
            {item.icon && (
              <Icon name={item.icon} size={14} color={selected ? colors.gold : colors.inkFaint} />
            )}
            <Text style={[formStyles.chipText, selected && formStyles.chipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={formStyles.segmented}>
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          style={[formStyles.segment, value === opt.value && formStyles.segmentActive]}
          onPress={() => onChange(opt.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === opt.value }}
          testID={`segment-${opt.value}`}
        >
          <Text
            style={[formStyles.segmentText, value === opt.value && formStyles.segmentTextActive]}
          >
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function SubmitButton({
  label,
  disabled,
  submitting = false,
  onPress,
}: {
  label: string;
  disabled: boolean;
  /** True while an async save is in flight — blocks a duplicate submit. */
  submitting?: boolean;
  onPress: () => void;
}) {
  const blocked = disabled || submitting;
  return (
    <Pressable
      style={[formStyles.submit, blocked && formStyles.submitDisabled]}
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: submitting }}
      testID="submit"
    >
      <Text style={formStyles.submitText}>{label}</Text>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  /**
   * `paddingBottom` is the resting value; `KeyboardAwareForm` overrides it with
   * `spacing.xl + slack` so the submit button can always be scrolled clear of
   * the keyboard. See `keyboardSlack`.
   */
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    padding: spacing.md,
    paddingBottom: 0,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm + spacing.xs,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  textInputError: { borderColor: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    // 44 is the minimum comfortable tap target; padding alone gives ~32.
    minHeight: 44,
    gap: spacing.xs + 2,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipActive: { backgroundColor: colors.surfaceRaised, borderColor: colors.gold },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkDim },
  chipTextActive: { color: colors.ink },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.surfaceRaised },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkFaint },
  segmentTextActive: { color: colors.gold },
  submit: {
    backgroundColor: colors.gold,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitDisabled: { opacity: 0.35 },
  submitText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.bg },
  deleteLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
    padding: spacing.md,
  },
});
