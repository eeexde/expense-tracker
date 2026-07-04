import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { ChipRow, formStyles, SubmitButton } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { buckets as bucketsTable, utang as utangTable } from '@/db/schema';
import { addUtangPayment, utangRemaining } from '@/db/utangRepo';
import { formatPeso, parsePesoInput } from '@/lib/money';
import { colors, fonts, spacing, todayLocal } from '@/theme';

export default function PayUtangScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const utangId = Number(id);

  const [amountText, setAmountText] = useState('');
  const [bucketId, setBucketId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const debt = useAppQuery(async (db) => {
    const [row] = await db.select().from(utangTable).where(eq(utangTable.id, utangId));
    return row;
  }, [utangId]);
  const remaining = useAppQuery((db) => utangRemaining(db, utangId), [utangId]);
  const buckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );

  const amount = parsePesoInput(amountText);
  const overpay = amount !== null && remaining !== undefined && amount > remaining;
  const valid = amount !== null && bucketId !== undefined && !overpay;

  const save = async () => {
    if (!valid || amount === null || bucketId === undefined) return;
    try {
      await addUtangPayment(db, { utangId, amount, date: todayLocal(), bucketId });
      refresh();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!debt || remaining === undefined || !buckets) {
    return <SafeAreaView style={formStyles.screen} />;
  }

  const isIOwe = debt.direction === 'iOwe';

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>
        {isIOwe ? `Pay ${debt.personName}` : `Payment from ${debt.personName}`}
      </Text>
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.remaining}>
          Remaining: <Text style={styles.remainingAmount}>{formatPeso(remaining)}</Text>
        </Text>

        <Text style={formStyles.label}>Payment amount</Text>
        <TextInput
          style={[
            formStyles.textInput,
            (overpay || (amountText.trim() !== '' && amount === null)) && formStyles.textInputError,
          ]}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0.00"
          placeholderTextColor={colors.inkFaint}
          keyboardType="decimal-pad"
        />
        {overpay && <Text style={styles.error}>Exceeds the remaining balance.</Text>}

        <Text style={formStyles.label}>{isIOwe ? 'From bucket' : 'To bucket'}</Text>
        <ChipRow
          items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
          selectedId={bucketId}
          onSelect={setBucketId}
        />

        {error && <Text style={styles.error}>{error}</Text>}
        <SubmitButton label="Record payment" disabled={!valid} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  remaining: { fontFamily: fonts.body, fontSize: 15, color: colors.inkDim },
  remainingAmount: { fontFamily: fonts.display, color: colors.gold },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginTop: spacing.xs },
});
