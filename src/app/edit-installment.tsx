import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { InstallmentForm, InstallmentFormValues } from '@/components/InstallmentForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { updateInstallment } from '@/db/installmentRepo';
import { buckets as bucketsTable, installments } from '@/db/schema';

export default function EditInstallmentScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const planId = Number(id);

  const plan = useAppQuery(async (db) => {
    const [row] = await db.select().from(installments).where(eq(installments.id, planId));
    return row;
  }, [planId]);
  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );

  const save = async (values: InstallmentFormValues) => {
    await updateInstallment(db, planId, values);
    refresh();
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete this plan?',
      'Payments already logged as expenses stay. Only the plan is removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await db.delete(installments).where(eq(installments.id, planId));
            refresh();
            router.back();
          },
        },
      ],
    );
  };

  if (!plan || !buckets) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>Edit installment</Text>
      <InstallmentForm
        buckets={buckets}
        amountPaid={plan.amountPaid}
        initial={{
          itemName: plan.itemName,
          monthlyDue: plan.monthlyDue,
          monthsTotal: plan.monthsTotal,
          dayDue: plan.dayDue,
          bucketId: plan.bucketId,
        }}
        onSubmit={save}
      />
      <Text style={formStyles.deleteLink} onPress={confirmDelete}>
        Delete this plan
      </Text>
    </SafeAreaView>
  );
}
