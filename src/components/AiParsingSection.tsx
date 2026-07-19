import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { getSetting, setSetting } from '@/db/settingsRepo';
import {
  deleteModel,
  downloadModel,
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
  const [progress, setProgress] = useState(0);

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

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadState(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [loadState]),
  );

  if (!llmSupported) return null;

  const handleDownload = async () => {
    setDownloading(true);
    setProgress(0);
    try {
      await downloadModel(db, setProgress);
      setDownloaded(true);
    } catch (e) {
      Alert.alert('Could not download', e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

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
          try {
            await deleteModel(db);
            await setSetting(db, 'aiParsingEnabled', 'false');
            setDownloaded(false);
            setEnabled(false);
            refresh();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Could not delete model.');
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
        <Pressable style={styles.action} onPress={handleDownload}>
          <Text style={styles.actionTitle}>Download AI model</Text>
          <Text style={styles.sectionSub}>~1 GB · Wi-Fi recommended · runs entirely on your phone</Text>
        </Pressable>
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
              trackColor={{ false: colors.border, true: colors.goldDim }}
              thumbColor={enabled ? colors.gold : colors.inkFaint}
            />
          </View>
          <Pressable style={styles.action} onPress={confirmDelete}>
            <Text style={styles.actionTitle}>Delete model</Text>
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
  actionTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, textAlign: 'center' },
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
