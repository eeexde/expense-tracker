import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[formStyles.submit, disabled && formStyles.submitDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID="submit"
    >
      <Text style={formStyles.submitText}>{label}</Text>
    </Pressable>
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
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
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
