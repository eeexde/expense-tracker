import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPeso } from '@/lib/money';
import { Bucket } from '@/db/schema';
import { Icon } from './Icon';
import { colors, fonts, radii, spacing } from '@/theme';

interface Props {
  bucket: Bucket;
  balance: number;
  onPress?: () => void;
}

export function BucketCard({ bucket, balance, onPress }: Props) {
  const credit = bucket.type === 'credit';
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${bucket.name}, ${formatPeso(balance)}`}
    >
      <View style={styles.topRow}>
        <Icon name={bucket.icon} size={20} color={colors.gold} />
        {credit && <Text style={styles.creditTag}>CREDIT</Text>}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {bucket.name}
      </Text>
      <Text style={[styles.balance, balance < 0 && styles.negative]}>
        {balance < 0 ? `−${formatPeso(-balance)}` : formatPeso(balance)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    width: 132,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.75 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  creditTag: {
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.inkFaint,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs + 1,
    paddingVertical: 1,
  },
  name: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkDim },
  balance: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  negative: { color: colors.expense },
});
