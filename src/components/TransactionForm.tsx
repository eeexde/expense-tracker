import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Bucket, Category } from '@/db/schema';
import { InstallmentWithRemaining } from '@/db/installmentRepo';
import { UtangWithRemaining } from '@/db/utangRepo';
import { formatPeso, parsePesoInput } from '@/lib/money';
import { AmountInput } from './AmountInput';
import { AnimatedPressable } from './AnimatedPressable';
import { ChipRow } from './form';
import { Icon } from './Icon';
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
  /** Open utang this expense/income pays down. */
  utangId?: number;
  /** Installment plan this expense pays (advance payments welcome). */
  installmentId?: number;
}

interface Props {
  buckets: Bucket[];
  categories: Category[];
  onSubmit: (values: TransactionFormValues) => void;
  /** Open debts offered for linking. Hidden when omitted or empty. */
  openUtang?: UtangWithRemaining[];
  /** Open installment plans offered for (advance) payment linking. */
  openInstallments?: InstallmentWithRemaining[];
  /** Opens the receipt scanner (Task 11). Hidden when omitted. */
  onScanReceipt?: () => void;
  initialKind?: TxnKind;
  initialAmountText?: string;
  initialNote?: string;
  receiptPhotoUri?: string;
}

const KINDS: { kind: TxnKind; label: string }[] = [
  { kind: 'expense', label: 'Expense' },
  { kind: 'income', label: 'Income' },
  { kind: 'transfer', label: 'Transfer' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function TransactionForm({
  buckets,
  categories,
  onSubmit,
  openUtang,
  openInstallments,
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
  const [utangId, setUtangId] = useState<number | undefined>(undefined);
  const [installmentId, setInstallmentId] = useState<number | undefined>(undefined);

  const kindCategories = useMemo(
    () => categories.filter((c) => c.type === (kind === 'income' ? 'income' : 'expense')),
    [categories, kind],
  );

  // Expenses pay down my own debts; incomes collect what's owed to me.
  const linkableUtang = useMemo(
    () =>
      kind === 'transfer'
        ? []
        : (openUtang ?? []).filter(
            (u) => u.direction === (kind === 'expense' ? 'iOwe' : 'owedToMe'),
          ),
    [openUtang, kind],
  );
  const linkedUtang = linkableUtang.find((u) => u.id === utangId);
  const overpaysLink = linkedUtang !== undefined && amount !== null && amount > linkedUtang.remaining;

  // Installment payments are always expenses.
  const linkableInstallments = kind === 'expense' ? openInstallments ?? [] : [];
  const linkedInstallment = linkableInstallments.find((p) => p.id === installmentId);
  const overpaysInstallment =
    linkedInstallment !== undefined && amount !== null && amount > linkedInstallment.remaining;

  const dateValid = DATE_RE.test(date);
  const valid =
    amount !== null &&
    bucketId !== undefined &&
    dateValid &&
    !overpaysLink &&
    !overpaysInstallment &&
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
      utangId: linkedUtang?.id,
      installmentId: linkedInstallment?.id,
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
          <KindSegment
            key={k}
            selected={kind === k}
            onPress={() => {
              setKind(k);
              setCategoryId(undefined);
              setUtangId(undefined);
              setInstallmentId(undefined);
            }}
            testID={`kind-${k}`}
          >
            <Text style={[styles.segmentText, kind === k && styles.segmentTextActive]}>
              {label}
            </Text>
          </KindSegment>
        ))}
      </View>

      <AmountInput onChangeAmount={setAmount} initialText={initialAmountText} autoFocus />

      <Text style={styles.label}>{kind === 'transfer' ? 'From' : 'Bucket'}</Text>
      <ChipRow
        items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
        selectedId={bucketId}
        onSelect={setBucketId}
        testIDPrefix="bucket"
      />

      {kind === 'transfer' && (
        <>
          <Text style={styles.label}>To</Text>
          <ChipRow
            items={buckets
              .filter((b) => b.id !== bucketId)
              .map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
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
            items={kindCategories.map((c) => ({ id: c.id, label: c.name, icon: c.icon }))}
            selectedId={categoryId}
            onSelect={(id) => setCategoryId(categoryId === id ? undefined : id)}
            testIDPrefix="category"
          />
        </>
      )}

      {linkableUtang.length > 0 && (
        <>
          <Text style={styles.label}>Link to debt (optional)</Text>
          <ChipRow
            items={linkableUtang.map((u) => ({
              id: u.id,
              label: `${u.personName} · ${formatPeso(u.remaining)}`,
              icon: 'users',
            }))}
            selectedId={utangId}
            onSelect={(id) => {
              setUtangId(utangId === id ? undefined : id);
              setInstallmentId(undefined);
            }}
            testIDPrefix="utang"
          />
          {overpaysLink && (
            <Text style={styles.linkError}>Amount exceeds the remaining balance.</Text>
          )}
        </>
      )}

      {linkableInstallments.length > 0 && (
        <>
          <Text style={styles.label}>Pay installment (optional)</Text>
          <ChipRow
            items={linkableInstallments.map((p) => ({
              id: p.id,
              label: `${p.itemName} · ${formatPeso(p.remaining)}`,
              icon: 'calendar',
            }))}
            selectedId={installmentId}
            onSelect={(id) => {
              setInstallmentId(installmentId === id ? undefined : id);
              setUtangId(undefined);
            }}
            testIDPrefix="installment"
          />
          {linkedInstallment && !overpaysInstallment && (
            <Text style={styles.linkHint}>
              Paying ahead is fine — future months are skipped automatically.
            </Text>
          )}
          {overpaysInstallment && (
            <Text style={styles.linkError}>Amount exceeds the remaining balance.</Text>
          )}
        </>
      )}

      <Text style={styles.label}>Date</Text>
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
        <AnimatedPressable style={styles.scanButton} onPress={onScanReceipt} accessibilityRole="button">
          <Icon name="camera" size={16} color={colors.inkDim} />
          <Text style={styles.scanText}>Scan receipt</Text>
        </AnimatedPressable>
      )}
      {receiptPhotoUri && (
        <View style={styles.receiptRow}>
          <Image source={{ uri: receiptPhotoUri }} style={styles.receiptThumb} contentFit="cover" />
          <Text style={styles.receiptNote}>Receipt attached ✓</Text>
        </View>
      )}

      <AnimatedPressable
        scaleTo={0.97}
        style={[styles.submit, !valid && styles.submitDisabled]}
        onPress={submit}
        disabled={!valid}
        accessibilityRole="button"
        testID="submit"
      >
        <Text style={styles.submitText}>Save</Text>
      </AnimatedPressable>
    </ScrollView>
  );
}

function KindSegment({
  selected,
  onPress,
  testID,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  const activeStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(selected ? colors.surfaceRaised : 'transparent', { duration: 150 }),
  }));
  return (
    <AnimatedPressable
      style={[styles.segment, activeStyle]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
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
  linkError: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  linkHint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  scanButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  scanText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkDim },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  receiptThumb: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
