import { eq } from 'drizzle-orm';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmountInput } from '@/components/AmountInput';
import { ChipRow, formStyles, Segmented, SubmitButton } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { commitPending, discardPending, listPending, listSources } from '@/db/notificationRepo';
import { buckets as bucketsTable, categories as categoriesTable, PendingNotification } from '@/db/schema';
import { centavosToInput, formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Merchant label with a fallback to a slice of the raw notification text. */
function merchantLabel(row: PendingNotification): string {
  return row.parsedMerchant || row.rawText.slice(0, 60);
}

/** Days left before this row auto-commits, or a discard notice if it has no amount. */
function expiryLabel(row: PendingNotification): string {
  if (row.parsedAmount == null) return 'Will be discarded';
  const daysLeft = Math.max(0, Math.ceil(2 - (Date.now() - Date.parse(row.postedAt)) / DAY_MS));
  return `Auto-logs in ${daysLeft}d`;
}

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

  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [editAmount, setEditAmount] = useState<number | null>(null);
  const [editAmountText, setEditAmountText] = useState('');
  const [editType, setEditType] = useState<'expense' | 'income'>('expense');
  const [editBucketId, setEditBucketId] = useState<number | undefined>(undefined);
  const [editCategoryId, setEditCategoryId] = useState<number | undefined>(undefined);
  const [editNote, setEditNote] = useState('');

  const openEdit = (row: PendingNotification) => {
    const source = sourceById.get(row.sourceId);
    setEditingId(row.id);
    setEditAmount(row.parsedAmount ?? null);
    setEditAmountText(row.parsedAmount != null ? centavosToInput(row.parsedAmount) : '');
    setEditType(row.parsedType ?? 'expense');
    setEditBucketId(source?.bucketId);
    setEditCategoryId(undefined);
    setEditNote(merchantLabel(row));
  };

  const closeEdit = () => setEditingId(undefined);

  const confirmRow = async (id: number) => {
    try {
      await commitPending(db, id);
      refresh();
    } catch (e) {
      Alert.alert('Could not confirm', e instanceof Error ? e.message : 'Could not confirm.');
    }
  };

  const discardRow = (row: PendingNotification) => {
    Alert.alert('Discard?', merchantLabel(row), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          try {
            await discardPending(db, row.id);
            refresh();
          } catch (e) {
            Alert.alert('Could not discard', e instanceof Error ? e.message : 'Could not discard.');
          }
        },
      },
    ]);
  };

  const saveEdit = async () => {
    if (editingId === undefined || editAmount === null || editBucketId === undefined) return;
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
          const directionLabel =
            row.parsedType === 'expense' ? 'Expense' : row.parsedType === 'income' ? 'Income' : '?';
          return (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.merchant} numberOfLines={1}>
                  {merchantLabel(row)}
                </Text>
                <Text style={styles.amount}>
                  {row.parsedAmount != null ? formatPeso(row.parsedAmount) : 'No amount'}
                </Text>
              </View>
              <Text style={styles.sub}>
                {directionLabel} · {bucketName} · {row.postedAt.slice(0, 10)}
              </Text>
              <Text style={styles.expiry}>{expiryLabel(row)}</Text>
              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.actionBtn, styles.confirmBtn]}
                  onPress={() => confirmRow(row.id)}
                  disabled={row.parsedAmount == null}
                  accessibilityRole="button"
                  testID={`confirm-${row.id}`}
                >
                  <Text style={[styles.actionText, styles.confirmText]}>Confirm</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.editBtn]}
                  onPress={() => openEdit(row)}
                  accessibilityRole="button"
                  testID={`edit-${row.id}`}
                >
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.discardBtn]}
                  onPress={() => discardRow(row)}
                  accessibilityRole="button"
                  testID={`discard-${row.id}`}
                >
                  <Text style={[styles.actionText, styles.discardText]}>Discard</Text>
                </Pressable>
              </View>
            </View>
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
              <SubmitButton label="Save" disabled={!editValid} onPress={saveEdit} />
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
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  merchant: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
  expiry: { fontFamily: fonts.body, fontSize: 12, color: colors.gold },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: {
    flex: 1,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
  },
  confirmBtn: { backgroundColor: colors.gold, borderColor: colors.gold },
  editBtn: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  discardBtn: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  confirmText: { color: colors.bg },
  discardText: { color: colors.danger },
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
