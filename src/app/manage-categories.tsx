import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formStyles } from '@/components/form';
import { Icon } from '@/components/Icon';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { archiveCategory, categoryHasReferences, deleteCategory, listCategories } from '@/db/categoryRepo';
import { Category } from '@/db/schema';
import { colors, fonts, radii, spacing } from '@/theme';

/**
 * The header links are ~18dp of text, so 13dp of vertical slop is what makes
 * them a 44dp target. Horizontal stays at 8 so the `headerActions` gap still
 * clears the two neighbouring slops and "Add"/"Done" keep separate regions.
 */
const HEADER_HIT_SLOP = { top: 13, bottom: 13, left: 8, right: 8 };

export default function ManageCategoriesScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const cats = useAppQuery((db) => listCategories(db));

  const confirmRemove = async (cat: Category) => {
    const hasHistory = await categoryHasReferences(db, cat.id);
    if (hasHistory) {
      Alert.alert(
        'Archive category?',
        `${cat.name} is used by existing records, so it can only be archived. Those records keep their label.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Archive',
            style: 'destructive',
            onPress: async () => {
              await archiveCategory(db, cat.id);
              refresh();
            },
          },
        ],
      );
    } else {
      Alert.alert('Delete category?', `${cat.name} is unused and will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCategory(db, cat.id);
            refresh();
          },
        },
      ]);
    }
  };

  const expense = (cats ?? []).filter((c) => c.type === 'expense');
  const income = (cats ?? []).filter((c) => c.type === 'income');

  const renderCard = (cat: Category) => (
    <View key={cat.id} style={styles.card}>
      <Pressable
        style={styles.cardMain}
        onPress={() => router.push({ pathname: '/edit-category', params: { id: String(cat.id) } })}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${cat.name}`}
      >
        <Icon name={cat.icon} size={16} color={colors.gold} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {cat.name}
        </Text>
      </Pressable>
      <Pressable
        style={styles.remove}
        onPress={() => confirmRemove(cat)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${cat.name}`}
      >
        <Icon name="trash" size={18} color={colors.inkDim} />
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={formStyles.title}>Manage categories</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/add-category')}
            hitSlop={HEADER_HIT_SLOP}
            accessibilityRole="button"
          >
            <Text style={styles.addLink}>＋ Add</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            hitSlop={HEADER_HIT_SLOP}
            accessibilityRole="button"
          >
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.groupLabel}>Expense</Text>
        {expense.map(renderCard)}
        {cats !== undefined && expense.length === 0 && (
          <Text style={styles.empty}>No expense categories.</Text>
        )}

        <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Income</Text>
        {income.map(renderCard)}
        {cats !== undefined && income.length === 0 && (
          <Text style={styles.empty}>No income categories.</Text>
        )}

        <Text style={styles.hint}>
          Tap a category to edit it. Categories with history are archived, never deleted.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingRight: spacing.md,
  },
  // gap must exceed the two 8dp hitSlops combined, or "Add" and "Done" have
  // touch regions that meet edge-to-edge.
  headerActions: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.lg },
  addLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  close: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  groupLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // The padding lives on the two pressables, not here, and `stretch` lets them
  // fill the card's height. With the padding on the card and `alignItems:
  // 'center'`, "Edit" was only the ~20dp text row inside a ~54dp card and the
  // whole 16dp band around it was dead — against the screen's own hint that a
  // category is tapped to edit it.
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.md,
  },
  // Padding rather than hitSlop, so the trash target is a real 50dp-wide,
  // full-card-height box that abuts the Edit box instead of overlapping it —
  // a hitSlop wide enough for 44dp used to spill over the Edit pressable and
  // win, because it renders later.
  remove: { justifyContent: 'center', paddingHorizontal: spacing.md },
  // flexShrink (0 by default in RN) lets a long user-defined category name
  // ellipsize instead of pushing the trash button off the card — the same
  // treatment stats.tsx documents and applies to `categoryName`.
  cardTitle: { flexShrink: 1, fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.md },
});
