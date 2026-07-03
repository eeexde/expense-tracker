import { Pressable, StyleSheet, Text } from 'react-native';
import { formatPeso } from '@/lib/money';
import { Bucket } from '@/db/schema';
import { colors, fonts, radii, spacing } from '@/theme';

interface Props {
  bucket: Bucket;
  balance: number;
  onPress?: () => void;
}

export function BucketCard({ bucket, balance, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${bucket.name}, ${formatPeso(balance)}`}
    >
      <Text style={styles.icon}>{bucket.icon}</Text>
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
  icon: { fontSize: 22 },
  name: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkDim },
  balance: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  negative: { color: colors.expense },
});
