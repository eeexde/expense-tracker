import { useRouter } from 'expo-router';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BucketCard } from '@/components/BucketCard';
import { TransactionRow } from '@/components/TransactionRow';
import { useAppQuery } from '@/db/hooks';
import { allBucketBalances, listTransactions, totalMoney } from '@/db/repo';
import { categories as categoriesTable, buckets as bucketsTable } from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
  const total = useAppQuery((db) => totalMoney(db));
  const balances = useAppQuery((db) => allBucketBalances(db));
  const recent = useAppQuery((db) => listTransactions(db, { limit: 10 }));
  const allCategories = useAppQuery((db) => db.select().from(categoriesTable));
  const allBuckets = useAppQuery((db) => db.select().from(bucketsTable));

  const categoryById = new Map((allCategories ?? []).map((c) => [c.id, c]));
  const bucketById = new Map((allBuckets ?? []).map((b) => [b.id, b]));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>Kuripot</Text>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Total money</Text>
          <Text style={styles.heroAmount}>{total === undefined ? '…' : formatPeso(total)}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Buckets</Text>
          <Pressable
            onPress={() => router.push('/manage-buckets')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Manage buckets"
          >
            <Text style={styles.manageLink}>✎ Manage</Text>
          </Pressable>
        </View>
        <FlatList
          horizontal
          data={balances ?? []}
          keyExtractor={(item) => String(item.bucket.id)}
          renderItem={({ item }) => <BucketCard bucket={item.bucket} balance={item.balance} />}
          contentContainerStyle={styles.bucketRow}
          showsHorizontalScrollIndicator={false}
          scrollEnabled
        />

        <Text style={styles.sectionTitle}>Recent</Text>
        {recent !== undefined && recent.length === 0 && (
          <Text style={styles.empty}>No transactions yet. Tap + to get started.</Text>
        )}
        {(recent ?? []).map((txn) => (
          <TransactionRow
            key={txn.id}
            txn={txn}
            category={txn.categoryId != null ? categoryById.get(txn.categoryId) : undefined}
            bucket={bucketById.get(txn.bucketId)}
            toBucket={txn.toBucketId != null ? bucketById.get(txn.toBucketId) : undefined}
          />
        ))}
      </ScrollView>

      <Pressable
        style={styles.fab}
        onPress={() => router.push('/add-transaction')}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
      >
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 96 },
  brand: {
    fontFamily: fonts.displayBlack,
    fontSize: 20,
    color: colors.gold,
    marginBottom: spacing.md,
  },
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  heroLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heroAmount: { fontFamily: fonts.displayBlack, fontSize: 40, color: colors.ink },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  manageLink: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold },
  bucketRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.md },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabText: { fontSize: 30, color: colors.bg, lineHeight: 34 },
});
