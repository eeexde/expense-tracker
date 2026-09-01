import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { TransactionForm, TransactionFormValues } from '@/components/TransactionForm';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { transferFeeCategoryId } from '@/db/categoryRepo';
import { addExpense, deleteTransaction, loadTransferFee, updateTransaction } from '@/db/repo';
import {
  buckets as bucketsTable,
  categories as categoriesTable,
  transactions,
} from '@/db/schema';
import { centavosToInput, feeAsPercent } from '@/lib/money';
import { colors, fonts, spacing } from '@/theme';

export default function EditTransactionScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txnId = Number(id);

  const txn = useAppQuery(async (db) => {
    const [row] = await db.select().from(transactions).where(eq(transactions.id, txnId));
    return row;
  }, [txnId]);
  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const categories = useAppQuery((db) => db.select().from(categoriesTable));
  // Non-transfers get `{ legacy: false }` straight back, so this stays one
  // cheap query rather than a conditional hook.
  const feeState = useAppQuery((db) => loadTransferFee(db, txnId), [txnId]);

  // A transaction linked to a utang/installment payment keeps its money fields
  // fixed — those repos own the balance math. A recurring-linked one is fixed
  // for a different reason: its (recurringId, date) pair is what suppresses the
  // scheduled posting, so letting the money drift here would silently disagree
  // with the rule the user chose to cover. Note/date/category stay editable.
  const linked = txn
    ? txn.utangId != null || txn.installmentId != null || txn.recurringId != null
    : false;

  const save = async (values: TransactionFormValues) => {
    if (linked) {
      await updateTransaction(db, txnId, {
        categoryId: values.categoryId ?? null,
        note: values.note ?? null,
        date: values.date,
      });
    } else if (values.kind === 'transfer') {
      const existingFee = feeState?.linked;
      // Resolved before any money moves, exactly as add-transaction does it:
      // creating the category is harmless on its own, and doing it after the
      // transfer update would add a second place the save can stop.
      const feeCategoryId =
        values.feeAmount !== undefined && !existingFee ? await transferFeeCategoryId(db) : undefined;

      await updateTransaction(db, txnId, {
        amount: values.amount,
        bucketId: values.bucketId,
        toBucketId: values.toBucketId ?? null,
        categoryId: null,
        note: values.note ?? null,
        date: values.date,
      });

      // Transfer first, fee second — the add screen's rule, for the same
      // reason. Dying in between leaves the transfer at its new figures with
      // the OLD fee row still attached: stale, which is the state this screen
      // was built to fix and which re-saving or deleting the transfer still
      // fixes. It can never strand a fee whose transfer is gone, nor charge a
      // fee for money that did not move.
      if (values.feeAmount === undefined) {
        if (existingFee) await deleteTransaction(db, existingFee.id);
      } else if (existingFee) {
        // The fee follows the sender: change the "From" bucket and the charge
        // moves with it, or `bucketBalance` would keep docking the old one.
        await updateTransaction(db, existingFee.id, {
          amount: values.feeAmount,
          bucketId: values.bucketId,
          date: values.date,
        });
      } else {
        await addExpense(db, {
          amount: values.feeAmount,
          bucketId: values.bucketId,
          date: values.date,
          categoryId: feeCategoryId,
          note: 'Transfer fee',
          feeForTransactionId: txnId,
        });
      }
    } else {
      await updateTransaction(db, txnId, {
        amount: values.amount,
        bucketId: values.bucketId,
        toBucketId: null,
        categoryId: values.categoryId ?? null,
        note: values.note ?? null,
        date: values.date,
      });
    }
    refresh();
    router.back();
  };

  /**
   * What goes back into the fee field.
   *
   * Only centavos are stored, so a percentage has to be re-derived — and it is
   * only offered when it reproduces the stored amount exactly (`feeAsPercent`).
   * That is the difference that matters: in percent mode a changed transfer
   * amount recomputes the fee, which is the whole point of carrying it. When
   * no percentage fits, the exact amount goes back as a fixed fee rather than
   * a near-miss percentage that would silently re-charge a different figure.
   */
  const feePrefill = useMemo(() => {
    const fee = feeState?.linked;
    if (!fee || !txn) return undefined;
    const percent = feeAsPercent(txn.amount, fee.amount);
    return percent !== null
      ? { mode: 'percent' as const, text: String(percent) }
      : { mode: 'fixed' as const, text: centavosToInput(fee.amount) };
  }, [feeState, txn]);

  const confirmDelete = () => {
    Alert.alert(
      'Delete this transaction?',
      // `deleteTransaction` takes the linked fee with it — say so, rather than
      // letting a second row quietly vanish from the list.
      feeState?.linked ? 'Its transfer fee is deleted with it.' : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTransaction(db, txnId);
            refresh();
            router.back();
          },
        },
      ],
    );
  };

  // The form seeds its fields once, on mount, so it must not mount before the
  // fee is known — otherwise a saved fee would render as an empty field and
  // the first save would delete it.
  if (!txn || !buckets || !categories || !feeState) return <View style={styles.loading} />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Text style={styles.title}>Edit transaction</Text>
      {feeState.legacy && (
        <Text style={styles.feeNotice} testID="legacy-fee-notice">
          A “Transfer Fee” expense from before fees were linked sits on this bucket and date. It
          isn’t attached to this transfer, so nothing here changes or deletes it — edit or delete
          that row on its own.
        </Text>
      )}
      <TransactionForm
        buckets={buckets}
        categories={categories}
        initialKind={txn.type}
        lockKind
        lockMoney={linked}
        offerTransferFee
        submitLabel="Save changes"
        initialValues={{
          amount: txn.amount,
          bucketId: txn.bucketId,
          toBucketId: txn.toBucketId ?? undefined,
          categoryId: txn.categoryId ?? undefined,
          note: txn.note ?? undefined,
          date: txn.date,
          fee: feePrefill,
        }}
        onSubmit={save}
      />
      <Text style={styles.deleteLink} onPress={confirmDelete} accessibilityRole="button">
        Delete this transaction
      </Text>
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
  feeNotice: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkFaint,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  deleteLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
    padding: spacing.md,
  },
});
