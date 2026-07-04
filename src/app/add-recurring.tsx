import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { ChipRow, formStyles, Segmented, SubmitButton } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { buckets as bucketsTable, categories as categoriesTable, recurring } from '@/db/schema';
import { parsePesoInput } from '@/lib/money';
import { runCatchUp } from '@/lib/recurringEngine';
import { colors, todayLocal } from '@/theme';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AddRecurringScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'weekly'>('monthly');
  const [dayDueText, setDayDueText] = useState('1');
  const [weekday, setWeekday] = useState(1); // Monday
  const [bucketId, setBucketId] = useState<number | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);

  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const categories = useAppQuery((db) =>
    db.select().from(categoriesTable).where(eq(categoriesTable.type, 'expense')),
  );

  const amount = parsePesoInput(amountText);
  const dayDue = frequency === 'monthly' ? Number(dayDueText) : weekday;
  const dayDueValid =
    frequency === 'weekly' || (Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31);
  const valid = name.trim() !== '' && amount !== null && bucketId !== undefined && dayDueValid;

  const save = async () => {
    if (!valid || amount === null || bucketId === undefined) return;
    await db.insert(recurring).values({
      name: name.trim(),
      amount,
      frequency,
      dayDue,
      bucketId,
      categoryId,
      startDate: todayLocal(),
    });
    // Post immediately if today is already a due date.
    await runCatchUp(db, todayLocal());
    refresh();
    router.back();
  };

  if (!buckets || !categories) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New recurring</Text>
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

        <SubmitButton label="Save" disabled={!valid} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
