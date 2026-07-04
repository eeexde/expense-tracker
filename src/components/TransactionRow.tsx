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
  onPress?: () => void;
}

const SIGN = { income: '+', expense: '−', transfer: '' } as const;
const AMOUNT_COLOR = {
  income: colors.income,
  expense: colors.expense,
  transfer: colors.transfer,
} as const;

export function TransactionRow({ txn, category, bucket, toBucket, onPress }: Props) {
  const title =
    txn.note ||
    category?.name ||
    (txn.type === 'transfer' ? 'Transfer' : txn.type === 'income' ? 'Income' : 'Expense');
  const subtitle =
    txn.type === 'transfer'
      ? `${bucket?.name ?? '?'} → ${toBucket?.name ?? '?'}`
      : bucket?.name ?? '';

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
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
      <Text style={[styles.amount, { color: AMOUNT_COLOR[txn.type] }]}>
        {SIGN[txn.type]}
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
