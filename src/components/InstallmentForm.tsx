import { useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Bucket } from '@/db/schema';
import { centavosToInput, formatPeso, parsePesoInput } from '@/lib/money';
import {
  ChipRow,
  FormTextInput,
  formStyles,
  KeyboardAwareForm,
  NUMERIC_PAD_HAS_RETURN_KEY,
  NUMERIC_PAD_NEXT,
  SubmitButton,
  useSubmitGuard,
} from './form';
import { colors } from '@/theme';

export interface InstallmentFormValues {
  itemName: string;
  monthlyDue: number;
  monthsTotal: number;
  dayDue: number;
  bucketId: number;
}

const AMOUNT_ERROR = 'Invalid amount — use numbers like 1200.50.';
const MONTHS_ERROR = 'Months must be a whole number from 1 to 60.';
const DAY_ERROR = 'Day must be a whole number from 1 to 31.';

interface Props {
  buckets: Bucket[];
  initial?: InstallmentFormValues;
  /** Centavos already paid — the plan total can't be edited below this. */
  amountPaid?: number;
  onSubmit: (values: InstallmentFormValues) => void | Promise<void>;
}

/** Shared by the add and edit installment screens. */
export function InstallmentForm({ buckets, initial, amountPaid = 0, onSubmit }: Props) {
  const [itemName, setItemName] = useState(initial?.itemName ?? '');
  const [monthlyText, setMonthlyText] = useState(
    initial ? centavosToInput(initial.monthlyDue) : '',
  );
  const [monthsText, setMonthsText] = useState(initial ? String(initial.monthsTotal) : '');
  const [dayDueText, setDayDueText] = useState(initial ? String(initial.dayDue) : '15');
  const [bucketId, setBucketId] = useState<number | undefined>(initial?.bucketId);
  const monthlyRef = useRef<TextInput>(null);
  const monthsRef = useRef<TextInput>(null);
  const dayDueRef = useRef<TextInput>(null);

  const monthlyDue = parsePesoInput(monthlyText);
  const monthsTotal = Number(monthsText);
  const dayDue = Number(dayDueText);
  const monthsValid = Number.isInteger(monthsTotal) && monthsTotal >= 1 && monthsTotal <= 60;
  const dayValid = Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31;
  const monthlyInvalid = monthlyText.trim() !== '' && monthlyDue === null;
  const monthsInvalid = monthsText.trim() !== '' && !monthsValid;
  const total = monthlyDue !== null && monthsValid ? monthlyDue * monthsTotal : null;
  const belowPaid = total !== null && total < amountPaid;
  const valid =
    itemName.trim() !== '' &&
    monthlyDue !== null &&
    monthsValid &&
    dayValid &&
    bucketId !== undefined &&
    !belowPaid;

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid || monthlyDue === null || bucketId === undefined) return;
    await onSubmit({ itemName: itemName.trim(), monthlyDue, monthsTotal, dayDue, bucketId });
  });

  return (
    <KeyboardAwareForm>
      <Text style={formStyles.label}>Item</Text>
      <FormTextInput
        style={formStyles.textInput}
        value={itemName}
        onChangeText={setItemName}
        placeholder="e.g. Washing machine (Home Credit)"
        placeholderTextColor={colors.inkFaint}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => monthlyRef.current?.focus()}
      />

      <Text style={formStyles.label}>Monthly payment</Text>
      <FormTextInput
        ref={monthlyRef}
        style={[formStyles.textInput, monthlyInvalid && formStyles.textInputError]}
        value={monthlyText}
        onChangeText={setMonthlyText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
        accessibilityLabel="Monthly payment"
        accessibilityHint={monthlyInvalid ? AMOUNT_ERROR : undefined}
        {...(NUMERIC_PAD_HAS_RETURN_KEY
          ? { ...NUMERIC_PAD_NEXT, onSubmitEditing: () => monthsRef.current?.focus() }
          : null)}
      />
      {monthlyInvalid && <Text style={errorHint}>{AMOUNT_ERROR}</Text>}

      <Text style={formStyles.label}>Number of months</Text>
      <FormTextInput
        ref={monthsRef}
        style={[formStyles.textInput, monthsInvalid && formStyles.textInputError]}
        value={monthsText}
        onChangeText={setMonthsText}
        placeholder="e.g. 12"
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
        accessibilityLabel="Number of months"
        accessibilityHint={monthsInvalid ? MONTHS_ERROR : undefined}
        {...(NUMERIC_PAD_HAS_RETURN_KEY
          ? { ...NUMERIC_PAD_NEXT, onSubmitEditing: () => dayDueRef.current?.focus() }
          : null)}
      />
      {monthsInvalid && <Text style={errorHint}>{MONTHS_ERROR}</Text>}

      {total !== null && (
        <Text style={belowPaid ? errorHint : hint}>
          {belowPaid
            ? `New total ${formatPeso(total)} is below the ${formatPeso(amountPaid)} already paid.`
            : `Total: ${formatPeso(total)}`}
        </Text>
      )}

      <Text style={formStyles.label}>Day of month (1–31)</Text>
      <FormTextInput
        ref={dayDueRef}
        style={[formStyles.textInput, !dayValid && formStyles.textInputError]}
        value={dayDueText}
        onChangeText={setDayDueText}
        keyboardType="number-pad"
        accessibilityLabel="Day of month (1 to 31)"
        accessibilityHint={dayValid ? undefined : DAY_ERROR}
      />
      {!dayValid && <Text style={errorHint}>{DAY_ERROR}</Text>}

      <Text style={formStyles.label}>From bucket</Text>
      <ChipRow
        items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
        selectedId={bucketId}
        onSelect={setBucketId}
      />

      <SubmitButton label="Save" disabled={!valid} submitting={submitting} onPress={submit} />
    </KeyboardAwareForm>
  );
}

const hint = { color: colors.inkFaint, fontSize: 13, marginTop: 4 };
const errorHint = { color: colors.danger, fontSize: 13, marginTop: 4 };
