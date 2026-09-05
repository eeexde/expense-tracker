import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Dimensions,
  findNodeHandle,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radii, spacing } from '@/theme';
import { useTourOptional } from './TourProvider';
import { Rect } from './tourSteps';

/** Breathing room between the spotlight edge and the element it reveals. */
const SPOTLIGHT_PAD = 8;
/** Gap between the spotlight and the tooltip card. */
const CARD_GAP = 12;
const CARD_MARGIN = 16;
/**
 * Used only until the card's first real `onLayout` lands — after that, the
 * measured height drives placement. A step near the bottom of the screen
 * whose card grows past this (a large accessibility font scale, for
 * instance) is what pushed Skip/Next off screen before the real height was
 * taken into account.
 */
const CARD_ESTIMATED_HEIGHT = 190;
/** Step-to-step fade duration; skipped entirely under reduce-motion. */
const FADE_MS = 180;

/**
 * A full-screen path with a rounded-rect hole punched in it. `evenodd` is what
 * makes the inner subpath a hole rather than a second filled shape.
 */
function maskPath(width: number, height: number, hole: Rect, radius: number): string {
  const x = hole.x - SPOTLIGHT_PAD;
  const y = hole.y - SPOTLIGHT_PAD;
  const w = hole.width + SPOTLIGHT_PAD * 2;
  const h = hole.height + SPOTLIGHT_PAD * 2;
  const r = Math.min(radius, w / 2, h / 2);
  return [
    `M0 0H${width}V${height}H0Z`,
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

/**
 * The first-run walkthrough overlay. Rendered by the root layout as a sibling
 * of the navigator so it covers the tab bar as well as the screen, and returns
 * null whenever no tour is running — including when there is no provider at
 * all, which is how every screen test sees it.
 */
export function TourOverlay() {
  const tour = useTourOptional();
  const { width, height } = Dimensions.get('window');

  const active = tour?.active ?? false;
  const back = tour?.back;
  const skip = tour?.skip;
  const index = tour?.index ?? 0;
  const stepId = tour?.step?.id ?? null;
  const resolving = tour?.resolving ?? false;

  // The card's real height, from its own onLayout. Reset whenever the step
  // changes so a short step never inherits a taller step's measurement.
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  useEffect(() => {
    setCardHeight(null);
  }, [stepId]);

  const handleCardLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.height;
    setCardHeight((prev) => (prev === measured ? prev : measured));
  };

  // Reduce-motion is read once at mount and whenever the OS reports a change;
  // both the fade and the focus jump are gated on it not being enabled for
  // the fade (a screen reader still needs the focus move either way).
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled: boolean) =>
      setReduceMotion(enabled),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Fade between steps — skipped under reduce-motion, where the card just
  // appears at full opacity instead of animating in.
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!stepId) return;
    if (reduceMotion) {
      opacity.value = 1;
    } else {
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: FADE_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId, reduceMotion]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Screen-reader focus moves to the step title on every step change — an
  // `accessibilityViewIsModal` region only scopes navigation, it never
  // announces anything on its own.
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    if (!stepId || resolving) return;
    const handle = findNodeHandle(titleRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [stepId, resolving]);

  // Android's hardware back belongs to the tour while it is up: backing out of
  // the app mid-tour would leave the flag unwritten and re-run it next launch.
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) skip?.();
      else back?.();
      return true;
    });
    return () => sub.remove();
  }, [active, back, index, skip]);

  if (!tour || !tour.active || !tour.step) return null;

  const { step, rect, stepCount } = tour;
  const spotlight = rect;

  // The card can never be taller than the viewport minus its margins — past
  // that point capping its height (and letting its own content scroll) is
  // the only way to keep the action row reachable.
  const maxCardHeight = Math.max(0, height - CARD_MARGIN * 2);
  const effectiveHeight = Math.min(cardHeight ?? CARD_ESTIMATED_HEIGHT, maxCardHeight);

  // Below the spotlight if there is room, otherwise above it.
  let cardTop = height / 2 - effectiveHeight / 2;
  if (spotlight) {
    const below = spotlight.y + spotlight.height + SPOTLIGHT_PAD + CARD_GAP;
    const above = spotlight.y - SPOTLIGHT_PAD - CARD_GAP - effectiveHeight;
    cardTop = below + effectiveHeight + CARD_MARGIN <= height ? below : above;
  }
  // Clamp between the top margin and whatever keeps the card's real (or
  // estimated) bottom edge inside the screen — using the card's true height
  // once it is known is what keeps a taller-than-estimated card's action row
  // from running off the bottom edge.
  const minTop = CARD_MARGIN;
  const maxTop = Math.max(minTop, height - CARD_MARGIN - effectiveHeight);
  cardTop = Math.min(Math.max(cardTop, minTop), maxTop);

  return (
    <View style={styles.fill} testID="tour-overlay" pointerEvents="box-none">
      {/* Swallows every touch aimed at the app underneath: the tour advances
          through its own buttons only, so nothing can be tapped out of order. */}
      <Pressable style={styles.fill} onPress={() => {}} accessible={false} />

      <Svg style={styles.fill} width={width} height={height} pointerEvents="none">
        <Path
          testID={spotlight ? 'tour-spotlight' : 'tour-dim'}
          d={spotlight ? maskPath(width, height, spotlight, radii.md) : `M0 0H${width}V${height}H0Z`}
          fill={colors.bg}
          fillOpacity={0.82}
          fillRule="evenodd"
        />
      </Svg>

      {/* While a target is still measuring, the screen dims but no card shows —
          otherwise the card would jump as soon as the rect landed. */}
      {!resolving && (
        <Animated.View
          style={[styles.card, { top: cardTop, maxHeight: maxCardHeight }, fadeStyle]}
          onLayout={handleCardLayout}
          accessibilityViewIsModal
          testID="tour-card"
        >
          <ScrollView testID="tour-card-scroll" style={styles.scroll}>
            <Text
              ref={titleRef}
              style={styles.title}
              testID="tour-title"
              accessibilityRole="header"
            >
              {step.title}
            </Text>
            <Text style={styles.body} testID="tour-body">
              {step.body}
            </Text>
          </ScrollView>
          <Text style={styles.counter} testID="tour-counter">
            {index + 1} of {stepCount}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={tour.skip} hitSlop={8} accessibilityRole="button" testID="tour-skip">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
            <View style={styles.actionsRight}>
              {index > 0 && (
                <Pressable onPress={tour.back} hitSlop={8} accessibilityRole="button" testID="tour-back">
                  <Text style={styles.back}>Back</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.nextButton}
                onPress={tour.next}
                accessibilityRole="button"
                testID="tour-next"
              >
                <Text style={styles.nextText}>{index === stepCount - 1 ? 'Done' : 'Next'}</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: StyleSheet.absoluteFill,
  card: {
    position: 'absolute',
    left: CARD_MARGIN,
    right: CARD_MARGIN,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  scroll: { flexGrow: 0 },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  counter: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.inkFaint,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skip: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint },
  back: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.inkDim },
  nextButton: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  nextText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.bg },
});
