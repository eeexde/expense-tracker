import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AnimatedPressable } from './AnimatedPressable';
import { Icon } from './Icon';
import { colors, fonts, radii, spacing } from '@/theme';

/** Shared building blocks for the small add/edit modal forms. */

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
          <AnimatedChip
            key={item.id}
            selected={selected}
            onPress={() => onSelect(item.id)}
            testID={testIDPrefix ? `${testIDPrefix}-${item.id}` : undefined}
          >
            {item.icon && (
              <Icon name={item.icon} size={14} color={selected ? colors.gold : colors.inkFaint} />
            )}
            <Text style={[formStyles.chipText, selected && formStyles.chipTextActive]}>
              {item.label}
            </Text>
          </AnimatedChip>
        );
      })}
    </View>
  );
}

function AnimatedChip({
  selected,
  onPress,
  testID,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  const activeStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(selected ? colors.surfaceRaised : colors.surface, { duration: 150 }),
    borderColor: withTiming(selected ? colors.gold : colors.border, { duration: 150 }),
  }));
  return (
    <AnimatedPressable
      style={[formStyles.chip, activeStyle]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
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
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <AnimatedSegment
            key={opt.value}
            selected={selected}
            onPress={() => onChange(opt.value)}
            testID={`segment-${opt.value}`}
          >
            <Text style={[formStyles.segmentText, selected && formStyles.segmentTextActive]}>
              {opt.label}
            </Text>
          </AnimatedSegment>
        );
      })}
    </View>
  );
}

function AnimatedSegment({
  selected,
  onPress,
  testID,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  const activeStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(selected ? colors.surfaceRaised : 'transparent', { duration: 150 }),
    transform: [{ scale: withSpring(selected ? 1 : 0.97, { damping: 16, stiffness: 300 }) }],
  }));
  return (
    <AnimatedPressable
      style={[formStyles.segment, activeStyle]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
  );
}

export function SubmitButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const disabledStyle = useAnimatedStyle(() => ({
    opacity: withTiming(disabled ? 0.35 : 1, { duration: 150 }),
  }));
  return (
    <AnimatedPressable
      scaleTo={0.97}
      style={[formStyles.submit, disabledStyle]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID="submit"
    >
      <Text style={formStyles.submitText}>{label}</Text>
    </AnimatedPressable>
  );
}

export const formStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
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
    gap: spacing.xs + 2,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
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
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkFaint },
  segmentTextActive: { color: colors.gold },
  submit: {
    backgroundColor: colors.gold,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.bg },
});
