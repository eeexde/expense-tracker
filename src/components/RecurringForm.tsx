import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { Bucket, Category } from '@/db/schema';
import { centavosToInput, parsePesoInput } from '@/lib/money';
import { ChipRow, formStyles, Segmented, SubmitButton } from './form';
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
  onSubmit: (values: RecurringFormValues) => void;
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

  const amount = parsePesoInput(amountText);
  const dayDue = frequency === 'monthly' ? Number(dayDueText) : weekday;
  const dayDueValid =
    frequency === 'weekly' || (Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31);
  const valid = name.trim() !== '' && amount !== null && bucketId !== undefined && dayDueValid;

  const submit = () => {
    if (!valid || amount === null || bucketId === undefined) return;
    onSubmit({ name: name.trim(), amount, frequency, dayDue, bucketId, categoryId });
  };

  return (
    <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={formStyles.label}>Name</Text>
      <TextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Electricity"
        placeholderTextColor={colors.inkFaint}
      />

      <Text style={formStyles.label}>Amount</Text>
      <TextInput
        style={[
          formStyles.textInput,
          amountText.trim() !== '' && amount === null && formStyles.textInputError,
        ]}
        value={amountText}
        onChangeText={setAmountText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
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
          <TextInput
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

      <SubmitButton label="Save" disabled={!valid} onPress={submit} />
    </ScrollView>
  );
}
