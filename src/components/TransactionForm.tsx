import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Bucket, Category, Recurring } from '@/db/schema';
import { InstallmentWithRemaining } from '@/db/installmentRepo';
import { UtangWithRemaining } from '@/db/utangRepo';
import {
  centavosToInput,
  formatPeso,
  parsePercentInput,
  parsePesoBalanceInput,
  parsePesoInput,
  percentageFee,
} from '@/lib/money';
import { isDueDate } from '@/lib/recurringEngine';
import { AmountInput } from './AmountInput';
import {
  ChipRow,
  FormTextInput,
  KeyboardAwareForm,
  Segmented,
  SIGNED_NUMERIC_KEYBOARD,
  SubmitButton,
  useSubmitGuard,
} from './form';
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
  /** Recurring rule this expense covers, standing in for its auto-post. */
  recurringId?: number;
  /**
   * Fee the sending bucket is charged for this transfer, in centavos. Omitted
   * when there is none — the destination always receives the full `amount`.
   */
  feeAmount?: number;
}

export type FeeMode = 'percent' | 'fixed';

interface Props {
  buckets: Bucket[];
  categories: Category[];
  onSubmit: (values: TransactionFormValues) => void | Promise<void>;
  /** Open debts offered for linking. Hidden when omitted or empty. */
  openUtang?: UtangWithRemaining[];
  /** Open installment plans offered for (advance) payment linking. */
  openInstallments?: InstallmentWithRemaining[];
  /** Active recurring rules offered for linking. Hidden when omitted or empty. */
  activeRecurring?: Recurring[];
  /** Opens the receipt scanner (Task 11). Hidden when omitted. */
  onScanReceipt?: () => void;
  /**
   * Offers the transfer-fee field. Add screen only: the fee is written as its
   * own transaction, which the edit screen has no way to carry along.
   */
  offerTransferFee?: boolean;
  initialKind?: TxnKind;
  initialAmountText?: string;
  initialNote?: string;
  receiptPhotoUri?: string;
  /** Prefill for editing an existing transaction. */
  initialValues?: {
    amount?: number;
    bucketId?: number;
    toBucketId?: number;
    categoryId?: number;
    note?: string;
    date?: string;
  };
  /** Edit mode: the kind of a saved transaction can't change. */
  lockKind?: boolean;
  /** Edit mode for linked transactions: amount and bucket stay as recorded. */
  lockMoney?: boolean;
  submitLabel?: string;
}

