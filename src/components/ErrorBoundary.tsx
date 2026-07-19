import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radii, spacing } from '@/theme';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Root error boundary. Catches render/lifecycle throws anywhere in the tree
 * (SQLite failures, on-device LLM errors, notification-sync crashes) so the
 * app shows a recovery screen instead of a white screen. "Try again" clears
 * the caught error and re-mounts the subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surfaces in Metro/logcat; wire to crash reporting here later.
    console.error('Uncaught error in render tree:', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.body}>
            Kuripot hit an unexpected error. Your saved data is safe. Try again,
            and if it keeps happening, restart the app.
          </Text>
          <View style={styles.detailBox}>
            <Text style={styles.detail}>{error.message || String(error)}</Text>
          </View>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 28,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkDim,
  },
  detailBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  detail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkFaint,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.bg,
  },
});
