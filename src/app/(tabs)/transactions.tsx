import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TransactionRow } from '@/components/TransactionRow';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { deleteTransaction, listTransactions } from '@/db/repo';
import { buckets as bucketsTable, categories as categoriesTable, Transaction } from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { colors, currentMonth, fonts, spacing } from '@/theme';

const MONTH_NAMES = [
  'Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo',
  'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre',
];

function shiftMonth(ym: string, delta: number): string {
  let [year, month] = ym.split('-').map(Number);
  month += delta;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export default function TransactionsScreen() {
  const { db, refresh } = useDb();
  const [month, setMonth] = useState(currentMonth());

  const txns = useAppQuery((db) => listTransactions(db, { month }), [month]);
  const allCategories = useAppQuery((db) => db.select().from(categoriesTable));
  const allBuckets = useAppQuery((db) => db.select().from(bucketsTable));

  const categoryById = new Map((allCategories ?? []).map((c) => [c.id, c]));
  const bucketById = new Map((allBuckets ?? []).map((b) => [b.id, b]));

  const confirmDelete = (txn: Transaction) => {
    Alert.alert('Burahin?', `${formatPeso(txn.amount)} — ${txn.note ?? txn.date}`, [
      { text: 'Kanselahin', style: 'cancel' },
      {
        text: 'Burahin',
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

      <ScrollView contentContainerStyle={styles.content}>
        {txns !== undefined && txns.length === 0 && (
          <Text style={styles.empty}>Walang transactions ngayong buwan.</Text>
        )}
        {(txns ?? []).map((txn) => (
          <TransactionRow
            key={txn.id}
            txn={txn}
            category={txn.categoryId != null ? categoryById.get(txn.categoryId) : undefined}
            bucket={bucketById.get(txn.bucketId)}
            toBucket={txn.toBucketId != null ? bucketById.get(txn.toBucketId) : undefined}
            onPress={() => confirmDelete(txn)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
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
