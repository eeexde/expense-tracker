import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { verifyLicense } from '@/lib/license';
import { loadLicense, saveLicense } from '@/lib/licenseStore';
import { colors, fonts, radii, spacing } from '@/theme';

type Phase = 'checking' | 'locked' | 'unlocked';

/**
 * Whole-app gate. Renders children only when a valid license is stored.
 * Re-verifies the signature from storage on every launch — there is no cached
 * "unlocked" boolean, so flipping a flag cannot bypass the gate.
 */
export function LicenseGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLicense().then((stored) => {
      if (cancelled) return;
      setPhase(stored && verifyLicense(stored).ok ? 'unlocked' : 'locked');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = async () => {
    const result = verifyLicense(input.trim());
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    await saveLicense(input.trim());
    setError(null);
    setPhase('unlocked');
  };

  if (phase === 'unlocked') return <>{children}</>;

  if (phase === 'checking') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Unlock Kuripot</Text>
        <Text style={styles.body}>
          Paste the license key you received after purchase. Keep it safe — you&apos;ll need it again
          if you reinstall the app.
        </Text>
        <TextInput
          testID="license-input"
          style={styles.input}
          value={input}
          onChangeText={(t) => {
            setInput(t);
            setError(null);
          }}
          placeholder="kur-..."
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable testID="license-unlock" style={styles.button} onPress={unlock}>
          <Text style={styles.buttonText}>Unlock</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.lg },
  center: { alignItems: 'center' },
  card: { gap: spacing.md },
  title: { fontFamily: fonts.displayBlack, fontSize: 28, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 88,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.danger },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.bg },
});
