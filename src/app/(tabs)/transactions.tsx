import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { QueryErrorNotice } from '@/components/QueryError';
import { TransactionRow } from '@/components/TransactionRow';
import { useDb } from '@/db/DbProvider';
import { useAppQuery, useAppQueryResult } from '@/db/hooks';
import { pendingCount } from '@/db/notificationRepo';
import { deleteTransaction, listTransactions } from '@/db/repo';
import { buckets as bucketsTable, categories as categoriesTable, Transaction } from '@/db/schema';
import { duplicateTransactionIds } from '@/lib/duplicates';
import { formatPeso } from '@/lib/money';
import { monthLabel, shiftMonth } from '@/lib/months';
import { TourTarget } from '@/onboarding/TourTarget';
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
  // A bucket card on the home screen deep-links here with the bucket
  // pre-selected. `at` is a nonce the sender bumps on every press: without it,
  // pressing the SAME card twice leaves the params byte-identical, so the sync
  // below could not tell a fresh request from the one already applied and the
  // filter would stay wherever the user had since moved it.
  const params = useLocalSearchParams<{ bucketId?: string; at?: string }>();
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<TxnType | undefined>(undefined);
  const [bucketId, setBucketId] = useState<number | undefined>(() =>
    params.bucketId ? Number(params.bucketId) : undefined,
  );
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);

  // Adopt each new request once. Deliberately NOT keyed on render or on focus:
  // coming back to this tab without a new press must leave whatever the user
  // last picked in the chips alone, stale param or not.
  const appliedRequest = useRef(params.bucketId ? `${params.at}:${params.bucketId}` : null);
  useEffect(() => {
    if (!params.bucketId) return;
    const request = `${params.at}:${params.bucketId}`;
    if (appliedRequest.current === request) return;
    appliedRequest.current = request;
    setBucketId(Number(params.bucketId));
  }, [params.bucketId, params.at]);

  // The one query behind a spinner takes the non-throwing hook: a rejection
  // costs this list an inline retry, not the whole navigator. See
  // `useAppQueryResult`.
  const {
    data: txns,
    error: txnsError,
    retry: retryTxns,
  } = useAppQueryResult(
    (db) => listTransactions(db, { month, type, bucketId, categoryId }),
    [month, type, bucketId, categoryId],
  );
  const allCategories = useAppQuery((db) => db.select().from(categoriesTable));
  const allBuckets = useAppQuery((db) => db.select().from(bucketsTable));
  const inboxCount = useAppQuery(pendingCount) ?? 0;

  const categoryById = new Map((allCategories ?? []).map((c) => [c.id, c]));
  const bucketById = new Map((allBuckets ?? []).map((b) => [b.id, b]));
  // Grouped once per result set, not per rendered row.
  const duplicateIds = useMemo(() => duplicateTransactionIds(txns ?? []), [txns]);

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
        {/* "‹" and "›" are all a screen reader would otherwise have to go on. */}
        <Pressable
          onPress={() => setMonth(shiftMonth(month, -1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Text style={styles.monthArrow}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable
          onPress={() => setMonth(shiftMonth(month, 1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Text style={styles.monthArrow}>›</Text>
        </Pressable>
      </View>

      {inboxCount > 0 && (
        <TourTarget id="transactions.inbox">
          <Pressable
            style={styles.inboxPill}
            onPress={() => router.push('/notification-inbox')}
            accessibilityRole="button"
            testID="notification-inbox-badge"
          >
            <Text style={styles.inboxPillText}>Inbox {inboxCount}</Text>
          </Pressable>
        </TourTarget>
      )}

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

      <FlatList
        // `flex: 1` (basis 0) rather than the default basis:auto. With auto,
        // this list's flex basis is its FULL content height, so a long month
        // overflows the column and Yoga shrinks every shrinkable sibling to
        // make it fit — which squeezed the filter rows above and clipped their
        // chip text. Basis 0 means the list simply takes what is left over.
        style={styles.list}
        testID="transaction-list"
        data={txns ?? []}
        keyExtractor={(txn) => String(txn.id)}
        renderItem={({ item: txn }) => (
          <TransactionRow
            txn={txn}
            category={txn.categoryId != null ? categoryById.get(txn.categoryId) : undefined}
            bucket={bucketById.get(txn.bucketId)}
            toBucket={txn.toBucketId != null ? bucketById.get(txn.toBucketId) : undefined}
            perspectiveBucketId={bucketId}
            duplicate={duplicateIds.has(txn.id)}
            onPress={() => router.push({ pathname: '/edit-transaction', params: { id: String(txn.id) } })}
            onLongPress={() => confirmDelete(txn)}
          />
        )}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          txns !== undefined && txns.length > 0 ? (
            <Text style={styles.hint}>Tap a transaction to edit it. Long-press to delete.</Text>
          ) : null
        }
        ListEmptyComponent={
          txnsError !== null && txns === undefined ? (
            <QueryErrorNotice
              message="Couldn't load transactions."
              onRetry={retryTxns}
              testID="transactions-error"
            />
          ) : txns === undefined ? (
            <ActivityIndicator style={styles.loading} color={colors.gold} />
          ) : (
            <Text style={styles.empty}>No matching transactions this month.</Text>
          )
        }
      />

      <Pressable
        style={styles.fab}
        onPress={() => router.push('/add-transaction')}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        testID="add-transaction-fab"
      >
        {/* Pinned for the same reason as the home screen's FAB: the glyph is a
            shape inside a fixed 60dp circle, and the "Add transaction" label is
            what actually scales and announces. */}
        <Text style={styles.fabText} allowFontScaling={false}>
          ＋
        </Text>
      </Pressable>
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
      testID={`${testIDPrefix}-row`}
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
  /**
   * ScrollView's own base style is `flexGrow: 1, flexShrink: 1`, so `flexGrow: 0`
   * alone stops these rows growing but NOT shrinking. Without the explicit
   * `flexShrink: 0` they lose height whenever the transaction list overflows the
   * screen, and the chip labels clip vertically. They are fixed furniture.
   */
  filterRow: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.xs },
  list: { flex: 1 },
  filterRowContent: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    // Matches formStyles.chip: 44 is the minimum comfortable tap target,
    // padding alone gives ~26.
    minHeight: 44,
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
  inboxPill: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  inboxPillText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold },
  /**
   * 96 = the FAB's 60dp circle + its 24dp inset + a little air, matching the
   * home screen. `spacing.xl` left the last row sitting under the button.
   */
  content: { paddingHorizontal: spacing.md, paddingBottom: 96 },
  hint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.inkFaint,
    marginBottom: spacing.xs,
  },
  loading: { paddingVertical: spacing.xl },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkFaint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
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
