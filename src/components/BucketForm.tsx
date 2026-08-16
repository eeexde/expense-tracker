import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  FormTextInput,
  formStyles,
  KeyboardAwareForm,
  Segmented,
  SIGNED_NUMERIC_KEYBOARD,
  SubmitButton,
  useSubmitGuard,
} from './form';
import { BUCKET_ICON_OPTIONS, Icon } from './Icon';
import { parsePesoBalanceInput } from '@/lib/money';
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
  onSubmit: (values: BucketFormValues) => void | Promise<void>;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const COLOR_ERROR = 'Invalid color — use a 6-digit hex like #2E7D32.';
const BALANCE_ERROR = 'Invalid balance — use numbers like 1200.50, or -1200.50 for money owed.';

/**
 * Credit cards start owing money more often than not, so their balance
 * accepts a leading minus.
 *
 * A *balance* parse, not an amount one: ₱0 is a legitimate starting balance
 * and the schema default, so parsing it as an amount (which rejects zero)
 * left every default-balance bucket with Save permanently disabled.
 */
function parseSignedPesoInput(input: string): number | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith('-') || trimmed.startsWith('−');
  const abs = parsePesoBalanceInput(negative ? trimmed.slice(1) : trimmed);
  if (abs === null) return null;
  // `negative && abs === 0` would otherwise hand the db -0.
  return negative && abs !== 0 ? -abs : abs;
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
  const colorRef = useRef<TextInput>(null);
  const balanceRef = useRef<TextInput>(null);

  const startingBalance = balanceText.trim() === '' ? 0 : parseSignedPesoInput(balanceText);
  const colorValid = color.trim() === '' || HEX_RE.test(color.trim());
  const balanceInvalid = balanceText.trim() !== '' && startingBalance === null;
  const valid = name.trim() !== '' && startingBalance !== null && colorValid;

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid || startingBalance === null) return;
    await onSubmit({
      name: name.trim(),
      icon,
      color: color.trim() || undefined,
      type,
      startingBalance,
    });
  });

  return (
    <KeyboardAwareForm>
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
      <FormTextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder={type === 'credit' ? 'e.g. BPI Credit Card' : 'e.g. Wallet'}
        placeholderTextColor={colors.inkFaint}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => colorRef.current?.focus()}
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
      <FormTextInput
        ref={colorRef}
        style={[formStyles.textInput, !colorValid && formStyles.textInputError]}
        value={color}
        onChangeText={setColor}
        placeholder="#2E7D32"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => balanceRef.current?.focus()}
        accessibilityLabel="Color (optional, hex)"
        accessibilityHint={colorValid ? undefined : COLOR_ERROR}
        testID="bucket-color"
      />
      {!colorValid && <Text style={errorHint}>{COLOR_ERROR}</Text>}

      <Text style={formStyles.label}>
        {type === 'credit' ? 'Starting balance (negative = owed)' : 'Starting balance'}
      </Text>
      <FormTextInput
        ref={balanceRef}
        style={[formStyles.textInput, balanceInvalid && formStyles.textInputError]}
        value={balanceText}
        onChangeText={setBalanceText}
        placeholder={type === 'credit' ? '-0.00' : '0.00'}
        placeholderTextColor={colors.inkFaint}
        keyboardType={SIGNED_NUMERIC_KEYBOARD}
        returnKeyType="done"
        accessibilityLabel={
          type === 'credit' ? 'Starting balance (negative = owed)' : 'Starting balance'
        }
        accessibilityHint={balanceInvalid ? BALANCE_ERROR : undefined}
        testID="bucket-balance"
      />
      {balanceInvalid && <Text style={errorHint}>{BALANCE_ERROR}</Text>}
      <View style={{ height: spacing.xs }} />

      <SubmitButton
        label={submitLabel}
        disabled={!valid}
        submitting={submitting}
        onPress={submit}
      />
    </KeyboardAwareForm>
  );
}

const errorHint = { color: colors.danger, fontSize: 13, marginTop: 4 };
