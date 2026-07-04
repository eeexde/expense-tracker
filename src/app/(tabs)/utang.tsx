import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { AnimatedPressable } from '@/components/AnimatedPressable';
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
          <AnimatedPressable onPress={() => router.push('/add-utang')} hitSlop={8}>
            <Text style={styles.addLink}>＋ Add</Text>
          </AnimatedPressable>
        </View>

        <Animated.View entering={FadeIn.duration(250)} style={styles.totalsRow}>
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
        </Animated.View>

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
      {open.map((u, index) => (
        <AnimatedPressable
          key={u.id}
          style={styles.card}
          entering={FadeInDown.delay(index * 40).springify().damping(18)}
          onPress={() => router.push({ pathname: '/pay-utang', params: { id: String(u.id) } })}
        >
          <View style={styles.cardMain}>
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
        </AnimatedPressable>
      ))}
      {settled.map((u, index) => (
        <Animated.View
          key={u.id}
          entering={FadeInDown.delay((open.length + index) * 40).springify().damping(18)}
          style={[styles.card, styles.settled]}
        >
          <View style={styles.cardMain}>
            <Text style={[styles.cardTitle, { color: colors.inkFaint }]}>{u.personName}</Text>
            <Text style={styles.cardSub}>Settled ✓ {formatPeso(u.originalAmount)}</Text>
          </View>
        </Animated.View>
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  settled: { opacity: 0.6 },
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  cardAmount: { fontFamily: fonts.display, fontSize: 16 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
});
