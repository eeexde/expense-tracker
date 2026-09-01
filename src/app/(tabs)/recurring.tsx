import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppQuery } from '@/db/hooks';
import {
  buckets as bucketsTable,
  installments as installmentsTable,
  Installment,
  recurring as recurringTable,
  RecurringEvent,
} from '@/db/schema';
import { allBucketChains, listChainEvents } from '@/db/recurringRepo';
import { installmentRemaining } from '@/db/installmentRepo';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function RecurringScreen() {
  const router = useRouter();
  const rules = useAppQuery((db) => db.select().from(recurringTable));
  const plans = useAppQuery((db) => db.select().from(installmentsTable));
  const chains = useAppQuery(allBucketChains);
  const buckets = useAppQuery((db) => db.select().from(bucketsTable));
  const events = useAppQuery(listChainEvents);

  const bucketName = (id: number | null) =>
    (buckets ?? []).find((b) => b.id === id)?.name ?? 'a deleted bucket';
  /**
   * The latest event per rule. `listChainEvents` is ordered by due date and
   * holds at most one row per due, so the last one wins — and a 'skipped' row
   * only survives while the due is genuinely still unpaid, since the poster
   * clears it the run it finally goes through.
   */
  const latestEvent = new Map<number, RecurringEvent>();
  for (const event of events ?? []) latestEvent.set(event.recurringId, event);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Recurring expenses</Text>
          <Pressable
            style={styles.addButton}
            onPress={() => router.push('/add-recurring')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add recurring expense"
          >
            <Text style={styles.addLink}>＋ Add</Text>
          </Pressable>
        </View>
        {rules !== undefined && rules.length === 0 && (
          <Text style={styles.empty}>None yet. Add electricity, internet, rent…</Text>
        )}
        {(rules ?? []).map((rule) => (
          <Pressable
            key={rule.id}
            style={styles.card}
            onPress={() => router.push({ pathname: '/edit-recurring', params: { id: String(rule.id) } })}
          >
            <View style={styles.cardMain}>
              <Text style={[styles.cardTitle, !rule.active && styles.inactive]}>{rule.name}</Text>
              <Text style={styles.cardSub}>
                {rule.frequency === 'monthly'
                  ? `Monthly · day ${rule.dayDue}`
                  : `Weekly · ${WEEKDAYS[rule.dayDue]}`}
                {rule.active ? '' : ' · paused'}
              </Text>
              <Text style={styles.cardSub} numberOfLines={1}>
                {(chains?.get(rule.id) ?? [rule.bucketId]).map(bucketName).join(' → ')}
              </Text>
              <ChainEventLine event={latestEvent.get(rule.id)} bucketName={bucketName} />
            </View>
            <Text style={[styles.cardAmount, !rule.active && styles.inactive]}>
              {formatPeso(rule.amount)}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.hint}>Tap a rule to edit, pause, or delete it.</Text>

        <View style={[styles.headerRow, { marginTop: spacing.lg }]}>
          <Text style={styles.sectionTitle}>Installments</Text>
          <Pressable
            style={styles.addButton}
            onPress={() => router.push('/add-installment')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add installment plan"
          >
            <Text style={styles.addLink}>＋ Add</Text>
          </Pressable>
        </View>
        {plans !== undefined && plans.length === 0 && (
          <Text style={styles.empty}>No installment plans yet (e.g. Home Credit).</Text>
        )}
        {(plans ?? []).map((plan) => (
          <InstallmentCard key={plan.id} plan={plan} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The one place a fallback posting or a missed one is visible. A skipped due
 * writes no transaction at all, so without this line the money simply never
 * moves and nothing anywhere says why.
 */
function ChainEventLine({
  event,
  bucketName,
}: {
  event: RecurringEvent | undefined;
  bucketName: (id: number | null) => string;
}) {
  if (!event) return null;
  if (event.kind === 'skipped') {
    return (
      <Text style={styles.cardAlert}>
        ⚠ {event.date} not posted — no bucket could cover {formatPeso(event.amount)}
      </Text>
    );
  }
  return (
    <Text style={styles.cardNote}>
      {event.date} paid from {bucketName(event.bucketId)}
    </Text>
  );
}

function InstallmentCard({ plan }: { plan: Installment }) {
  const router = useRouter();
  const monthsLeft = plan.monthsTotal - plan.monthsPaid;
  const remaining = installmentRemaining(plan);
  const done = remaining <= 0;
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/edit-installment', params: { id: String(plan.id) } })}
    >
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle}>{plan.itemName}</Text>
        <Text style={styles.cardSub}>
          {done
            ? 'Paid off! 🎉'
            : `${formatPeso(plan.monthlyDue)}/month · ${monthsLeft} months left · day ${plan.dayDue}`}
        </Text>
      </View>
      <Text style={[styles.cardAmount, done && styles.done]}>
        {done ? formatPeso(plan.totalAmount) : formatPeso(remaining)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  // Text alone was a ~20px tap target; the box brings it to the 44px minimum.
  addButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  addLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
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
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  cardAlert: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.danger },
  cardNote: { fontFamily: fonts.body, fontSize: 12, color: colors.gold },
  cardAmount: { fontFamily: fonts.display, fontSize: 16, color: colors.expense },
  inactive: { color: colors.inkFaint },
  done: { color: colors.income },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.xs },
});
