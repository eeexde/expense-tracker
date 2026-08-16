import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppQuery } from '@/db/hooks';
import { listUtang, utangTotals, UtangWithRemaining } from '@/db/utangRepo';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

export default function UtangScreen() {
  const router = useRouter();
  const totals = useAppQuery((db) => utangTotals(db));
  const iOwe = useAppQuery((db) => listUtang(db, 'iOwe'));
  const owedToMe = useAppQuery((db) => listUtang(db, 'owedToMe'));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Utang</Text>
          <Pressable
            style={styles.addButton}
            onPress={() => router.push('/add-utang')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add utang"
          >
            <Text style={styles.addLink}>＋ Add</Text>
          </Pressable>
        </View>

        <View style={styles.totalsRow}>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>I owe</Text>
            <Text style={[styles.totalAmount, { color: colors.expense }]}>
              {totals === undefined ? '…' : formatPeso(totals.iOwe)}
            </Text>
          </View>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Owed to me</Text>
            <Text style={[styles.totalAmount, { color: colors.income }]}>
              {totals === undefined ? '…' : formatPeso(totals.owedToMe)}
            </Text>
          </View>
        </View>

        <UtangSection title="Debts I owe" list={iOwe} emptyText="No debts. Nice!" />
        <UtangSection
          title="Debts owed to me"
          list={owedToMe}
          emptyText="Nobody owes you."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function UtangSection({
  title,
  list,
  emptyText,
}: {
  title: string;
  list: UtangWithRemaining[] | undefined;
  emptyText: string;
}) {
  const router = useRouter();
  const open = (list ?? []).filter((u) => u.remaining > 0);
  const settled = (list ?? []).filter((u) => u.remaining <= 0);
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      {list !== undefined && open.length === 0 && <Text style={styles.empty}>{emptyText}</Text>}
      {open.map((u) => (
        <View key={u.id} style={styles.card}>
          <Pressable
            style={styles.cardMain}
            onPress={() => router.push({ pathname: '/pay-utang', params: { id: String(u.id) } })}
            accessibilityRole="button"
            accessibilityLabel={`Record a payment for ${u.personName}, ${formatPeso(u.remaining)} remaining`}
          >
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{u.personName}</Text>
              <Text style={styles.cardSub}>
                {u.note ? `${u.note} · ` : ''}orig {formatPeso(u.originalAmount)}
              </Text>
            </View>
            <Text
              style={[
                styles.cardAmount,
                { color: u.direction === 'iOwe' ? colors.expense : colors.income },
              ]}
            >
              {formatPeso(u.remaining)}
            </Text>
          </Pressable>
          {/* Editing and deleting an open debt both live behind edit-utang, and
              a plain tap here goes to pay-utang — so until this button existed
              the only route to either was `onLongPress`, a gesture TalkBack
              cannot be relied on to produce. Settled rows below need no
              equivalent: their own tap already goes to edit-utang. */}
          <Pressable
            style={styles.edit}
            onPress={() => router.push({ pathname: '/edit-utang', params: { id: String(u.id) } })}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${u.personName}`}
            testID={`edit-utang-${u.id}`}
          >
            <Text style={styles.editLink}>Edit</Text>
          </Pressable>
        </View>
      ))}
      {settled.map((u) => (
        <Pressable
          key={u.id}
          style={[styles.card, styles.settled]}
          onPress={() => router.push({ pathname: '/edit-utang', params: { id: String(u.id) } })}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${u.personName}, settled`}
        >
          <View style={styles.cardMain}>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: colors.inkFaint }]}>{u.personName}</Text>
              <Text style={styles.cardSub}>Settled ✓ {formatPeso(u.originalAmount)}</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pageTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  // Text alone was a ~20px tap target; the box brings it to the 44px minimum.
  addButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  addLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  totalsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  totalCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  totalLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  totalAmount: { fontFamily: fonts.display, fontSize: 20 },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  // Padding lives on the pressables inside, not here, and `stretch` lets them
  // fill the card's height — same reason as manage-buckets: with the padding on
  // the card, "Edit" would be the bare ~20dp text block inside a ~66dp card and
  // the 16dp band around it would be dead.
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  settled: { opacity: 0.6 },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.md,
  },
  cardText: { flex: 1, gap: 2 },
  // Padding rather than hitSlop, so the Edit target is a real full-card-height
  // box that abuts the pay box instead of overlapping it.
  edit: { justifyContent: 'center', paddingHorizontal: spacing.md },
  editLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  cardTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  cardAmount: { fontFamily: fonts.display, fontSize: 16 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
});
