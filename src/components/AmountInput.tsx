import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { parsePesoInput } from '@/lib/money';
import { colors, fonts, spacing } from '@/theme';

interface Props {
  /** Called with centavos when input parses, null when invalid/empty. */
  onChangeAmount: (centavos: number | null) => void;
  initialText?: string;
  autoFocus?: boolean;
}

/** Big peso-first amount entry. Reports parsed centavos, never raw text. */
export function AmountInput({ onChangeAmount, initialText = '', autoFocus }: Props) {
  const [text, setText] = useState(initialText);
  const invalid = text.trim() !== '' && parsePesoInput(text) === null;

  const handleChange = (next: string) => {
    setText(next);
    onChangeAmount(parsePesoInput(next));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.peso}>₱</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={handleChange}
          placeholder="0.00"
          placeholderTextColor={colors.inkFaint}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          accessibilityLabel="Amount"
          testID="amount-input"
        />
      </View>
      {invalid && <Text style={styles.error}>Invalid amount</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  peso: { fontFamily: fonts.display, fontSize: 28, color: colors.gold },
  input: {
    fontFamily: fonts.displayBlack,
    fontSize: 44,
    color: colors.ink,
    minWidth: 140,
    textAlign: 'center',
    padding: 0,
  },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
});
