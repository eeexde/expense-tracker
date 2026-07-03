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
          <Pressable onPress={() => router.push('/add-utang')} hitSlop={8}>
            <Text style={styles.addLink}>＋ Idagdag</Text>
          </Pressable>
        </View>

        <View style={styles.totalsRow}>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Utang ko</Text>
            <Text style={[styles.totalAmount, { color: colors.expense }]}>
              {totals === undefined ? '…' : formatPeso(totals.iOwe)}
            </Text>
          </View>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Utang sa akin</Text>
            <Text style={[styles.totalAmount, { color: colors.income }]}>
              {totals === undefined ? '…' : formatPeso(totals.owedToMe)}
            </Text>
          </View>
        </View>

        <UtangSection title="Mga inutang ko" list={iOwe} emptyText="Walang utang. Galing!" />
        <UtangSection
          title="Mga may utang sa akin"
          list={owedToMe}
          emptyText="Walang nangutang sa iyo."
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
        <Pressable
          key={u.id}
          style={styles.card}
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
        </Pressable>
      ))}
      {settled.map((u) => (
        <View key={u.id} style={[styles.card, styles.settled]}>
          <View style={styles.cardMain}>
            <Text style={[styles.cardTitle, { color: colors.inkFaint }]}>{u.personName}</Text>
            <Text style={styles.cardSub}>Bayad na ✓ {formatPeso(u.originalAmount)}</Text>
          </View>
        </View>
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
