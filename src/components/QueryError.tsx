import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radii, spacing } from '@/theme';

/**
 * Inline stand-in for one section whose query rejected, with a retry that
 * re-runs just that query.
 *
 * Deliberately *not* a rethrow. The root `ErrorBoundary` sits above the router
 * `Stack`, so throwing replaces the whole app and its "Try again" drops the
 * user back at the initial route — losing a half-filled modal form along the
 * way. A dead section should cost the section. See `useAppQueryResult`.
 */
export function QueryErrorNotice({
  message,
  onRetry,
  testID,
}: {
  message: string;
  onRetry: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.root} testID={testID}>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        style={styles.button}
        onPress={onRetry}
        accessibilityRole="button"
        testID={testID ? `${testID}-retry` : undefined}
      >
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkDim,
    textAlign: 'center',
  },
  button: {
    // 44 is the minimum comfortable tap target; the padding alone gives ~34.
    minHeight: 44,
    justifyContent: 'center',
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
});
