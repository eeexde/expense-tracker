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
        <Text style={styles.cardTitle}>{cat.name}</Text>
      </Pressable>
      <Pressable
        onPress={() => confirmRemove(cat)}
        hitSlop={8}
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
        <Pressable onPress={() => router.push('/add-category')} hitSlop={8}>
          <Text style={styles.addLink}>＋ Add</Text>
        </Pressable>
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
  addLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  groupLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.inkDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
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
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.md },
});
