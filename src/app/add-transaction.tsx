import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TransactionForm, TransactionFormValues } from '@/components/TransactionForm';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { addExpense, addIncome, addTransfer } from '@/db/repo';
import { listOpenInstallments, recordLinkedInstallmentPayment } from '@/db/installmentRepo';
import { listOpenUtang, recordLinkedUtangPayment } from '@/db/utangRepo';
import { buckets as bucketsTable, categories as categoriesTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { colors, fonts, spacing } from '@/theme';

export default function AddTransactionScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  // Receipt scan (Task 11) prefills via params.
  const params = useLocalSearchParams<{
    amountText?: string;
    merchant?: string;
    photoUri?: string;
  }>();

  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const categories = useAppQuery((db) => db.select().from(categoriesTable));
  const openUtang = useAppQuery((db) => listOpenUtang(db));
  const openInstallments = useAppQuery((db) => listOpenInstallments(db));

  const save = async (values: TransactionFormValues) => {
    const input = {
      amount: values.amount,
      bucketId: values.bucketId,
      date: values.date,
      categoryId: values.categoryId,
      note: values.note,
      receiptPhotoUri: values.receiptPhotoUri,
      utangId: values.utangId,
      installmentId: values.installmentId,
    };
    if (values.kind !== 'transfer' && values.utangId !== undefined) {
      // Validates direction + remaining, records the payment; the transaction
      // below is the single money log (no double entry).
      await recordLinkedUtangPayment(db, values.kind, {
        utangId: values.utangId,
        amount: values.amount,
        date: values.date,
        bucketId: values.bucketId,
      });
    }
    if (values.kind === 'expense' && values.installmentId !== undefined) {
      // Moves the plan's paid amount forward; the expense below is the money log.
      await recordLinkedInstallmentPayment(db, {
        installmentId: values.installmentId,
        amount: values.amount,
      });
    }
    if (values.kind === 'expense') await addExpense(db, input);
    else if (values.kind === 'income') await addIncome(db, input);
    else await addTransfer(db, { ...input, toBucketId: values.toBucketId! });
    refresh();
    router.back();
  };

  if (!buckets || !categories) return <View style={styles.loading} />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Text style={styles.title}>New transaction</Text>
      <TransactionForm
        buckets={buckets}
        categories={categories}
        openUtang={openUtang}
        openInstallments={openInstallments}
        onSubmit={save}
        onScanReceipt={() => router.push('/scan-receipt')}
        initialAmountText={params.amountText}
        initialNote={params.merchant}
        receiptPhotoUri={params.photoUri}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    padding: spacing.md,
    paddingBottom: 0,
  },
});
