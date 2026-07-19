import { eq } from 'drizzle-orm';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmountInput } from '@/components/AmountInput';
import { ChipRow, formStyles, Segmented, SubmitButton } from '@/components/form';
import {
  merchantLabel,
  PendingNotificationCard,
} from '@/components/PendingNotificationCard';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { commitPending, discardPending, listPending, listSources } from '@/db/notificationRepo';
import { buckets as bucketsTable, categories as categoriesTable, PendingNotification } from '@/db/schema';
import { centavosToInput } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

export default function NotificationInboxScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const pending = useAppQuery(listPending);
  const sources = useAppQuery(listSources);
  const activeBuckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const allBuckets = useAppQuery((db) => db.select().from(bucketsTable));
  const allCategories = useAppQuery((db) => db.select().from(categoriesTable));

  const sourceById = new Map((sources ?? []).map((s) => [s.id, s]));
  const bucketById = new Map((allBuckets ?? []).map((b) => [b.id, b]));

  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [editAmount, setEditAmount] = useState<number | null>(null);
  const [editAmountText, setEditAmountText] = useState('');
  const [editType, setEditType] = useState<'expense' | 'income'>('expense');
  const [editBucketId, setEditBucketId] = useState<number | undefined>(undefined);
  const [editCategoryId, setEditCategoryId] = useState<number | undefined>(undefined);
  const [editNote, setEditNote] = useState('');

  const openEdit = (row: PendingNotification) => {
    const source = sourceById.get(row.sourceId);
    // Only prefill the bucket when it's still active; an archived bucket isn't
    // shown as a chip, so the user must pick a visible one before saving.
    const sourceBucketActive = (activeBuckets ?? []).some((b) => b.id === source?.bucketId);
    setEditingId(row.id);
    setEditAmount(row.parsedAmount ?? null);
    setEditAmountText(row.parsedAmount != null ? centavosToInput(row.parsedAmount) : '');
    setEditType(row.parsedType ?? 'expense');
    setEditBucketId(sourceBucketActive ? source?.bucketId : undefined);
    setEditCategoryId(undefined);
    setEditNote(merchantLabel(row));
  };

  const closeEdit = () => setEditingId(undefined);

  const confirmRow = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await commitPending(db, id);
      refresh();
    } catch (e) {
      Alert.alert('Could not confirm', e instanceof Error ? e.message : 'Could not confirm.');
    } finally {
      setBusyId(null);
    }
  };

  const discardRow = (row: PendingNotification) => {
    Alert.alert('Discard?', merchantLabel(row), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          if (busyId !== null) return;
          setBusyId(row.id);
          try {
            await discardPending(db, row.id);
            refresh();
          } catch (e) {
            Alert.alert('Could not discard', e instanceof Error ? e.message : 'Could not discard.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const saveEdit = async () => {
    if (editingId === undefined || editAmount === null || editBucketId === undefined) return;
    if (busyId !== null) return;
    setBusyId(editingId);
    try {
      await commitPending(db, editingId, {
        amount: editAmount,
        bucketId: editBucketId,
        categoryId: editCategoryId,
        note: editNote.trim() || undefined,
        type: editType,
      });
      refresh();
      closeEdit();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusyId(null);
    }
  };

  const editValid = editAmount !== null && editBucketId !== undefined;
  const bucketItems = (activeBuckets ?? []).map((b) => ({ id: b.id, label: b.name, icon: b.icon }));
  const categoryItems = (allCategories ?? [])
    .filter((c) => c.type === editType)
    .map((c) => ({ id: c.id, label: c.name, icon: c.icon }));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {pending !== undefined && pending.length === 0 && (
          <Text style={styles.empty}>No pending notifications.</Text>
        )}
        {(pending ?? []).map((row) => {
          const source = sourceById.get(row.sourceId);
          const bucketName = bucketById.get(source?.bucketId ?? -1)?.name ?? 'Unknown bucket';
          return (
            <PendingNotificationCard
              key={row.id}
              row={row}
              bucketName={bucketName}
              busy={busyId !== null}
              onConfirm={confirmRow}
              onEdit={openEdit}
              onDiscard={discardRow}
            />
          );
        })}
      </ScrollView>

      <Modal
        visible={editingId !== undefined}
        animationType="slide"
        transparent
        onRequestClose={closeEdit}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.header}>
              <Text style={styles.title}>Edit</Text>
              <Pressable onPress={closeEdit} hitSlop={8}>
                <Text style={styles.close}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
              <AmountInput
                key={editingId}
                initialText={editAmountText}
                onChangeAmount={setEditAmount}
                autoFocus={false}
              />
              <Text style={formStyles.label}>Type</Text>
              <Segmented
                options={[
                  { value: 'expense', label: 'Expense' },
                  { value: 'income', label: 'Income' },
                ]}
                value={editType}
                onChange={(value) => {
                  setEditType(value);
                  setEditCategoryId(undefined);
                }}
              />
              <Text style={formStyles.label}>Bucket</Text>
              <ChipRow items={bucketItems} selectedId={editBucketId} onSelect={setEditBucketId} />
              <Text style={formStyles.label}>Category</Text>
              <ChipRow
                items={categoryItems}
                selectedId={editCategoryId}
                onSelect={(id) => setEditCategoryId(editCategoryId === id ? undefined : id)}
              />
              <Text style={formStyles.label}>Note</Text>
              <TextInput
                style={formStyles.textInput}
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Optional"
                placeholderTextColor={colors.inkFaint}
                testID="edit-note"
              />
              <View style={{ height: spacing.xs }} />
              <SubmitButton label="Save" disabled={!editValid || busyId !== null} onPress={saveEdit} />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  close: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkFaint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '90%',
  },
});
