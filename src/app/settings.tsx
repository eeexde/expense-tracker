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

export default function SettingsScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<string | null>(null);

  const runExport = (mode: 'download' | 'share') => async () => {
    setBusy('export');
    setStatus(null);
    try {
      const payload = await exportData(db);
      const count = Object.values(payload.data).reduce((n, rows) => n + rows.length, 0);
      if (mode === 'download') {
        const saved = await downloadBackup(payload, todayLocal());
        setStatus(saved ? `Saved ${saved} (${count} records).` : null);
      } else {
        const shared = await shareBackup(payload, todayLocal());
        setStatus(shared ? `Exported ${count} records.` : 'Sharing is not available on this device.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Export failed.');
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
      setStatus(e instanceof Error ? e.message : 'Could not read that file.');
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
              setStatus('Import complete. Your data has been replaced.');
            } catch (e) {
              setStatus(e instanceof Error ? e.message : 'Import failed — nothing was changed.');
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
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Data</Text>
        <Text style={styles.sectionSub}>
          Back up everything to a JSON file, or restore from one. Restoring replaces all current
          data.
        </Text>

        <Pressable
          style={[styles.action, busy && styles.actionDisabled]}
          onPress={chooseExport}
          disabled={busy !== null}
        >
          {busy === 'export' ? (
            <ActivityIndicator color={colors.gold} />
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
        >
          {busy === 'import' ? (
            <ActivityIndicator color={colors.gold} />
          ) : (
            <>
              <Text style={styles.actionTitle}>Import data</Text>
              <Text style={styles.actionSub}>Restore from a backup file (replaces everything).</Text>
            </>
          )}
        </Pressable>

        {status && <Text style={styles.status}>{status}</Text>}

        {Platform.OS === 'android' && (
          <>
            <Text style={styles.sectionTitle}>Automation</Text>
            <Pressable style={styles.action} onPress={() => router.push('/auto-log')}>
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
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.income,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
