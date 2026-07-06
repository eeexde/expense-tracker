import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { Bucket } from '@/db/schema';
import { centavosToInput, formatPeso, parsePesoInput } from '@/lib/money';
import { ChipRow, formStyles, SubmitButton } from './form';
import { colors } from '@/theme';

export interface InstallmentFormValues {
  itemName: string;
  monthlyDue: number;
  monthsTotal: number;
  dayDue: number;
  bucketId: number;
}

interface Props {
  buckets: Bucket[];
  initial?: InstallmentFormValues;
  /** Centavos already paid — the plan total can't be edited below this. */
  amountPaid?: number;
  onSubmit: (values: InstallmentFormValues) => void;
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

  const monthlyDue = parsePesoInput(monthlyText);
  const monthsTotal = Number(monthsText);
  const dayDue = Number(dayDueText);
  const monthsValid = Number.isInteger(monthsTotal) && monthsTotal >= 1 && monthsTotal <= 60;
  const dayValid = Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31;
  const total = monthlyDue !== null && monthsValid ? monthlyDue * monthsTotal : null;
  const belowPaid = total !== null && total < amountPaid;
  const valid =
    itemName.trim() !== '' &&
    monthlyDue !== null &&
    monthsValid &&
    dayValid &&
    bucketId !== undefined &&
    !belowPaid;

  const submit = () => {
    if (!valid || monthlyDue === null || bucketId === undefined) return;
    onSubmit({ itemName: itemName.trim(), monthlyDue, monthsTotal, dayDue, bucketId });
  };

  return (
    <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={formStyles.label}>Item</Text>
      <TextInput
        style={formStyles.textInput}
        value={itemName}
        onChangeText={setItemName}
        placeholder="e.g. Washing machine (Home Credit)"
        placeholderTextColor={colors.inkFaint}
      />

      <Text style={formStyles.label}>Monthly payment</Text>
      <TextInput
        style={[
          formStyles.textInput,
          monthlyText.trim() !== '' && monthlyDue === null && formStyles.textInputError,
        ]}
        value={monthlyText}
        onChangeText={setMonthlyText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
      />

      <Text style={formStyles.label}>Number of months</Text>
      <TextInput
        style={[
          formStyles.textInput,
          monthsText.trim() !== '' && !monthsValid && formStyles.textInputError,
        ]}
        value={monthsText}
        onChangeText={setMonthsText}
        placeholder="e.g. 12"
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
      />

      {total !== null && (
        <Text style={belowPaid ? errorHint : hint}>
          {belowPaid
            ? `New total ${formatPeso(total)} is below the ${formatPeso(amountPaid)} already paid.`
            : `Total: ${formatPeso(total)}`}
        </Text>
      )}

      <Text style={formStyles.label}>Day of month (1–31)</Text>
      <TextInput
        style={[formStyles.textInput, !dayValid && formStyles.textInputError]}
        value={dayDueText}
        onChangeText={setDayDueText}
        keyboardType="number-pad"
      />

      <Text style={formStyles.label}>From bucket</Text>
      <ChipRow
        items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
        selectedId={bucketId}
        onSelect={setBucketId}
      />

      <SubmitButton label="Save" disabled={!valid} onPress={submit} />
    </ScrollView>
  );
}

const hint = { color: colors.inkFaint, fontSize: 13, marginTop: 4 };
const errorHint = { color: colors.danger, fontSize: 13, marginTop: 4 };
