import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radii, spacing } from '@/theme';

type Props = { children: ReactNode };
type State = { error: Error | null; showDetails: boolean };

/**
 * Root error boundary. Catches render/lifecycle throws anywhere in the tree
 * (SQLite failures, on-device LLM errors, notification-sync crashes) so the
 * app shows a recovery screen instead of a white screen. "Try again" clears
 * the caught error and re-mounts the subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
  // Raw messages are developer text (SQL, native stack fragments) — meaningless
  // to a user and a place where data can leak into the UI. Expanded by default
  // in dev, behind "Show details" in a release build.
  state: State = { error: null, showDetails: __DEV__ };

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surfaces in Metro/logcat; wire to crash reporting here later.
    console.error('Uncaught error in render tree:', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null, showDetails: __DEV__ });

  toggleDetails = () => this.setState((prev) => ({ showDetails: !prev.showDetails }));

  render() {
    const { error, showDetails } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.body}>
            Kuripot hit an unexpected error. Your saved data is safe. Try again,
            and if it keeps happening, restart the app.
          </Text>
          <Pressable
            style={styles.detailToggle}
            onPress={this.toggleDetails}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.detailToggleText}>
              {showDetails ? 'Hide details' : 'Show details'}
            </Text>
          </Pressable>
          {showDetails && (
            <View style={styles.detailBox}>
              <Text style={styles.detail}>{error.message || String(error)}</Text>
            </View>
          )}
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
  detailToggle: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  detailToggleText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.gold,
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
