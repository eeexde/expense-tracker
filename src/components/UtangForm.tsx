import { useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { centavosToInput, formatPeso, parsePesoInput } from '@/lib/money';
import {
  FormTextInput,
  formStyles,
  KeyboardAwareForm,
  NUMERIC_PAD_HAS_RETURN_KEY,
  NUMERIC_PAD_NEXT,
  Segmented,
  SubmitButton,
  useSubmitGuard,
} from './form';
import { colors } from '@/theme';

export interface UtangFormValues {
  personName: string;
  direction: 'iOwe' | 'owedToMe';
  originalAmount: number;
  note?: string;
}

const AMOUNT_ERROR = 'Invalid amount — use numbers like 1200.50.';

interface Props {
  initial?: UtangFormValues;
  /** Centavos already paid — the amount can't drop below this, direction locks. */
  paid?: number;
  onSubmit: (values: UtangFormValues) => void | Promise<void>;
}

/** Shared by the add and edit utang screens. */
export function UtangForm({ initial, paid = 0, onSubmit }: Props) {
  const [personName, setPersonName] = useState(initial?.personName ?? '');
  const [direction, setDirection] = useState<'iOwe' | 'owedToMe'>(initial?.direction ?? 'iOwe');
  const [amountText, setAmountText] = useState(
    initial ? centavosToInput(initial.originalAmount) : '',
  );
  const [note, setNote] = useState(initial?.note ?? '');
  const amountRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);

  const directionLocked = paid > 0;
  const amount = parsePesoInput(amountText);
  const amountInvalid = amountText.trim() !== '' && amount === null;
  const belowPaid = amount !== null && amount < paid;
  const belowPaidMessage = `Amount is below the ${formatPeso(paid)} already paid.`;
  const valid = personName.trim() !== '' && amount !== null && !belowPaid;

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid || amount === null) return;
    await onSubmit({
      personName: personName.trim(),
      direction,
      originalAmount: amount,
      note: note.trim() || undefined,
    });
  });

  return (
    <KeyboardAwareForm>
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
      <FormTextInput
        style={formStyles.textInput}
        value={personName}
        onChangeText={setPersonName}
        placeholder="Name"
        placeholderTextColor={colors.inkFaint}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => amountRef.current?.focus()}
      />

      <Text style={formStyles.label}>Amount</Text>
      <FormTextInput
        ref={amountRef}
        style={[
          formStyles.textInput,
          (amountInvalid || belowPaid) && formStyles.textInputError,
        ]}
        value={amountText}
        onChangeText={setAmountText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
        accessibilityLabel="Amount"
        accessibilityHint={
          amountInvalid ? AMOUNT_ERROR : belowPaid ? belowPaidMessage : undefined
        }
        {...(NUMERIC_PAD_HAS_RETURN_KEY
          ? { ...NUMERIC_PAD_NEXT, onSubmitEditing: () => noteRef.current?.focus() }
          : null)}
      />
      {amountInvalid && <Text style={errorHint}>{AMOUNT_ERROR}</Text>}
      {belowPaid && <Text style={errorHint}>{belowPaidMessage}</Text>}

      <Text style={formStyles.label}>Note</Text>
      <FormTextInput
        ref={noteRef}
        style={formStyles.textInput}
        value={note}
        onChangeText={setNote}
        placeholder="Optional"
        placeholderTextColor={colors.inkFaint}
        returnKeyType="done"
      />

      <SubmitButton label="Save" disabled={!valid} submitting={submitting} onPress={submit} />
    </KeyboardAwareForm>
  );
}

const hint = { color: colors.inkFaint, fontSize: 13, marginTop: 4 };
const errorHint = { color: colors.danger, fontSize: 13, marginTop: 4 };
