import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { and, eq } from 'drizzle-orm';
import { RecurringForm, RecurringFormValues } from '@/components/RecurringForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { buckets as bucketsTable, categories as categoriesTable, recurring } from '@/db/schema';
import { setFallbackBuckets } from '@/db/recurringRepo';
import { runCatchUp } from '@/lib/recurringEngine';
import { todayLocal } from '@/theme';

export default function AddRecurringScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const categories = useAppQuery((db) =>
    db
      .select()
      .from(categoriesTable)
      .where(and(eq(categoriesTable.type, 'expense'), eq(categoriesTable.archived, false))),
  );

  const save = async (values: RecurringFormValues) => {
    const { fallbackBucketIds, ...row } = values;
    const [saved] = await db
      .insert(recurring)
      .values({ ...row, startDate: todayLocal() })
      .returning();
    // Before the catch-up below, so today's due already sees the whole chain.
    await setFallbackBuckets(db, saved.id, values.bucketId, fallbackBucketIds);
    // Post immediately if today is already a due date.
    await runCatchUp(db, todayLocal());
    refresh();
    router.back();
  };

  if (!buckets || !categories) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New recurring</Text>
      <RecurringForm buckets={buckets} categories={categories} onSubmit={save} />
    </SafeAreaView>
  );
}
