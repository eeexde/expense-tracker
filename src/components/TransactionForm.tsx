import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Bucket, Category } from '@/db/schema';
import { parsePesoInput } from '@/lib/money';
import { AmountInput } from './AmountInput';
import { colors, fonts, radii, spacing, todayLocal } from '@/theme';

export type TxnKind = 'expense' | 'income' | 'transfer';

export interface TransactionFormValues {
  kind: TxnKind;
  amount: number;
  bucketId: number;
  toBucketId?: number;
  categoryId?: number;
  note?: string;
  date: string;
  receiptPhotoUri?: string;
}

interface Props {
  buckets: Bucket[];
  categories: Category[];
  onSubmit: (values: TransactionFormValues) => void;
  /** Opens the receipt scanner (Task 11). Hidden when omitted. */
  onScanReceipt?: () => void;
  initialKind?: TxnKind;
  initialAmountText?: string;
  initialNote?: string;
  receiptPhotoUri?: string;
}

const KINDS: { kind: TxnKind; label: string }[] = [
  { kind: 'expense', label: 'Gastos' },
  { kind: 'income', label: 'Kita' },
  { kind: 'transfer', label: 'Transfer' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function TransactionForm({
  buckets,
  categories,
  onSubmit,
  onScanReceipt,
  initialKind = 'expense',
  initialAmountText,
  initialNote,
  receiptPhotoUri,
}: Props) {
  const [kind, setKind] = useState<TxnKind>(initialKind);
  const [amount, setAmount] = useState<number | null>(
    initialAmountText ? parsePesoInput(initialAmountText) : null,
  );
  const [bucketId, setBucketId] = useState<number | undefined>(buckets[0]?.id);
  const [toBucketId, setToBucketId] = useState<number | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [note, setNote] = useState(initialNote ?? '');
  const [date, setDate] = useState(todayLocal());

  const kindCategories = useMemo(
    () => categories.filter((c) => c.type === (kind === 'income' ? 'income' : 'expense')),
    [categories, kind],
  );

  const dateValid = DATE_RE.test(date);
  const valid =
    amount !== null &&
    bucketId !== undefined &&
    dateValid &&
    (kind !== 'transfer' || (toBucketId !== undefined && toBucketId !== bucketId));

  const submit = () => {
    if (!valid || amount === null || bucketId === undefined) return;
    onSubmit({
      kind,
      amount,
      bucketId,
      toBucketId: kind === 'transfer' ? toBucketId : undefined,
      categoryId: kind === 'transfer' ? undefined : categoryId,
      note: note.trim() || undefined,
      date,
      receiptPhotoUri,
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.segmented}>
        {KINDS.map(({ kind: k, label }) => (
          <Pressable
            key={k}
            style={[styles.segment, kind === k && styles.segmentActive]}
            onPress={() => {
              setKind(k);
              setCategoryId(undefined);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k }}
            testID={`kind-${k}`}
          >
            <Text style={[styles.segmentText, kind === k && styles.segmentTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <AmountInput onChangeAmount={setAmount} initialText={initialAmountText} autoFocus />

      <Text style={styles.label}>{kind === 'transfer' ? 'Mula sa' : 'Bucket'}</Text>
      <ChipRow
        items={buckets.map((b) => ({ id: b.id, label: `${b.icon} ${b.name}` }))}
        selectedId={bucketId}
        onSelect={setBucketId}
        testIDPrefix="bucket"
      />

      {kind === 'transfer' && (
        <>
          <Text style={styles.label}>Papunta sa</Text>
          <ChipRow
            items={buckets
              .filter((b) => b.id !== bucketId)
              .map((b) => ({ id: b.id, label: `${b.icon} ${b.name}` }))}
            selectedId={toBucketId}
            onSelect={setToBucketId}
            testIDPrefix="to-bucket"
          />
        </>
      )}

      {kind !== 'transfer' && (
        <>
          <Text style={styles.label}>Category</Text>
          <ChipRow
            items={kindCategories.map((c) => ({ id: c.id, label: `${c.icon} ${c.name}` }))}
            selectedId={categoryId}
            onSelect={(id) => setCategoryId(categoryId === id ? undefined : id)}
            testIDPrefix="category"
          />
        </>
      )}

      <Text style={styles.label}>Petsa</Text>
      <TextInput
        style={[styles.textInput, !dateValid && styles.textInputError]}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.inkFaint}
        testID="date-input"
      />

      <Text style={styles.label}>Note</Text>
      <TextInput
        style={styles.textInput}
        value={note}
        onChangeText={setNote}
        placeholder="Optional"
        placeholderTextColor={colors.inkFaint}
        testID="note-input"
      />

      {kind === 'expense' && onScanReceipt && (
        <Pressable style={styles.scanButton} onPress={onScanReceipt} accessibilityRole="button">
          <Text style={styles.scanText}>📷 I-scan ang resibo</Text>
        </Pressable>
      )}
      {receiptPhotoUri && <Text style={styles.receiptNote}>Resibo naka-attach ✓</Text>}

      <Pressable
        style={[styles.submit, !valid && styles.submitDisabled]}
        onPress={submit}
        disabled={!valid}
        accessibilityRole="button"
        testID="submit"
      >
        <Text style={styles.submitText}>I-save</Text>
      </Pressable>
    </ScrollView>
  );
}

function ChipRow({
  items,
  selectedId,
  onSelect,
  testIDPrefix,
}: {
  items: { id: number; label: string }[];
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.chipRow}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            style={[styles.chip, selected && styles.chipActive]}
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            testID={`${testIDPrefix}-${item.id}`}
          >
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: spacing.xs,
    marginBottom: spacing.sm,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: colors.surfaceRaised },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkFaint },
  segmentTextActive: { color: colors.gold },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipActive: { backgroundColor: colors.surfaceRaised, borderColor: colors.gold },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkDim },
  chipTextActive: { color: colors.ink },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm + spacing.xs,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  textInputError: { borderColor: colors.danger },
  scanButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  scanText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkDim },
  receiptNote: { fontFamily: fonts.body, fontSize: 13, color: colors.income },
  submit: {
    backgroundColor: colors.gold,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitDisabled: { opacity: 0.35 },
  submitText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.bg },
});
