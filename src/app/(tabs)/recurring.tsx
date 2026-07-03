import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import {
  installments as installmentsTable,
  Installment,
  recurring as recurringTable,
  Recurring,
} from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function RecurringScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const rules = useAppQuery((db) => db.select().from(recurringTable));
  const plans = useAppQuery((db) => db.select().from(installmentsTable));

  const toggleActive = async (rule: Recurring) => {
    await db.update(recurringTable).set({ active: !rule.active }).where(eq(recurringTable.id, rule.id));
    refresh();
  };

  const confirmDeleteRule = (rule: Recurring) => {
    Alert.alert('Delete?', rule.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await db.delete(recurringTable).where(eq(recurringTable.id, rule.id));
          refresh();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Recurring expenses</Text>
          <Pressable onPress={() => router.push('/add-recurring')} hitSlop={8}>
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
            onPress={() => toggleActive(rule)}
            onLongPress={() => confirmDeleteRule(rule)}
          >
            <View style={styles.cardMain}>
              <Text style={[styles.cardTitle, !rule.active && styles.inactive]}>{rule.name}</Text>
              <Text style={styles.cardSub}>
                {rule.frequency === 'monthly'
                  ? `Monthly · day ${rule.dayDue}`
                  : `Weekly · ${WEEKDAYS[rule.dayDue]}`}
                {rule.active ? '' : ' · paused'}
              </Text>
            </View>
            <Text style={[styles.cardAmount, !rule.active && styles.inactive]}>
              {formatPeso(rule.amount)}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.hint}>Tap to pause, long-press to delete.</Text>

        <View style={[styles.headerRow, { marginTop: spacing.lg }]}>
          <Text style={styles.sectionTitle}>Installments</Text>
          <Pressable onPress={() => router.push('/add-installment')} hitSlop={8}>
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

function InstallmentCard({ plan }: { plan: Installment }) {
  const monthsLeft = plan.monthsTotal - plan.monthsPaid;
  const remaining = monthsLeft * plan.monthlyDue;
  const done = monthsLeft <= 0;
  return (
    <View style={styles.card}>
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
    </View>
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
  cardAmount: { fontFamily: fonts.display, fontSize: 16, color: colors.expense },
  inactive: { color: colors.inkFaint },
  done: { color: colors.income },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.xs },
});
