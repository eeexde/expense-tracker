import { useRef, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Bucket, Category } from '@/db/schema';
import { centavosToInput, parsePesoInput } from '@/lib/money';
import {
  ChipRow,
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface RecurringFormValues {
  name: string;
  amount: number;
  frequency: 'monthly' | 'weekly';
  /** monthly: 1-31. weekly: 0-6, Sunday=0. */
  dayDue: number;
  bucketId: number;
  categoryId?: number;
}

interface Props {
  buckets: Bucket[];
  categories: Category[];
  initial?: RecurringFormValues;
  onSubmit: (values: RecurringFormValues) => void | Promise<void>;
}

/** Shared by the add and edit recurring screens. */
export function RecurringForm({ buckets, categories, initial, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amountText, setAmountText] = useState(
    initial ? centavosToInput(initial.amount) : '',
  );
  const [frequency, setFrequency] = useState<'monthly' | 'weekly'>(initial?.frequency ?? 'monthly');
  const [dayDueText, setDayDueText] = useState(
    initial && initial.frequency === 'monthly' ? String(initial.dayDue) : '1',
  );
  const [weekday, setWeekday] = useState(
    initial && initial.frequency === 'weekly' ? initial.dayDue : 1, // Monday
  );
  const [bucketId, setBucketId] = useState<number | undefined>(initial?.bucketId);
  const [categoryId, setCategoryId] = useState<number | undefined>(initial?.categoryId);
  const amountRef = useRef<TextInput>(null);
  const dayDueRef = useRef<TextInput>(null);

  const amount = parsePesoInput(amountText);
  const dayDue = frequency === 'monthly' ? Number(dayDueText) : weekday;
  const dayDueValid =
    frequency === 'weekly' || (Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31);
  const valid = name.trim() !== '' && amount !== null && bucketId !== undefined && dayDueValid;

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid || amount === null || bucketId === undefined) return;
    await onSubmit({ name: name.trim(), amount, frequency, dayDue, bucketId, categoryId });
  });

  return (
    <KeyboardAwareForm>
      <Text style={formStyles.label}>Name</Text>
      <FormTextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Electricity"
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
          amountText.trim() !== '' && amount === null && formStyles.textInputError,
        ]}
        value={amountText}
        onChangeText={setAmountText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
        // Weekly mode picks the day from chips, so there is no next field to jump to.
        {...(NUMERIC_PAD_HAS_RETURN_KEY && frequency === 'monthly'
          ? { ...NUMERIC_PAD_NEXT, onSubmitEditing: () => dayDueRef.current?.focus() }
          : null)}
      />

      <Text style={formStyles.label}>How often</Text>
      <Segmented
        options={[
          { value: 'monthly', label: 'Monthly' },
          { value: 'weekly', label: 'Weekly' },
        ]}
        value={frequency}
        onChange={setFrequency}
      />

      {frequency === 'monthly' ? (
        <>
          <Text style={formStyles.label}>Day of month (1–31)</Text>
          <FormTextInput
            ref={dayDueRef}
            style={[formStyles.textInput, !dayDueValid && formStyles.textInputError]}
            value={dayDueText}
            onChangeText={setDayDueText}
            keyboardType="number-pad"
          />
        </>
      ) : (
        <>
          <Text style={formStyles.label}>Day of week</Text>
          <ChipRow
            items={WEEKDAYS.map((label, i) => ({ id: i, label }))}
            selectedId={weekday}
            onSelect={setWeekday}
          />
        </>
      )}

      <Text style={formStyles.label}>From bucket</Text>
      <ChipRow
        items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
        selectedId={bucketId}
        onSelect={setBucketId}
      />

      <Text style={formStyles.label}>Category</Text>
      <ChipRow
        items={categories.map((c) => ({ id: c.id, label: c.name, icon: c.icon }))}
        selectedId={categoryId}
        onSelect={(id) => setCategoryId(categoryId === id ? undefined : id)}
      />

      <SubmitButton label="Save" disabled={!valid} submitting={submitting} onPress={submit} />
    </KeyboardAwareForm>
  );
}
