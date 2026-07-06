import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { TransactionRow } from '@/components/TransactionRow';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { deleteTransaction, listTransactions } from '@/db/repo';
import { buckets as bucketsTable, categories as categoriesTable, Transaction } from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { monthLabel, shiftMonth } from '@/lib/months';
import { colors, currentMonth, fonts, radii, spacing } from '@/theme';

type TxnType = 'expense' | 'income' | 'transfer';

const TYPE_OPTIONS: { value: TxnType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

export default function TransactionsScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<TxnType | undefined>(undefined);
  const [bucketId, setBucketId] = useState<number | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);

  const txns = useAppQuery(
    (db) => listTransactions(db, { month, type, bucketId, categoryId }),
    [month, type, bucketId, categoryId],
  );
  const allCategories = useAppQuery((db) => db.select().from(categoriesTable));
  const allBuckets = useAppQuery((db) => db.select().from(bucketsTable));

  const categoryById = new Map((allCategories ?? []).map((c) => [c.id, c]));
  const bucketById = new Map((allBuckets ?? []).map((b) => [b.id, b]));

  const confirmDelete = (txn: Transaction) => {
    Alert.alert('Delete?', `${formatPeso(txn.amount)} — ${txn.note ?? txn.date}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(db, txn.id);
          refresh();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.monthNav}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12}>
          <Text style={styles.monthArrow}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12}>
          <Text style={styles.monthArrow}>›</Text>
        </Pressable>
      </View>

      <FilterRow
        allLabel="All"
        items={TYPE_OPTIONS.map((o) => ({ key: o.value, label: o.label }))}
        selectedKey={type}
        onSelect={(key) => setType(key as TxnType | undefined)}
        testIDPrefix="filter-type"
      />
      <FilterRow
        allLabel="All buckets"
        items={(allBuckets ?? [])
          .filter((b) => !b.archived)
          .map((b) => ({ key: b.id, label: b.name, icon: b.icon }))}
        selectedKey={bucketId}
        onSelect={(key) => setBucketId(key as number | undefined)}
        testIDPrefix="filter-bucket"
      />
      <FilterRow
        allLabel="All categories"
        items={(allCategories ?? []).map((c) => ({ key: c.id, label: c.name, icon: c.icon }))}
        selectedKey={categoryId}
        onSelect={(key) => setCategoryId(key as number | undefined)}
        testIDPrefix="filter-category"
      />

      <ScrollView contentContainerStyle={styles.content}>
        {txns !== undefined && txns.length === 0 && (
          <Text style={styles.empty}>No matching transactions this month.</Text>
        )}
        {(txns ?? []).map((txn) => (
          <TransactionRow
            key={txn.id}
            txn={txn}
            category={txn.categoryId != null ? categoryById.get(txn.categoryId) : undefined}
            bucket={bucketById.get(txn.bucketId)}
            toBucket={txn.toBucketId != null ? bucketById.get(txn.toBucketId) : undefined}
            onPress={() => router.push({ pathname: '/edit-transaction', params: { id: String(txn.id) } })}
            onLongPress={() => confirmDelete(txn)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One horizontal chip row; the leading "All" chip clears the filter. */
function FilterRow({
  allLabel,
  items,
  selectedKey,
  onSelect,
  testIDPrefix,
}: {
  allLabel: string;
  items: { key: string | number; label: string; icon?: string }[];
  selectedKey: string | number | undefined;
  onSelect: (key: string | number | undefined) => void;
  testIDPrefix: string;
}) {
  const chips: { key: string | number | undefined; label: string; icon?: string }[] = [
    { key: undefined, label: allLabel },
    ...items,
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterRow}
      contentContainerStyle={styles.filterRowContent}
    >
      {chips.map((chip) => {
        const selected = chip.key === selectedKey;
        return (
          <Pressable
            key={chip.key ?? 'all'}
            style={[styles.chip, selected && styles.chipActive]}
            onPress={() => onSelect(chip.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            testID={`${testIDPrefix}-${chip.key ?? 'all'}`}
          >
            {chip.icon && (
              <Icon name={chip.icon} size={13} color={selected ? colors.gold : colors.inkFaint} />
            )}
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{chip.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  filterRow: { flexGrow: 0, marginBottom: spacing.xs },
  filterRowContent: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + spacing.xs,
  },
  chipActive: { backgroundColor: colors.surfaceRaised, borderColor: colors.gold },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkDim },
  chipTextActive: { color: colors.ink },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  monthArrow: { fontFamily: fonts.display, fontSize: 26, color: colors.gold },
  monthLabel: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkFaint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
