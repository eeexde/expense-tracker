import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChipRow,
  formStyles,
  FormTextInput,
  RevealFieldProvider,
  SubmitButton,
  useKeyboardSheetLift,
  useRevealField,
  useSubmitGuard,
} from '@/components/form';
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
import { eq } from 'drizzle-orm';
import { AiParsingSection } from '@/components/AiParsingSection';
import { Icon } from '@/components/Icon';
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

  // Both sheets are pinned to the bottom of the screen, so their inputs sit
  // squarely under the IME unless something lifts them.
  const sourceSheet = useKeyboardSheetLift();
  const ruleSheet = useKeyboardSheetLift();
  // The lift clears each *sheet* of the keyboard; the reveal clears a *field*
  // of its sheet's own scroll viewport, which the 90% cap keeps short. The
  // source sheet's fields ride in a FlatList header/footer with the whole app
  // list between them, so that one can be scrolled a long way out of sight.
  // `slack: 0` — a lifted sheet has no keyboard overlapping it at all.
  const sourceListRef = useRef<FlatList<LaunchableApp>>(null);
  const sourceViewportRef = useRef<View>(null);
  const sourceReveal = useRevealField({
    scrollRef: sourceListRef,
    viewportRef: sourceViewportRef,
    keyboardHeight: sourceSheet.keyboardHeight,
    slack: 0,
  });
  const ruleScrollRef = useRef<ScrollView>(null);
  const ruleViewportRef = useRef<View>(null);
  const ruleReveal = useRevealField({
    scrollRef: ruleScrollRef,
    viewportRef: ruleViewportRef,
    keyboardHeight: ruleSheet.keyboardHeight,
    slack: 0,
  });

  const openSourceModal = () => {
    setApps(getLaunchableApps());
    setPackageName('');
    setBucketId(undefined);
    setKeyword('');
    setSourceModalOpen(true);
  };

  const [savingSource, saveSource] = useSubmitGuard(async () => {
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
  });

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

  const [savingRule, saveRule] = useSubmitGuard(async () => {
    const trimmed = ruleKeyword.trim();
    if (!trimmed || ruleCategoryId === undefined) return;
    try {
      await addCategoryRule(db, { keyword: trimmed, categoryId: ruleCategoryId });
      refresh();
      setRuleModalOpen(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Could not add rule.');
    }
  });

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

  if (!isAvailable) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Auto-log</Text>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
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
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
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
          <Pressable style={styles.action} onPress={openSettings} accessibilityRole="button">
            <Text style={styles.actionTitle}>Open notification access settings</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Sources</Text>
          <Pressable onPress={openSourceModal} hitSlop={8} accessibilityRole="button">
            <Text style={styles.addLink}>＋ Add source</Text>
          </Pressable>
        </View>
        {(sources ?? []).map((source) => {
          const bucketName = allBuckets?.find((b) => b.id === source.bucketId)?.name ?? 'Unknown bucket';
          const sourceLabel = `${bucketName} (${source.packageName})`;
          return (
            <View key={source.id} style={styles.card}>
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
                accessibilityLabel={`Auto-log ${sourceLabel}`}
              />
              <Pressable
                style={styles.remove}
                onPress={() => confirmDeleteSource(source.id, sourceLabel)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${sourceLabel}`}
                testID={`remove-source-${source.id}`}
              >
                <Icon name="trash" size={18} color={colors.inkDim} />
              </Pressable>
            </View>
          );
        })}
        {sources !== undefined && sources.length === 0 && (
          <Text style={styles.empty}>No sources yet. Add one to start auto-logging.</Text>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Category rules</Text>
          <Pressable onPress={openRuleModal} hitSlop={8} accessibilityRole="button">
            <Text style={styles.addLink}>＋ Add rule</Text>
          </Pressable>
        </View>
        {(rules ?? []).map((rule) => {
          const categoryName = allCategories?.find((c) => c.id === rule.categoryId)?.name ?? 'Unknown category';
          return (
            <View key={rule.id} style={styles.card}>
              <View style={styles.cardMain}>
                <Text style={styles.cardTitle}>
                  {rule.keyword} → {categoryName}
                </Text>
              </View>
              <Pressable
                style={styles.remove}
                onPress={() => confirmDeleteRule(rule.id, rule.keyword)}
                accessibilityRole="button"
                accessibilityLabel={`Remove rule ${rule.keyword}`}
                testID={`remove-rule-${rule.id}`}
              >
                <Icon name="trash" size={18} color={colors.inkDim} />
              </Pressable>
            </View>
          );
        })}
        {rules !== undefined && rules.length === 0 && (
          <Text style={styles.empty}>No rules yet. Keywords auto-assign a category on match.</Text>
        )}
        <Text style={styles.hint}>Tap the trash icon on a row to remove it.</Text>

        <AiParsingSection db={db} refresh={refresh} />
      </ScrollView>

      <Modal
        visible={sourceModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSourceModalOpen(false)}
      >
        {/* Padding lifts the whole sheet; the sheet itself is content-sized, so
            a flex:1 wrapper inside it would collapse. The KeyboardAvoidingView
            pads the backdrop, and `useKeyboardSheetLift` pads the anchor with
            whatever slice of keyboard the KAV did not manage to take off it.
            How big that slice is depends on the *device*, not just the build:
            an edge-to-edge Android (device SDK 35+) never resizes the dialog so
            it is the whole keyboard, while Android 14 and below resizes it and
            the slice is 0. Measured, never assumed — see `keyboardSlack`. */}
        <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
          <View
            style={[styles.sheetAnchor, { paddingBottom: sourceSheet.lift }]}
            onLayout={sourceSheet.onLayout}
          >
            <SafeAreaView style={styles.sheet} edges={['bottom']}>
              <View style={styles.header}>
                <Text style={styles.title}>Add source</Text>
                <Pressable
                  onPress={() => setSourceModalOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.close}>Cancel</Text>
                </Pressable>
              </View>
              <RevealFieldProvider reveal={sourceReveal.reveal}>
                <View
                  ref={sourceViewportRef}
                  style={formStyles.scrollViewport}
                  // Android flattens layout-only Views, which would leave
                  // nothing to measure the viewport against.
                  collapsable={false}
                  testID="source-sheet-viewport"
                >
                  <FlatList
                    ref={sourceListRef}
                    data={visibleApps}
                    keyExtractor={(item) => item.packageName}
                    contentContainerStyle={formStyles.content}
                    keyboardShouldPersistTaps="handled"
                    {...sourceReveal.scrollProps}
                    ListHeaderComponent={
                      <View style={{ gap: spacing.sm }}>
                        <Text style={formStyles.label}>Package</Text>
                        <FormTextInput
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
                        <FormTextInput
                          style={formStyles.textInput}
                          value={keyword}
                          onChangeText={setKeyword}
                          placeholder="e.g. card last 4 digits"
                          placeholderTextColor={colors.inkFaint}
                          testID="source-keyword"
                        />
                        <View style={{ height: spacing.xs }} />
                        <SubmitButton
                          label="Save"
                          disabled={!sourceValid}
                          submitting={savingSource}
                          onPress={saveSource}
                        />
                      </View>
                    }
                  />
                </View>
              </RevealFieldProvider>
            </SafeAreaView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={ruleModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setRuleModalOpen(false)}
      >
        <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
          <View
            style={[styles.sheetAnchor, { paddingBottom: ruleSheet.lift }]}
            onLayout={ruleSheet.onLayout}
          >
            <SafeAreaView style={styles.sheet} edges={['bottom']}>
              <View style={styles.header}>
                <Text style={styles.title}>Add rule</Text>
                <Pressable
                  onPress={() => setRuleModalOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.close}>Cancel</Text>
                </Pressable>
              </View>
              <RevealFieldProvider reveal={ruleReveal.reveal}>
                <View
                  ref={ruleViewportRef}
                  style={formStyles.scrollViewport}
                  // Android flattens layout-only Views, which would leave
                  // nothing to measure the viewport against.
                  collapsable={false}
                  testID="rule-sheet-viewport"
                >
                  <ScrollView
                    ref={ruleScrollRef}
                    contentContainerStyle={formStyles.content}
                    keyboardShouldPersistTaps="handled"
                    {...ruleReveal.scrollProps}
                  >
                    <Text style={formStyles.label}>Keyword</Text>
                    <FormTextInput
                      style={formStyles.textInput}
                      value={ruleKeyword}
                      onChangeText={setRuleKeyword}
                      placeholder="e.g. jollibee"
                      placeholderTextColor={colors.inkFaint}
                      returnKeyType="done"
                      testID="rule-keyword"
                    />
                    <Text style={formStyles.label}>Category</Text>
                    <ChipRow
                      items={categoryItems}
                      selectedId={ruleCategoryId}
                      onSelect={setRuleCategoryId}
                    />
                    <View style={{ height: spacing.xs }} />
                    <SubmitButton
                      label="Save"
                      disabled={!ruleValid}
                      submitting={savingRule}
                      onPress={saveRule}
                    />
                  </ScrollView>
                </View>
              </RevealFieldProvider>
            </SafeAreaView>
          </View>
        </KeyboardAvoidingView>
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
  // Removing a source/rule used to be `onLongPress` on the whole card and
  // nothing else, which is not a gesture TalkBack can be relied on to produce —
  // so the rows were undeletable with a screen reader on. Same trailing trash
  // button manage-buckets/manage-categories use. The card keeps its own padding
  // here (there is no full-card Edit pressable to abut), so this only has to be
  // its own 44dp target.
  remove: { justifyContent: 'center', alignItems: 'center', minWidth: 44, minHeight: 44 },
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  /**
   * Separate from `backdrop` so the sheet has a box that shrinks when the
   * KeyboardAvoidingView pads the backdrop — that shrink is what tells
   * `useKeyboardSheetLift` how much of the keyboard is already handled.
   */
  sheetAnchor: { flex: 1, justifyContent: 'flex-end' },
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
});
