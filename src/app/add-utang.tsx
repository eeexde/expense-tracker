import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formStyles, Segmented, SubmitButton } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { addUtang } from '@/db/utangRepo';
import { parsePesoInput } from '@/lib/money';
import { colors } from '@/theme';

export default function AddUtangScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const [personName, setPersonName] = useState('');
  const [direction, setDirection] = useState<'iOwe' | 'owedToMe'>('iOwe');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  const amount = parsePesoInput(amountText);
  const valid = personName.trim() !== '' && amount !== null;

  const save = async () => {
    if (!valid || amount === null) return;
    await addUtang(db, {
      personName: personName.trim(),
      direction,
      originalAmount: amount,
      note: note.trim() || undefined,
    });
    refresh();
    router.back();
  };

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New utang</Text>
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Segmented
          options={[
            { value: 'iOwe', label: 'I owe' },
            { value: 'owedToMe', label: 'Owed to me' },
          ]}
          value={direction}
          onChange={setDirection}
        />

        <Text style={formStyles.label}>
          {direction === 'iOwe' ? 'Who I owe' : 'Who owes me'}
        </Text>
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
          ]}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0.00"
          placeholderTextColor={colors.inkFaint}
          keyboardType="decimal-pad"
        />

        <Text style={formStyles.label}>Note</Text>
        <TextInput
          style={formStyles.textInput}
          value={note}
          onChangeText={setNote}
          placeholder="Optional"
          placeholderTextColor={colors.inkFaint}
        />

        <SubmitButton label="Save" disabled={!valid} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
