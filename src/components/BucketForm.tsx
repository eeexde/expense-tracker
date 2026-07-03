import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { formStyles, SubmitButton } from './form';
import { parsePesoInput } from '@/lib/money';
import { colors } from '@/theme';

export interface BucketFormValues {
  name: string;
  icon: string;
  color?: string;
  startingBalance: number;
}

interface Props {
  initial?: Partial<BucketFormValues>;
  submitLabel?: string;
  onSubmit: (values: BucketFormValues) => void;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Shared fields for the add/edit bucket modals. */
export function BucketForm({ initial, submitLabel = 'Save', onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '💰');
  const [color, setColor] = useState(initial?.color ?? '');
  const [balanceText, setBalanceText] = useState(
    initial?.startingBalance !== undefined ? (initial.startingBalance / 100).toFixed(2) : '',
  );

  const startingBalance = balanceText.trim() === '' ? 0 : parsePesoInput(balanceText);
  const colorValid = color.trim() === '' || HEX_RE.test(color.trim());
  const valid = name.trim() !== '' && icon.trim() !== '' && startingBalance !== null && colorValid;

  const submit = () => {
    if (!valid || startingBalance === null) return;
    onSubmit({
      name: name.trim(),
      icon: icon.trim(),
      color: color.trim() || undefined,
      startingBalance,
    });
  };

  return (
    <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={formStyles.label}>Name</Text>
      <TextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Wallet"
        placeholderTextColor={colors.inkFaint}
        testID="bucket-name"
      />

      <Text style={formStyles.label}>Icon (emoji)</Text>
      <TextInput
        style={formStyles.textInput}
        value={icon}
        onChangeText={setIcon}
        placeholder="💰"
        placeholderTextColor={colors.inkFaint}
        testID="bucket-icon"
      />

      <Text style={formStyles.label}>Color (optional, hex)</Text>
      <TextInput
        style={[formStyles.textInput, !colorValid && formStyles.textInputError]}
        value={color}
        onChangeText={setColor}
        placeholder="#2E7D32"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        testID="bucket-color"
      />

      <Text style={formStyles.label}>Starting balance</Text>
      <TextInput
        style={[
          formStyles.textInput,
          balanceText.trim() !== '' && startingBalance === null && formStyles.textInputError,
        ]}
        value={balanceText}
        onChangeText={setBalanceText}
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        keyboardType="decimal-pad"
        testID="bucket-balance"
      />

      <SubmitButton label={submitLabel} disabled={!valid} onPress={submit} />
    </ScrollView>
  );
}
