import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { formStyles, Segmented, SubmitButton } from './form';
import { BUCKET_ICON_OPTIONS, Icon } from './Icon';
import { parsePesoInput } from '@/lib/money';
import { colors, radii, spacing } from '@/theme';

export type BucketType = 'bucket' | 'credit';

export interface BucketFormValues {
  name: string;
  icon: string;
  color?: string;
  type: BucketType;
  startingBalance: number;
}

interface Props {
  initial?: Partial<BucketFormValues>;
  submitLabel?: string;
  onSubmit: (values: BucketFormValues) => void;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Credit cards start owing money more often than not, so their balance
 * accepts a leading minus.
 */
function parseSignedPesoInput(input: string): number | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith('-') || trimmed.startsWith('−');
  const abs = parsePesoInput(negative ? trimmed.slice(1) : trimmed);
  return abs === null ? null : negative ? -abs : abs;
}

/** Shared fields for the add/edit bucket modals. */
export function BucketForm({ initial, submitLabel = 'Save', onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'wallet');
  const [type, setType] = useState<BucketType>(initial?.type ?? 'bucket');
  const [color, setColor] = useState(initial?.color ?? '');
  const [balanceText, setBalanceText] = useState(
    initial?.startingBalance !== undefined ? (initial.startingBalance / 100).toFixed(2) : '',
  );

  const startingBalance = balanceText.trim() === '' ? 0 : parseSignedPesoInput(balanceText);
  const colorValid = color.trim() === '' || HEX_RE.test(color.trim());
  const valid = name.trim() !== '' && startingBalance !== null && colorValid;

  const submit = () => {
    if (!valid || startingBalance === null) return;
    onSubmit({
      name: name.trim(),
      icon,
      color: color.trim() || undefined,
      type,
      startingBalance,
    });
  };

  return (
    <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Segmented
        options={[
          { value: 'bucket', label: 'Bucket' },
          { value: 'credit', label: 'Credit card' },
        ]}
        value={type}
        onChange={(next) => {
          setType(next);
          // Sensible default icon when switching, unless the user already picked one.
          if (next === 'credit' && icon === 'wallet') setIcon('card');
          if (next === 'bucket' && icon === 'card') setIcon('wallet');
        }}
      />

      <Text style={formStyles.label}>Name</Text>
      <TextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder={type === 'credit' ? 'e.g. BPI Credit Card' : 'e.g. Wallet'}
        placeholderTextColor={colors.inkFaint}
        testID="bucket-name"
      />

      <Text style={formStyles.label}>Icon</Text>
      <View style={formStyles.chipRow}>
        {BUCKET_ICON_OPTIONS.map((key) => {
          const selected = key === icon;
          return (
            <Pressable
              key={key}
              onPress={() => setIcon(key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Icon ${key}`}
              testID={`bucket-icon-${key}`}
              style={{
                width: 44,
                height: 44,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: selected ? colors.gold : colors.border,
                backgroundColor: selected ? colors.surfaceRaised : colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={key} size={20} color={selected ? colors.gold : colors.inkDim} />
            </Pressable>
          );
        })}
      </View>

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

      <Text style={formStyles.label}>
        {type === 'credit' ? 'Starting balance (negative = owed)' : 'Starting balance'}
      </Text>
      <TextInput
        style={[
          formStyles.textInput,
          balanceText.trim() !== '' && startingBalance === null && formStyles.textInputError,
        ]}
        value={balanceText}
        onChangeText={setBalanceText}
        placeholder={type === 'credit' ? '-0.00' : '0.00'}
        placeholderTextColor={colors.inkFaint}
        keyboardType="numbers-and-punctuation"
        testID="bucket-balance"
      />
      <View style={{ height: spacing.xs }} />

      <SubmitButton label={submitLabel} disabled={!valid} onPress={submit} />
    </ScrollView>
  );
}
