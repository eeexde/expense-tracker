import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPeso } from '@/lib/money';
import { Bucket, Category, Transaction } from '@/db/schema';
import { Icon } from './Icon';
import { colors, fonts, radii, spacing } from '@/theme';

interface Props {
  txn: Transaction;
  category?: Category;
  bucket?: Bucket;
  toBucket?: Bucket;
  /**
   * Bucket the list is currently filtered to, if any. A transfer is one row
   * that shows up under both of its buckets, so it can only be signed once the
   * row knows whose side it is being read from.
   */
  perspectiveBucketId?: number;
  /** Same amount + date as another row on screen — see `duplicateTransactionIds`. */
  duplicate?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

const SIGN = { income: '+', expense: '−', transfer: '' } as const;
const AMOUNT_COLOR = {
  income: colors.income,
  expense: colors.expense,
  transfer: colors.transfer,
} as const;

export function TransactionRow({
  txn,
  category,
  bucket,
  toBucket,
  perspectiveBucketId,
  duplicate,
  onPress,
  onLongPress,
}: Props) {
  const title =
    txn.note ||
    category?.name ||
    (txn.type === 'transfer' ? 'Transfer' : txn.type === 'income' ? 'Income' : 'Expense');
  const subtitle =
    txn.type === 'transfer'
      ? `${bucket?.name ?? '?'} → ${toBucket?.name ?? '?'}`
      : bucket?.name ?? '';

  // Unfiltered, a transfer is neither in nor out — it is the neutral
  // `colors.transfer` with no sign, as it has always been. Filtered to one
  // bucket it becomes directional, and the arrow in the subtitle alone is too
  // quiet to carry that: money leaving reads as an expense, money arriving as
  // income.
  // Outgoing is tested first so a (write-time rejected, but possible in old
  // data) self-transfer signs the way `bucketBalance` counts it: out.
  const directional = txn.type === 'transfer' && perspectiveBucketId !== undefined;
  const outgoing = directional && perspectiveBucketId === txn.bucketId;
  const incoming = directional && !outgoing && perspectiveBucketId === txn.toBucketId;
  const sign = incoming ? '+' : outgoing ? '−' : SIGN[txn.type];
  const amountColor = incoming
    ? colors.income
    : outgoing
      ? colors.expense
      : AMOUNT_COLOR[txn.type];

  return (
    <Pressable
      style={({ pressed }) => [styles.row, duplicate && styles.duplicate, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityHint={duplicate ? 'Possible duplicate entry' : undefined}
      testID={`transaction-row-${txn.id}`}
    >
      <View style={styles.iconWrap}>
        <Icon
          name={txn.type === 'transfer' ? 'transfer' : category?.icon ?? 'tag'}
          size={18}
          color={colors.inkDim}
        />
      </View>
      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle ? `${subtitle} · ${txn.date}` : txn.date}
        </Text>
      </View>
      {/* A dot, not a badge: the tint already carries the hint, and a duplicate
          is a question for the reader rather than an error to shout about. */}
      {duplicate && <View style={styles.duplicateDot} testID={`duplicate-marker-${txn.id}`} />}
      <Text style={[styles.amount, { color: amountColor }]} testID={`amount-${txn.id}`}>
        {sign}
        {formatPeso(txn.amount)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm + spacing.xs,
  },
  pressed: { opacity: 0.75 },
  /**
   * One step up the surface ramp and nothing else — `surface` on `bg` is the
   * same ΔE76 6.4 step the cards already use to read as a layer, which is
   * enough to group the matching rows without reading as a warning. Padded
   * horizontally so the tint looks like a card rather than a full-bleed band;
   * the negative margin keeps the row's content aligned with its neighbours.
   */
  duplicate: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    marginHorizontal: -spacing.sm,
  },
  duplicateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.inkFaint },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  amount: { fontFamily: fonts.display, fontSize: 16 },
});
