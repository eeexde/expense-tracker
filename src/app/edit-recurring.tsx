import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { RecurringForm, RecurringFormValues } from '@/components/RecurringForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { buckets as bucketsTable, categories as categoriesTable, recurring } from '@/db/schema';
import { bucketChain, deleteRecurring, setFallbackBuckets } from '@/db/recurringRepo';
import { colors, fonts, spacing } from '@/theme';

export default function EditRecurringScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ruleId = Number(id);

  const rule = useAppQuery(async (db) => {
    const [row] = await db.select().from(recurring).where(eq(recurring.id, ruleId));
    return row;
  }, [ruleId]);
  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  // Position 0 is the rule's own bucketId, which the form holds separately.
  const fallbackBucketIds = useAppQuery(
    async (db) => (rule ? (await bucketChain(db, rule)).slice(1) : undefined),
    [rule?.id, rule?.bucketId],
  );
  const categories = useAppQuery((db) =>
    db.select().from(categoriesTable).where(eq(categoriesTable.type, 'expense')),
  );

  const save = async (values: RecurringFormValues) => {
    const { fallbackBucketIds: chain, ...row } = values;
    await db
      .update(recurring)
      .set({ ...row, categoryId: values.categoryId ?? null })
      .where(eq(recurring.id, ruleId));
    await setFallbackBuckets(db, ruleId, values.bucketId, chain);
    refresh();
    router.back();
  };

  const toggleActive = async () => {
    if (!rule) return;
    await db.update(recurring).set({ active: !rule.active }).where(eq(recurring.id, ruleId));
    refresh();
  };

  const confirmDelete = () => {
    Alert.alert('Delete?', rule?.name ?? '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // Chain links and chain events point at the rule — clear them first.
          await deleteRecurring(db, ruleId);
          refresh();
          router.back();
        },
      },
    ]);
  };

  if (!rule || !buckets || !categories || !fallbackBucketIds) {
    return <SafeAreaView style={formStyles.screen} />;
  }

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>Edit recurring</Text>
      <RecurringForm
        buckets={buckets}
        categories={categories}
        initial={{
          name: rule.name,
          amount: rule.amount,
          frequency: rule.frequency,
          dayDue: rule.dayDue,
          bucketId: rule.bucketId,
          categoryId: rule.categoryId ?? undefined,
          fallbackBucketIds,
        }}
        onSubmit={save}
      />
      <Text style={styles.toggleLink} onPress={toggleActive} accessibilityRole="button">
        {rule.active ? 'Pause this rule' : 'Resume this rule'}
      </Text>
      <Text style={formStyles.deleteLink} onPress={confirmDelete} accessibilityRole="button">
        Delete this rule
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  toggleLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.gold,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
});
