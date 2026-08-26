import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TransactionForm, TransactionFormValues } from '@/components/TransactionForm';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { addExpense, addIncome, addTransfer, listActiveRecurring } from '@/db/repo';
import {
  assertLinkedInstallmentPayment,
  listOpenInstallments,
  recordLinkedInstallmentPayment,
} from '@/db/installmentRepo';
import {
  assertLinkedUtangPayment,
  listOpenUtang,
  recordLinkedUtangPayment,
} from '@/db/utangRepo';
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
    kind?: string;
    photoUri?: string;
  }>();

  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const categories = useAppQuery((db) =>
    db.select().from(categoriesTable).where(eq(categoriesTable.archived, false)),
  );
  const openUtang = useAppQuery((db) => listOpenUtang(db));
  const openInstallments = useAppQuery((db) => listOpenInstallments(db));
  const activeRecurring = useAppQuery((db) => listActiveRecurring(db));

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
      // No assert/record pair like the other two links: a rule holds no balance,
      // so the only effect is that runCatchUp sees this due already covered.
      recurringId: values.recurringId,
    };
    const utangLink =
      values.kind !== 'transfer' && values.utangId !== undefined
        ? {
            kind: values.kind,
            payment: {
              utangId: values.utangId,
              amount: values.amount,
              date: values.date,
              bucketId: values.bucketId,
            },
          }
        : null;
    const installmentLink =
      values.kind === 'expense' && values.installmentId !== undefined
        ? { installmentId: values.installmentId, amount: values.amount }
        : null;

    // Reject a wrong-direction or over-payment before writing anything.
    if (utangLink) await assertLinkedUtangPayment(db, utangLink.kind, utangLink.payment);
    if (installmentLink) await assertLinkedInstallmentPayment(db, installmentLink);

    // Money log first, ledger second — and never the other way round. These are
    // two unguarded awaits with no usable transaction around them (both drizzle
    // drivers commit synchronously, so an async db.transaction() callback
    // commits at its first await), and Android kills backgrounded apps freely.
    // Dying between them this way leaves the transaction logged and the
    // plan/debt merely behind, which runCatchUp's reconcilers finish on the
    // next open. The reverse order left phantom progress — a plan believing it
    // was more paid than it was, with no transaction and no bucket movement
    // behind it, and nothing anywhere that could ever detect it.
    if (values.kind === 'expense') await addExpense(db, input);
    else if (values.kind === 'income') await addIncome(db, input);
    else await addTransfer(db, { ...input, toBucketId: values.toBucketId! });

    if (utangLink) await recordLinkedUtangPayment(db, utangLink.kind, utangLink.payment);
    if (installmentLink) await recordLinkedInstallmentPayment(db, installmentLink);
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
        activeRecurring={activeRecurring}
        onSubmit={save}
        onScanReceipt={() => router.push('/scan-receipt')}
        initialKind={params.kind === 'income' ? 'income' : 'expense'}
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
