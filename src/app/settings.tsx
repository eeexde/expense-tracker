import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDb } from '@/db/DbProvider';
import { exportData, importData } from '@/db/dataTransfer';
import { downloadBackup, pickBackup, shareBackup } from '@/lib/backup';
import { colors, fonts, radii, spacing, todayLocal } from '@/theme';

type Busy = 'export' | 'import' | null;

/**
 * The one line of feedback these two buttons ever produce. `ok` is carried
 * alongside the text because the outcome is not recoverable from the string:
 * "Import failed — nothing was changed." used to render in `colors.income`
 * like every success, which is the wrong signal after an explicitly
 * irreversible restore.
 */
type Status = { text: string; ok: boolean };

export default function SettingsScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const runExport = (mode: 'download' | 'share') => async () => {
    setBusy('export');
    setStatus(null);
    try {
      const payload = await exportData(db);
      const count = Object.values(payload.data).reduce((n, rows) => n + rows.length, 0);
      if (mode === 'download') {
        const saved = await downloadBackup(payload, todayLocal());
        setStatus(saved ? { text: `Saved ${saved} (${count} records).`, ok: true } : null);
      } else {
        const shared = await shareBackup(payload, todayLocal());
        setStatus(
          shared
            ? { text: `Exported ${count} records.`, ok: true }
            : { text: 'Sharing is not available on this device.', ok: false },
        );
      }
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Export failed.', ok: false });
    } finally {
      setBusy(null);
    }
  };

  const chooseExport = () => {
    Alert.alert('Export data', 'Save the backup file to a folder on this device, or send it through the share sheet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share…', onPress: runExport('share') },
      { text: 'Save to device', onPress: runExport('download') },
    ]);
  };

  const runImport = async () => {
    let payload: unknown;
    try {
      payload = await pickBackup();
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Could not read that file.', ok: false });
      return;
    }
    if (payload === null) return; // user cancelled

    Alert.alert(
      'Replace all data?',
      'Importing overwrites every bucket, transaction, and record currently in the app. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            setBusy('import');
            setStatus(null);
            try {
              await importData(db, payload as any);
              refresh();
              setStatus({ text: 'Import complete. Your data has been replaced.', ok: true });
            } catch (e) {
              setStatus({
                text: e instanceof Error ? e.message : 'Import failed — nothing was changed.',
                ok: false,
              });
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        {/* Leaving mid-import would drop the completion status on an unmounted
            screen, so the user would never learn whether the destructive
            restore finished. Both actions are short; hold Done until then. */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy !== null }}
        >
          <Text style={[styles.close, busy !== null && styles.closeDisabled]}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Data</Text>
        <Text style={styles.sectionSub}>
          Back up everything to a JSON file, or restore from one. Restoring replaces all current
          data.
        </Text>

        {/* A bare spinner was the whole busy state: no label, no
            `accessibilityState.busy`, so a screen reader got nothing at all
            during a multi-second destructive operation. The spinner now carries
            a visible label, and the button reports itself busy. */}
        <Pressable
          style={[styles.action, busy && styles.actionDisabled]}
          onPress={chooseExport}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy !== null, busy: busy === 'export' }}
          testID="export-action"
        >
          {busy === 'export' ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.gold} />
              <Text style={styles.actionTitle}>Exporting…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.actionTitle}>Export data</Text>
              <Text style={styles.actionSub}>Save a backup file to this device, or share it.</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[styles.action, busy && styles.actionDisabled]}
          onPress={runImport}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy !== null, busy: busy === 'import' }}
          testID="import-action"
        >
          {busy === 'import' ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.gold} />
              <Text style={styles.actionTitle}>Importing…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.actionTitle}>Import data</Text>
              <Text style={styles.actionSub}>Restore from a backup file (replaces everything).</Text>
            </>
          )}
        </Pressable>

        {/* Announced, not just drawn: this line is the only report an import
            ever gives, and the user's attention is on a dialog that has just
            closed rather than on the bottom of the Data section. */}
        {status && (
          <Text
            style={[styles.status, status.ok ? styles.statusOk : styles.statusFail]}
            accessibilityLiveRegion="assertive"
            testID="backup-status"
          >
            {status.text}
          </Text>
        )}

        <Text style={styles.sectionTitle}>Organize</Text>
        <Pressable
          style={styles.action}
          onPress={() => router.push('/manage-categories')}
          accessibilityRole="button"
        >
          <Text style={styles.actionTitle}>Manage categories</Text>
          <Text style={styles.actionSub}>Add, rename, re-icon, or archive expense and income categories.</Text>
        </Pressable>

        {Platform.OS === 'android' && (
          <>
            <Text style={styles.sectionTitle}>Automation</Text>
            <Pressable
              style={styles.action}
              onPress={() => router.push('/auto-log')}
              accessibilityRole="button"
            >
              <Text style={styles.actionTitle}>Auto-log from notifications</Text>
              <Text style={styles.actionSub}>
                Automatically capture expenses and income from bank/e-wallet notifications.
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  close: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold },
  closeDisabled: { color: colors.inkFaint },
  content: { padding: spacing.md, gap: spacing.sm },
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
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    minHeight: 64,
    justifyContent: 'center',
  },
  actionDisabled: { opacity: 0.5 },
  actionTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  actionSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  statusOk: { color: colors.income },
  statusFail: { color: colors.danger },
});
