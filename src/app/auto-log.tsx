import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChipRow, formStyles, SubmitButton } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import {
  addCategoryRule,
  addSource,
  deleteCategoryRule,
  deleteSource,
  listCategoryRules,
  listSources,
  updateSource,
  watchedPackages,
} from '@/db/notificationRepo';
import { buckets as bucketsTable, categories as categoriesTable } from '@/db/schema';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { eq } from 'drizzle-orm';
import {
  deleteModel,
  downloadModel,
  isModelDownloaded,
  llmSupported,
} from '@/lib/llmController';
import { colors, fonts, radii, spacing } from '@/theme';
import {
  getLaunchableApps,
  isAvailable,
  isPermissionGranted,
  LaunchableApp,
  openSettings,
  setWatchedPackages,
} from '../../modules/notification-listener';

/** Best-effort push to the native listener; a failure here never blocks the write that triggered it. */
async function pushWatchedPackages(db: Parameters<typeof watchedPackages>[0]) {
  try {
    setWatchedPackages(await watchedPackages(db));
  } catch {
    // best-effort
  }
}

export default function AutoLogScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const [granted, setGranted] = useState(() => isPermissionGranted());

  useFocusEffect(
    useCallback(() => {
      setGranted(isPermissionGranted());
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') setGranted(isPermissionGranted());
      });
      return () => sub.remove();
    }, []),
  );

  const sources = useAppQuery(listSources);
  const allBuckets = useAppQuery((db) => db.select().from(bucketsTable));
  const activeBuckets = useAppQuery((db) =>
    db.select().from(bucketsTable).where(eq(bucketsTable.archived, false)),
  );
  const rules = useAppQuery(listCategoryRules);
  const allCategories = useAppQuery((db) => db.select().from(categoriesTable));

  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [packageName, setPackageName] = useState('');
  const [bucketId, setBucketId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState('');

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState<number | undefined>(undefined);

  const [aiDownloaded, setAiDownloaded] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDownloading, setAiDownloading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);

  const refreshAiState = useCallback(() => {
    if (!llmSupported) return;
    isModelDownloaded(db).then(setAiDownloaded);
    getSetting(db, 'aiParsingEnabled').then((value) => setAiEnabled(value === 'true'));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refreshAiState();
    }, [refreshAiState]),
  );

  const openSourceModal = () => {
    setApps(getLaunchableApps());
    setPackageName('');
    setBucketId(undefined);
    setKeyword('');
    setSourceModalOpen(true);
  };

  const saveSource = async () => {
    const trimmedPackage = packageName.trim();
    if (!trimmedPackage || bucketId === undefined) return;
    try {
      await addSource(db, {
        bucketId,
        packageName: trimmedPackage,
        matchKeyword: keyword.trim() || undefined,
      });
      refresh();
      await pushWatchedPackages(db);
      setSourceModalOpen(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Could not add source.');
    }
  };

  const toggleSource = async (id: number, enabled: boolean) => {
    try {
      await updateSource(db, id, { enabled });
      refresh();
      await pushWatchedPackages(db);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Could not update source.');
    }
  };

  const confirmDeleteSource = (id: number, label: string) => {
    Alert.alert('Remove source?', `${label} will stop being auto-logged.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSource(db, id);
            refresh();
            await pushWatchedPackages(db);
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Could not remove source.');
          }
        },
      },
    ]);
  };

  const openRuleModal = () => {
    setRuleKeyword('');
    setRuleCategoryId(undefined);
    setRuleModalOpen(true);
  };

  const saveRule = async () => {
    const trimmed = ruleKeyword.trim();
    if (!trimmed || ruleCategoryId === undefined) return;
    try {
      await addCategoryRule(db, { keyword: trimmed, categoryId: ruleCategoryId });
      refresh();
      setRuleModalOpen(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Could not add rule.');
    }
  };

  const confirmDeleteRule = (id: number, label: string) => {
    Alert.alert('Remove rule?', `"${label}" will no longer auto-categorize.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategoryRule(db, id);
            refresh();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Could not remove rule.');
          }
        },
      },
    ]);
  };

  const handleDownloadModel = async () => {
    setAiDownloading(true);
    setAiProgress(0);
    try {
      await downloadModel(db, setAiProgress);
      setAiDownloaded(true);
    } catch (e) {
      Alert.alert('Could not download', e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setAiDownloading(false);
    }
  };

  const handleToggleAi = async (next: boolean) => {
    await setSetting(db, 'aiParsingEnabled', next ? 'true' : 'false');
    setAiEnabled(next);
    refresh();
  };

  const confirmDeleteModel = () => {
    Alert.alert('Delete AI model?', 'Frees storage; auto-parsing falls back to rules only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteModel(db);
            setAiDownloaded(false);
            setAiEnabled(false);
            refresh();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Could not delete model.');
          }
        },
      },
    ]);
  };

  if (!isAvailable) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Auto-log</Text>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={styles.sectionSub}>Auto-log from notifications is only available on Android.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bucketItems = (activeBuckets ?? []).map((b) => ({ id: b.id, label: b.name, icon: b.icon }));
  const categoryItems = (allCategories ?? []).map((c) => ({ id: c.id, label: c.name, icon: c.icon }));

  // The package field doubles as a search box: narrow the app list by label
  // or package name until an exact package is picked/typed.
  const appQuery = packageName.trim().toLowerCase();
  const visibleApps = appQuery
    ? apps.filter(
        (app) =>
          app.label.toLowerCase().includes(appQuery) ||
          app.packageName.toLowerCase().includes(appQuery),
      )
    : apps;

  const sourceValid = packageName.trim() !== '' && bucketId !== undefined;
  const ruleValid = ruleKeyword.trim() !== '' && ruleCategoryId !== undefined;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Auto-log</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Permission</Text>
        <View style={styles.permissionCard}>
          <Text style={granted ? styles.permissionOk : styles.permissionBad}>
            {granted ? 'Listening ✓' : 'Permission needed'}
          </Text>
          <Text style={styles.sectionSub}>
            Kuripot reads bank/e-wallet notifications on-device to auto-log transactions. Nothing
            leaves your phone.
          </Text>
          <Pressable style={styles.action} onPress={openSettings}>
            <Text style={styles.actionTitle}>Open notification access settings</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Sources</Text>
          <Pressable onPress={openSourceModal} hitSlop={8}>
            <Text style={styles.addLink}>＋ Add source</Text>
          </Pressable>
        </View>
        {(sources ?? []).map((source) => {
          const bucketName = allBuckets?.find((b) => b.id === source.bucketId)?.name ?? 'Unknown bucket';
          return (
            <Pressable
              key={source.id}
              style={styles.card}
              onLongPress={() => confirmDeleteSource(source.id, `${bucketName} (${source.packageName})`)}
            >
              <View style={styles.cardMain}>
                <Text style={styles.cardTitle}>{bucketName}</Text>
                <Text style={styles.cardSub}>{source.packageName}</Text>
                {source.matchKeyword && (
                  <View style={styles.keywordChip}>
                    <Text style={styles.keywordChipText}>{source.matchKeyword}</Text>
                  </View>
                )}
              </View>
              <Switch
                value={source.enabled}
                onValueChange={(value) => toggleSource(source.id, value)}
                trackColor={{ false: colors.border, true: colors.goldDim }}
                thumbColor={source.enabled ? colors.gold : colors.inkFaint}
              />
            </Pressable>
          );
        })}
        {sources !== undefined && sources.length === 0 && (
          <Text style={styles.empty}>No sources yet. Add one to start auto-logging.</Text>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Category rules</Text>
          <Pressable onPress={openRuleModal} hitSlop={8}>
            <Text style={styles.addLink}>＋ Add rule</Text>
          </Pressable>
        </View>
        {(rules ?? []).map((rule) => {
          const categoryName = allCategories?.find((c) => c.id === rule.categoryId)?.name ?? 'Unknown category';
          return (
            <Pressable
              key={rule.id}
              style={styles.card}
              onLongPress={() => confirmDeleteRule(rule.id, rule.keyword)}
            >
              <View style={styles.cardMain}>
                <Text style={styles.cardTitle}>
                  {rule.keyword} → {categoryName}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {rules !== undefined && rules.length === 0 && (
          <Text style={styles.empty}>No rules yet. Keywords auto-assign a category on match.</Text>
        )}
        <Text style={styles.hint}>Long-press a row to remove it.</Text>

        {llmSupported && (
          <>
            <Text style={styles.sectionTitle}>AI parsing (beta)</Text>
            <Text style={styles.sectionSub}>
              Runs entirely on this phone. Used only when the regular parser can&apos;t tell expense
              from income.
            </Text>

            {!aiDownloaded && !aiDownloading && (
              <Pressable style={styles.action} onPress={handleDownloadModel}>
                <Text style={styles.actionTitle}>Download AI model</Text>
                <Text style={styles.sectionSub}>
                  ~1 GB · Wi-Fi recommended · runs entirely on your phone
                </Text>
              </Pressable>
            )}

            {aiDownloading && (
              <View style={styles.card}>
                <View style={styles.cardMain}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${aiProgress * 100}%` }]} />
                  </View>
                  <Text style={styles.cardSub}>Downloading… {Math.round(aiProgress * 100)}%</Text>
                </View>
              </View>
            )}

            {aiDownloaded && !aiDownloading && (
              <>
                <View style={styles.card}>
                  <View style={styles.cardMain}>
                    <Text style={styles.cardTitle}>Parse with AI when rules fail</Text>
                  </View>
                  <Switch
                    value={aiEnabled}
                    onValueChange={handleToggleAi}
                    trackColor={{ false: colors.border, true: colors.goldDim }}
                    thumbColor={aiEnabled ? colors.gold : colors.inkFaint}
                  />
                </View>
                <Pressable style={styles.action} onPress={confirmDeleteModel}>
                  <Text style={styles.actionTitle}>Delete model</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={sourceModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSourceModalOpen(false)}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.header}>
              <Text style={styles.title}>Add source</Text>
              <Pressable onPress={() => setSourceModalOpen(false)} hitSlop={8}>
                <Text style={styles.close}>Cancel</Text>
              </Pressable>
            </View>
            <FlatList
              data={visibleApps}
              keyExtractor={(item) => item.packageName}
              contentContainerStyle={formStyles.content}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View style={{ gap: spacing.sm }}>
                  <Text style={formStyles.label}>Package</Text>
                  <TextInput
                    style={formStyles.textInput}
                    value={packageName}
                    onChangeText={setPackageName}
                    placeholder="Search apps, or type a package name"
                    placeholderTextColor={colors.inkFaint}
                    autoCapitalize="none"
                    testID="source-package"
                  />
                  <Text style={formStyles.label}>Installed apps</Text>
                </View>
              }
              renderItem={({ item }) => {
                const selected = item.packageName === packageName;
                return (
                  <Pressable
                    style={[styles.appRow, selected && styles.appRowActive]}
                    onPress={() => setPackageName(item.packageName)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.appLabel}>{item.label}</Text>
                    <Text style={styles.appPkg}>{item.packageName}</Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.hint}>
                  {appQuery ? 'No apps match — the typed package name is used as-is.' : 'No launchable apps found.'}
                </Text>
              }
              ListFooterComponent={
                <View style={{ gap: spacing.sm }}>
                  <Text style={formStyles.label}>Bucket</Text>
                  <ChipRow items={bucketItems} selectedId={bucketId} onSelect={setBucketId} />
                  <Text style={formStyles.label}>Keyword (optional)</Text>
                  <TextInput
                    style={formStyles.textInput}
                    value={keyword}
                    onChangeText={setKeyword}
                    placeholder="e.g. card last 4 digits"
                    placeholderTextColor={colors.inkFaint}
                    testID="source-keyword"
                  />
                  <View style={{ height: spacing.xs }} />
                  <SubmitButton label="Save" disabled={!sourceValid} onPress={saveSource} />
                </View>
              }
            />
          </SafeAreaView>
        </View>
      </Modal>

      <Modal
        visible={ruleModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setRuleModalOpen(false)}
      >
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.header}>
              <Text style={styles.title}>Add rule</Text>
              <Pressable onPress={() => setRuleModalOpen(false)} hitSlop={8}>
                <Text style={styles.close}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
              <Text style={formStyles.label}>Keyword</Text>
              <TextInput
                style={formStyles.textInput}
                value={ruleKeyword}
                onChangeText={setRuleKeyword}
                placeholder="e.g. jollibee"
                placeholderTextColor={colors.inkFaint}
                testID="rule-keyword"
              />
              <Text style={formStyles.label}>Category</Text>
              <ChipRow items={categoryItems} selectedId={ruleCategoryId} onSelect={setRuleCategoryId} />
              <View style={{ height: spacing.xs }} />
              <SubmitButton label="Save" disabled={!ruleValid} onPress={saveRule} />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
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
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  addLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  permissionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  permissionOk: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.income },
  permissionBad: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.danger },
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
  keywordChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 2,
  },
  keywordChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.inkDim },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '90%',
  },
  appRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm + spacing.xs,
    marginBottom: spacing.xs,
  },
  appRowActive: { borderColor: colors.gold, backgroundColor: colors.surfaceRaised },
  appLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  appPkg: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint },
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
