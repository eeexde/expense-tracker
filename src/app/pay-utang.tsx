import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import {
  ChipRow,
  FormTextInput,
  formStyles,
  KeyboardAwareForm,
  SubmitButton,
  useSubmitGuard,
} from '@/components/form';
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

  const [submitting, save] = useSubmitGuard(async () => {
    if (!valid || amount === null || bucketId === undefined) return;
    try {
      await addUtangPayment(db, { utangId, amount, date: todayLocal(), bucketId });
      refresh();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  if (!debt || remaining === undefined || !buckets) {
    return <SafeAreaView style={formStyles.screen} />;
  }

  const isIOwe = debt.direction === 'iOwe';

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>
        {isIOwe ? `Pay ${debt.personName}` : `Payment from ${debt.personName}`}
      </Text>
      <KeyboardAwareForm>
        <Text style={styles.remaining}>
          Remaining: <Text style={styles.remainingAmount}>{formatPeso(remaining)}</Text>
        </Text>

        <Text style={formStyles.label}>Payment amount</Text>
        <FormTextInput
          style={[
            formStyles.textInput,
            (overpay || (amountText.trim() !== '' && amount === null)) && formStyles.textInputError,
          ]}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0.00"
          placeholderTextColor={colors.inkFaint}
          keyboardType="decimal-pad"
          returnKeyType="done"
        />
        {overpay && <Text style={styles.error}>Exceeds the remaining balance.</Text>}

        <Text style={formStyles.label}>{isIOwe ? 'From bucket' : 'To bucket'}</Text>
        <ChipRow
          items={buckets.map((b) => ({ id: b.id, label: b.name, icon: b.icon }))}
          selectedId={bucketId}
          onSelect={setBucketId}
        />

        {error && <Text style={styles.error}>{error}</Text>}
        <SubmitButton
          label="Record payment"
          disabled={!valid}
          submitting={submitting}
          onPress={save}
        />
      </KeyboardAwareForm>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  remaining: { fontFamily: fonts.body, fontSize: 15, color: colors.inkDim },
  remainingAmount: { fontFamily: fonts.display, color: colors.gold },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginTop: spacing.xs },
});
