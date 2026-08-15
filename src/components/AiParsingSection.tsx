import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { getSetting, setSetting } from '@/db/settingsRepo';
import {
  deleteModel,
  downloadModel,
  getDownloadProgress,
  getLastDownloadError,
  getModelState,
  isModelDownloaded,
  llmSupported,
} from '@/lib/llmController';
import { colors, fonts, radii, spacing } from '@/theme';

type Db = Parameters<typeof isModelDownloaded>[0];

type Props = {
  db: Db;
  /** Bumps the shared query version so other screens re-read after AI toggles. */
  refresh: () => void;
};

/**
 * On-device AI parsing controls for the auto-log screen: download / enable /
 * delete the ~1GB model. Self-contained — owns its own RAM/disk state and reads
 * the persistent flags on focus. Renders nothing on unsupported platforms (iOS,
 * web, low-RAM Android), so the parent can drop it in unconditionally.
 */
export function AiParsingSection({ db, refresh }: Props) {
  const [downloaded, setDownloaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // deleteModel awaits the in-flight load/download and any running inference
  // before it touches the files, so it can sit there for tens of seconds. Without
  // this the row stays pressable and nothing on screen changes.
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(0);
  // Mirror of the controller's last download failure. A failed download is
  // RENDERED, never alerted: auto-log is a modal route, so every dismiss/reopen
  // mounts a fresh section that re-joins the same in-flight download, and an
  // Alert here would fire once per instance that ever joined — a stack of
  // identical dialogs when a ~1GB download dies on mobile data.
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // True while this component is awaiting a download, so a blur/focus cycle
  // can't attach to the same download twice from this instance.
  const tracking = useRef(false);

  const loadState = useCallback(
    (isCancelled: () => boolean) => {
      if (!llmSupported) return;
      isModelDownloaded(db).then((v) => {
        if (!isCancelled()) setDownloaded(v);
      });
      getSetting(db, 'aiParsingEnabled').then((value) => {
        if (!isCancelled()) setEnabled(value === 'true');
      });
    },
    [db],
  );

  /**
   * Starts the download — or joins the one already running. The download lives
   * in the controller and outlives this component, so downloadModel re-points
   * progress at this `setProgress` and resolves when that download does.
   */
  const runDownload = useCallback(async () => {
    if (tracking.current) return;
    tracking.current = true;
    setDownloading(true);
    setDownloadError(null);
    setProgress(getDownloadProgress());
    try {
      await downloadModel(db, setProgress);
      setDownloaded(true);
    } catch (e) {
      // The controller records the failure so a section mounted later still
      // sees it; fall back to the rejection itself if we joined a download
      // whose error was already cleared by a newer attempt.
      setDownloadError(getLastDownloadError() ?? (e instanceof Error ? e.message : 'Download failed.'));
    } finally {
      tracking.current = false;
      setDownloading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadState(() => cancelled);
      // A failure from a download this instance never saw (it happened while the
      // modal was dismissed) still belongs on screen.
      setDownloadError(getLastDownloadError());
      // A download in flight survives leaving this screen. Re-join it on focus,
      // otherwise the section offers "Download AI model" as if nothing had
      // started — and tapping it hits the in-flight guard, leaving the bar at
      // 0% for the rest of the ~1GB.
      if (getModelState() === 'downloading') void runDownload();
      return () => {
        cancelled = true;
      };
    }, [loadState, runDownload]),
  );

  if (!llmSupported) return null;

  const handleToggle = async (next: boolean) => {
    try {
      await setSetting(db, 'aiParsingEnabled', next ? 'true' : 'false');
      setEnabled(next);
      refresh();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Could not update setting.');
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete AI model?', 'Frees storage; auto-parsing falls back to rules only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (deleting) return;
          setDeleting(true);
          try {
            await deleteModel(db);
            await setSetting(db, 'aiParsingEnabled', 'false');
            setDownloaded(false);
            setEnabled(false);
            // The model this failure belonged to is gone; leaving it set would
            // re-render the download row as "Retry download".
            setDownloadError(null);
          } catch (e) {
            Alert.alert(
              'Could not delete',
              e instanceof Error ? e.message : 'Could not delete model.',
            );
            // deleteModel clears the PERSISTENT flag even when the file deletion
            // itself fails (surviving files are dead weight; AI must still be
            // off), so the rejection alone does not say what this section should
            // show. Re-read both flags rather than leaving the UI insisting the
            // model is still there when classify() will never load it again.
            loadState(() => false);
          } finally {
            setDeleting(false);
            refresh();
          }
        },
      },
    ]);
  };

  return (
    <>
      <Text style={styles.sectionTitle}>AI parsing (beta)</Text>
      <Text style={styles.sectionSub}>
        Runs entirely on this phone. Used only when the regular parser can&apos;t tell expense from
        income.
      </Text>

      {!downloaded && !downloading && (
        <>
          {/* Clamped for the same reason ErrorBoundary hides raw messages behind
              "Show details": these come straight from executorch / the resource
              fetcher and run to several lines of CDN URL and document-directory
              path, which would push "Retry download" off the sheet. */}
          {downloadError && (
            <Text style={styles.errorText} numberOfLines={2}>
              Download failed: {downloadError}
            </Text>
          )}
          <Pressable style={styles.action} onPress={runDownload}>
            <Text style={styles.actionTitle}>
              {downloadError ? 'Retry download' : 'Download AI model'}
            </Text>
            <Text style={styles.sectionSub}>~1 GB · Wi-Fi recommended · runs entirely on your phone</Text>
          </Pressable>
        </>
      )}

      {downloading && (
        <View style={styles.card}>
          <View style={styles.cardMain}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.cardSub}>Downloading… {Math.round(progress * 100)}%</Text>
          </View>
        </View>
      )}

      {downloaded && !downloading && (
        <>
          <View style={styles.card}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>Parse with AI when rules fail</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={handleToggle}
              disabled={deleting}
              trackColor={{ false: colors.border, true: colors.goldDim }}
              thumbColor={enabled ? colors.gold : colors.inkFaint}
            />
          </View>
          <Pressable
            style={[styles.action, deleting && styles.actionBusy]}
            onPress={confirmDelete}
            disabled={deleting}
          >
            <Text style={styles.actionTitle}>
              {deleting ? 'Deleting…' : 'Delete model'}
            </Text>
            {deleting && (
              <Text style={styles.actionSub}>Waiting for anything still using the model…</Text>
            )}
          </Pressable>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  sectionSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkFaint,
    marginBottom: spacing.sm,
  },
  action: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  actionBusy: { opacity: 0.6 },
  actionSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: 2,
  },
  actionTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, textAlign: 'center' },
  errorText: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, marginBottom: spacing.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
  progressTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
});
