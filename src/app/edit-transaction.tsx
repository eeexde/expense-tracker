import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { TransactionForm, TransactionFormValues } from '@/components/TransactionForm';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { deleteTransaction, updateTransaction } from '@/db/repo';
import {
  buckets as bucketsTable,
  categories as categoriesTable,
  transactions,
} from '@/db/schema';
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

  // A transaction linked to a utang/installment payment keeps its money fields
  // fixed — those repos own the balance math. Note/date/category stay editable.
  const linked = txn ? txn.utangId != null || txn.installmentId != null : false;

  const save = async (values: TransactionFormValues) => {
    if (linked) {
      await updateTransaction(db, txnId, {
        categoryId: values.categoryId ?? null,
        note: values.note ?? null,
        date: values.date,
      });
    } else if (values.kind === 'transfer') {
      await updateTransaction(db, txnId, {
        amount: values.amount,
        bucketId: values.bucketId,
        toBucketId: values.toBucketId ?? null,
        categoryId: null,
        note: values.note ?? null,
        date: values.date,
      });
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

  const confirmDelete = () => {
    Alert.alert('Delete this transaction?', undefined, [
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
    ]);
  };

  if (!txn || !buckets || !categories) return <View style={styles.loading} />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Text style={styles.title}>Edit transaction</Text>
      <TransactionForm
        buckets={buckets}
        categories={categories}
        initialKind={txn.type}
        lockKind
        lockMoney={linked}
        submitLabel="Save changes"
        initialValues={{
          amount: txn.amount,
          bucketId: txn.bucketId,
          toBucketId: txn.toBucketId ?? undefined,
          categoryId: txn.categoryId ?? undefined,
          note: txn.note ?? undefined,
          date: txn.date,
        }}
        onSubmit={save}
      />
      <Text style={styles.deleteLink} onPress={confirmDelete}>
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
  deleteLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
    padding: spacing.md,
  },
});
