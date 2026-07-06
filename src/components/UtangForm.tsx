import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { centavosToInput, formatPeso, parsePesoInput } from '@/lib/money';
import { formStyles, Segmented, SubmitButton } from './form';
import { colors } from '@/theme';

export interface UtangFormValues {
  personName: string;
  direction: 'iOwe' | 'owedToMe';
  originalAmount: number;
  note?: string;
}

interface Props {
  initial?: UtangFormValues;
  /** Centavos already paid — the amount can't drop below this, direction locks. */
  paid?: number;
  onSubmit: (values: UtangFormValues) => void;
}

/** Shared by the add and edit utang screens. */
export function UtangForm({ initial, paid = 0, onSubmit }: Props) {
  const [personName, setPersonName] = useState(initial?.personName ?? '');
  const [direction, setDirection] = useState<'iOwe' | 'owedToMe'>(initial?.direction ?? 'iOwe');
  const [amountText, setAmountText] = useState(
    initial ? centavosToInput(initial.originalAmount) : '',
  );
  const [note, setNote] = useState(initial?.note ?? '');

  const directionLocked = paid > 0;
  const amount = parsePesoInput(amountText);
  const belowPaid = amount !== null && amount < paid;
  const valid = personName.trim() !== '' && amount !== null && !belowPaid;

  const submit = () => {
    if (!valid || amount === null) return;
    onSubmit({
      personName: personName.trim(),
      direction,
      originalAmount: amount,
      note: note.trim() || undefined,
    });
  };

  return (
    <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Segmented
        options={[
          { value: 'iOwe', label: 'I owe' },
          { value: 'owedToMe', label: 'Owed to me' },
        ]}
        value={direction}
        onChange={(v) => {
          if (!directionLocked) setDirection(v);
        }}
      />
      {directionLocked && (
        <Text style={hint}>Direction is locked — a payment already exists.</Text>
      )}

      <Text style={formStyles.label}>{direction === 'iOwe' ? 'Who I owe' : 'Who owes me'}</Text>
      <TextInput
        style={formStyles.textInput}
        value={personName}
        onChangeText={setPersonName}
        placeholder="Name"
        placeholderTextColor={colors.inkFaint}
      />

      <Text style={formStyles.label}>Amount</Text>
      <TextInput
        style={[
          formStyles.textInput,
          amountText.trim() !== '' && amount === null && formStyles.textInputError,
          belowPaid && formStyles.textInputError,
        ]}
        value={amountText}
        onChangeText={setAmountText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
      />
      {belowPaid && (
        <Text style={errorHint}>Amount is below the {formatPeso(paid)} already paid.</Text>
      )}

      <Text style={formStyles.label}>Note</Text>
      <TextInput
        style={formStyles.textInput}
        value={note}
        onChangeText={setNote}
        placeholder="Optional"
        placeholderTextColor={colors.inkFaint}
      />

      <SubmitButton label="Save" disabled={!valid} onPress={submit} />
    </ScrollView>
  );
}

const hint = { color: colors.inkFaint, fontSize: 13, marginTop: 4 };
const errorHint = { color: colors.danger, fontSize: 13, marginTop: 4 };
