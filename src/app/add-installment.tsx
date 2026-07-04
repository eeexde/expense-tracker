import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { ChipRow, formStyles, SubmitButton } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { buckets as bucketsTable, installments } from '@/db/schema';
import { parsePesoInput } from '@/lib/money';
import { runCatchUp } from '@/lib/recurringEngine';
import { colors, todayLocal } from '@/theme';

export default function AddInstallmentScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const [itemName, setItemName] = useState('');
  const [monthlyText, setMonthlyText] = useState('');
  const [monthsText, setMonthsText] = useState('');
  const [dayDueText, setDayDueText] = useState('15');
  const [bucketId, setBucketId] = useState<number | undefined>(undefined);

  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );

  const monthlyDue = parsePesoInput(monthlyText);
  const monthsTotal = Number(monthsText);
  const dayDue = Number(dayDueText);
  const monthsValid = Number.isInteger(monthsTotal) && monthsTotal >= 1 && monthsTotal <= 60;
  const dayValid = Number.isInteger(dayDue) && dayDue >= 1 && dayDue <= 31;
  const valid =
    itemName.trim() !== '' &&
    monthlyDue !== null &&
    monthsValid &&
    dayValid &&
    bucketId !== undefined;

  const save = async () => {
    if (!valid || monthlyDue === null || bucketId === undefined) return;
    await db.insert(installments).values({
      itemName: itemName.trim(),
      totalAmount: monthlyDue * monthsTotal,
      monthlyDue,
      monthsTotal,
      dayDue,
      bucketId,
      startDate: todayLocal(),
    });
    // Post immediately if today is already a due date.
    await runCatchUp(db, todayLocal());
    refresh();
    router.back();
  };

  if (!buckets) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New installment</Text>
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

        <SubmitButton label="Save" disabled={!valid} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
