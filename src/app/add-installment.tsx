import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { InstallmentForm, InstallmentFormValues } from '@/components/InstallmentForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { buckets as bucketsTable, installments } from '@/db/schema';
import { runCatchUp } from '@/lib/recurringEngine';
import { todayLocal } from '@/theme';

export default function AddInstallmentScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );

  const save = async (values: InstallmentFormValues) => {
    await db.insert(installments).values({
      itemName: values.itemName,
      totalAmount: values.monthlyDue * values.monthsTotal,
      monthlyDue: values.monthlyDue,
      monthsTotal: values.monthsTotal,
      dayDue: values.dayDue,
      bucketId: values.bucketId,
      startDate: todayLocal(),
    });
    // Post immediately if today is already a due date.
    await runCatchUp(db, todayLocal());
    refresh();
    router.back();
  };

  if (!buckets) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New installment</Text>
      <InstallmentForm buckets={buckets} onSubmit={save} />
    </SafeAreaView>
  );
}