const KINDS: { kind: TxnKind; label: string }[] = [
  { kind: 'expense', label: 'Expense' },
  { kind: 'income', label: 'Income' },
  { kind: 'transfer', label: 'Transfer' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FEE_MODES: { value: FeeMode; label: string }[] = [
  { value: 'percent', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed' },
];

export function TransactionForm({
  buckets,
  categories,
  onSubmit,
  openUtang,
  openInstallments,
  activeRecurring,
  onScanReceipt,
  offerTransferFee = false,
  initialKind = 'expense',
  initialAmountText,
  initialNote,
  receiptPhotoUri,
  initialValues,
  lockKind = false,
  lockMoney = false,
  submitLabel = 'Save',
}: Props) {
  const amountText =
    initialValues?.amount !== undefined ? centavosToInput(initialValues.amount) : initialAmountText;
  const [kind, setKind] = useState<TxnKind>(initialKind);
  const [amount, setAmount] = useState<number | null>(
    amountText ? parsePesoInput(amountText) : null,
  );
  const [bucketId, setBucketId] = useState<number | undefined>(
    initialValues?.bucketId ?? buckets[0]?.id,
  );
  const [toBucketId, setToBucketId] = useState<number | undefined>(initialValues?.toBucketId);
  const [categoryId, setCategoryId] = useState<number | undefined>(initialValues?.categoryId);
  const [note, setNote] = useState(initialValues?.note ?? initialNote ?? '');
  const [date, setDate] = useState(initialValues?.date ?? todayLocal());
  const [utangId, setUtangId] = useState<number | undefined>(undefined);
  const [installmentId, setInstallmentId] = useState<number | undefined>(undefined);
  const [recurringId, setRecurringId] = useState<number | undefined>(undefined);
  const [feeMode, setFeeMode] = useState<FeeMode>('percent');
  const [feeText, setFeeText] = useState('');
  const noteRef = useRef<TextInput>(null);

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

  // Recurring rules have no type column and always post as expenses, so there
  // is nothing for an income or a transfer to cover.
  const linkableRecurring = kind === 'expense' ? activeRecurring ?? [] : [];
  const linkedRecurring = linkableRecurring.find((r) => r.id === recurringId);
  // No overpay check exists here on purpose: a rule carries no balance, so any
  // amount is legal — the user's number simply replaces the rule's.

  // The destination receives the full amount either way — a fee is charged to
  // the sender on top, as its own expense — so nothing here touches `amount`.
  // An empty field is the common case and means no fee at all; only a typed
  // value has to parse before the transfer can be saved.
  const showFee = kind === 'transfer' && offerTransferFee;
  const feeInput =
    feeText.trim() === ''
      ? 0
      : feeMode === 'percent'
        ? parsePercentInput(feeText)
        : parsePesoBalanceInput(feeText);
  const feeValid = !showFee || feeInput !== null;
  const fee =
    feeInput === null || amount === null
      ? 0
      : feeMode === 'percent'
        ? percentageFee(amount, feeInput)
        : feeInput;

  const dateValid = DATE_RE.test(date);
  const valid =
    amount !== null &&
    bucketId !== undefined &&
    dateValid &&
    !overpaysLink &&
    !overpaysInstallment &&
    feeValid &&
    (kind !== 'transfer' || (toBucketId !== undefined && toBucketId !== bucketId));

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid || amount === null || bucketId === undefined) return;
    await onSubmit({
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
      recurringId: linkedRecurring?.id,
      feeAmount: showFee && fee > 0 ? fee : undefined,
    });
  });

  return (
    <KeyboardAwareForm>
      <View style={styles.segmented}>
        {KINDS.map(({ kind: k, label }) => (
          <Pressable
            key={k}
            style={[
              styles.segment,
              kind === k && styles.segmentActive,
              lockKind && kind !== k && styles.segmentLocked,
            ]}
            onPress={() => {
              if (lockKind) return;
              setKind(k);
              setCategoryId(undefined);
              setUtangId(undefined);
              setInstallmentId(undefined);
              setRecurringId(undefined);
            }}
            disabled={lockKind && kind !== k}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k, disabled: lockKind && kind !== k }}
            testID={`kind-${k}`}
          >
            <Text style={[styles.segmentText, kind === k && styles.segmentTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <AmountInput
        onChangeAmount={setAmount}
        initialText={amountText}
        autoFocus={!lockMoney}
        editable={!lockMoney}
      />
      {lockMoney && (
        <Text style={styles.linkHint}>
          Linked to a debt/installment payment — amount and bucket stay as recorded.
        </Text>
      )}

      <Text style={styles.label}>{kind === 'transfer' ? 'From' : 'Bucket'}</Text>
      <View pointerEvents={lockMoney ? 'none' : 'auto'} style={lockMoney && styles.locked}>
        <ChipRow
          items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
          selectedId={bucketId}
          onSelect={setBucketId}
          testIDPrefix="bucket"
        />
      </View>

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

      {showFee && (
        <>
          <Text style={styles.label}>Fee (optional)</Text>
          <Segmented options={FEE_MODES} value={feeMode} onChange={setFeeMode} />
          <FormTextInput
            style={[styles.textInput, !feeValid && styles.textInputError]}
            value={feeText}
            onChangeText={setFeeText}
            placeholder={feeMode === 'percent' ? '0.00 %' : '₱0.00'}
            placeholderTextColor={colors.inkFaint}
            keyboardType="decimal-pad"
            testID="fee-input"
          />
          {!feeValid && (
            <Text style={styles.linkError}>
              {feeMode === 'percent' ? 'Invalid percentage — 0 to 100.' : 'Invalid amount.'}
            </Text>
          )}
          {feeValid && fee > 0 && (
            <Text style={styles.linkHint}>
              {formatPeso(fee)} is charged to the sending bucket as its own “Transfer Fee” expense
              — the full {amount !== null ? formatPeso(amount) : 'amount'} still arrives.
            </Text>
          )}
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
              setRecurringId(undefined);
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
              setRecurringId(undefined);
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

      {linkableRecurring.length > 0 && (
        <>
          <Text style={styles.label}>Cover recurring (optional)</Text>
          <ChipRow
            items={linkableRecurring.map((r) => ({
              id: r.id,
              label: `${r.name} · ${formatPeso(r.amount)}`,
              icon: 'repeat',
            }))}
            selectedId={recurringId}
            onSelect={(id) => {
              setRecurringId(recurringId === id ? undefined : id);
              setUtangId(undefined);
              setInstallmentId(undefined);
            }}
            testIDPrefix="recurring"
          />
          {/* The engine dedupes on (recurringId, date), so this link only
              replaces the scheduled posting when the date lands on a due.
              Any other date is perfectly legal — the user gets told what will
              happen rather than being blocked. */}
          {linkedRecurring && dateValid && (
            <Text style={styles.linkHint}>
              {isDueDate(linkedRecurring, date)
                ? 'The scheduled posting for this date will be skipped.'
                : "This date isn't one of this rule's due dates, so the scheduled posting still happens."}
            </Text>
          )}
        </>
      )}

      <Text style={styles.label}>Date</Text>
      <FormTextInput
        style={[styles.textInput, !dateValid && styles.textInputError]}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.inkFaint}
        keyboardType={SIGNED_NUMERIC_KEYBOARD}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => noteRef.current?.focus()}
        testID="date-input"
      />
      {!dateValid && <Text style={styles.linkError}>Invalid date — use YYYY-MM-DD.</Text>}

      <Text style={styles.label}>Note</Text>
      <FormTextInput
        ref={noteRef}
        style={styles.textInput}
        value={note}
        onChangeText={setNote}
        placeholder="Optional"
        placeholderTextColor={colors.inkFaint}
        returnKeyType="done"
        testID="note-input"
      />

      {kind === 'expense' && onScanReceipt && (
        <Pressable style={styles.scanButton} onPress={onScanReceipt} accessibilityRole="button">
          <Icon name="camera" size={16} color={colors.inkDim} />
          <Text style={styles.scanText}>Scan receipt</Text>
        </Pressable>
      )}
      {receiptPhotoUri && (
        <View style={styles.receiptRow}>
          <Image source={{ uri: receiptPhotoUri }} style={styles.receiptThumb} contentFit="cover" />
          <Text style={styles.receiptNote}>Receipt attached ✓</Text>
        </View>
      )}

      <SubmitButton label={submitLabel} disabled={!valid} submitting={submitting} onPress={submit} />
    </KeyboardAwareForm>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: spacing.xs,
    marginBottom: spacing.sm,
  },
  segment: {
    flex: 1,
    // 44 is the minimum comfortable tap target; padding alone gives ~33.
    minHeight: 44,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.surfaceRaised },
  segmentLocked: { opacity: 0.35 },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkFaint },
  segmentTextActive: { color: colors.gold },
  locked: { opacity: 0.55 },
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
});
