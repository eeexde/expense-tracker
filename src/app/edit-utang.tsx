import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { UtangForm, UtangFormValues } from '@/components/UtangForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { updateUtang, utangRemaining } from '@/db/utangRepo';
import { transactions, utang as utangTable, utangPayments } from '@/db/schema';

export default function EditUtangScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const utangId = Number(id);

  const debt = useAppQuery(async (db) => {
    const [row] = await db.select().from(utangTable).where(eq(utangTable.id, utangId));
    return row;
  }, [utangId]);
  const remaining = useAppQuery((db) => utangRemaining(db, utangId), [utangId]);

  const save = async (values: UtangFormValues) => {
    await updateUtang(db, utangId, { ...values, note: values.note ?? null });
    refresh();
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete this debt?',
      'Its payment records and any linked transactions are removed too.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Linked expenses/incomes reference this utang; clear them first.
            await db.delete(transactions).where(eq(transactions.utangId, utangId));
            await db.delete(utangPayments).where(eq(utangPayments.utangId, utangId));
            await db.delete(utangTable).where(eq(utangTable.id, utangId));
            refresh();
            router.back();
          },
        },
      ],
    );
  };

  if (!debt || remaining === undefined) return <SafeAreaView style={formStyles.screen} />;

  const paid = debt.originalAmount - remaining;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>Edit utang</Text>
      <UtangForm
        paid={paid}
        initial={{
          personName: debt.personName,
          direction: debt.direction,
          originalAmount: debt.originalAmount,
          note: debt.note ?? undefined,
        }}
        onSubmit={save}
      />
      <Text style={formStyles.deleteLink} onPress={confirmDelete}>
        Delete this debt
      </Text>
    </SafeAreaView>
  );
}
