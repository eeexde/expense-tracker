import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { backupDatabaseFile, isDbOpenError } from '@/db/client';
import { colors, fonts, radii, spacing, todayLocal } from '@/theme';

type Props = { children: ReactNode };
type BackupStatus = 'idle' | 'working' | 'done' | 'failed';
type State = {
  error: Error | null;
  showDetails: boolean;
  backupStatus: BackupStatus;
  backupMessage: string | null;
};

/**
 * Root error boundary. Catches render/lifecycle throws anywhere in the tree
 * (SQLite failures, on-device LLM errors, notification-sync crashes) so the
 * app shows a recovery screen instead of a white screen. "Try again" clears
 * the caught error and re-mounts the subtree.
 *
 * A `DbOpenError` gets a second path. "Try again" re-runs the same open, so
 * against a genuinely broken database it retries the identical failure for
 * ever, and the only other exit — reinstalling — destroys every peso of local
 * history, which nothing in this app syncs anywhere. So the database file
 * itself is offered as an export first: it leaves the device even when the app
 * cannot read it. Nothing on this screen deletes anything.
 */
export class ErrorBoundary extends Component<Props, State> {
  // Raw messages are developer text (SQL, native stack fragments) — meaningless
  // to a user and a place where data can leak into the UI. Expanded by default
  // in dev, behind "Show details" in a release build.
  state: State = {
    error: null,
    showDetails: __DEV__,
    backupStatus: 'idle',
    backupMessage: null,
  };

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surfaces in Metro/logcat; wire to crash reporting here later.
    console.error('Uncaught error in render tree:', error, info?.componentStack);
  }

  reset = () =>
    this.setState({
      error: null,
      showDetails: __DEV__,
      backupStatus: 'idle',
      backupMessage: null,
    });

  toggleDetails = () => this.setState((prev) => ({ showDetails: !prev.showDetails }));

  backUpDatabase = async () => {
    this.setState({ backupStatus: 'working', backupMessage: null });
    try {
      const shared = await backupDatabaseFile(todayLocal());
      this.setState(
        shared
          ? {
              backupStatus: 'done',
              backupMessage:
                'Saved. Keep that .db file — it holds everything, and a working build of Kuripot can open it.',
            }
          : {
              backupStatus: 'failed',
              backupMessage: 'This device has no app that can receive the file.',
            },
      );
    } catch (e) {
      this.setState({
        backupStatus: 'failed',
        backupMessage: e instanceof Error ? e.message : 'Could not export the database file.',
      });
    }
  };

  render() {
    const { error, showDetails, backupStatus, backupMessage } = this.state;
    if (!error) return this.props.children;

    const dbError = isDbOpenError(error) ? error : null;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{dbError ? 'Kuripot cannot start' : 'Something broke'}</Text>
          {dbError ? (
            <>
              {/* Our own sentence, not driver text — safe to show outright. */}
              <Text style={styles.body}>{dbError.message}</Text>
              <Text style={styles.body}>
                Your data is still on this device and nothing here will delete it. Save a copy of
                the database file before anything else — reinstalling Kuripot would wipe it, and
                there is no cloud copy.
              </Text>
              <Pressable
                style={[styles.button, backupStatus === 'working' && styles.buttonBusy]}
                onPress={this.backUpDatabase}
                disabled={backupStatus === 'working'}
                accessibilityRole="button"
                accessibilityState={{ disabled: backupStatus === 'working' }}
                testID="backup-db-file"
              >
                <Text style={styles.buttonText}>
                  {backupStatus === 'working' ? 'Saving…' : 'Save a copy of the database'}
                </Text>
              </Pressable>
              {backupMessage && (
                <Text
                  style={backupStatus === 'failed' ? styles.backupBad : styles.backupOk}
                  testID="backup-db-status"
                >
                  {backupMessage}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.body}>
              Kuripot hit an unexpected error. Your saved data is safe. Try again,
              and if it keeps happening, restart the app.
            </Text>
          )}
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
              <Text style={styles.detail}>
                {dbError ? dbError.detail : error.message || String(error)}
              </Text>
            </View>
          )}
          <Pressable
            style={dbError ? styles.secondaryButton : styles.button}
            onPress={this.reset}
            accessibilityRole="button"
          >
            <Text style={dbError ? styles.secondaryButtonText : styles.buttonText}>Try again</Text>
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
  buttonBusy: { opacity: 0.6 },
  buttonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.bg,
  },
  // "Try again" stops being the primary action once the database is the thing
  // that failed: retrying re-runs the exact call that just threw.
  secondaryButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.ink,
  },
  backupOk: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.income },
  backupBad: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
});
