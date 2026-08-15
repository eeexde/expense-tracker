import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formStyles } from '@/components/form';
import { Icon } from '@/components/Icon';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { allBucketBalances, archiveBucket, bucketHasReferences, deleteBucket } from '@/db/repo';
import { Bucket } from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

/**
 * The header links are ~18dp of text, so 13dp of vertical slop is what makes
 * them a 44dp target. Horizontal stays at 8 so the `headerActions` gap still
 * clears the two neighbouring slops and "Add"/"Done" keep separate regions.
 */
const HEADER_HIT_SLOP = { top: 13, bottom: 13, left: 8, right: 8 };

export default function ManageBucketsScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const balances = useAppQuery((db) => allBucketBalances(db));

  const confirmRemove = async (bucket: Bucket) => {
    const hasHistory = await bucketHasReferences(db, bucket.id);
    if (hasHistory) {
      Alert.alert(
        'Archive bucket?',
        `${bucket.name} has transaction history, so it can only be archived. Its history stays intact.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Archive',
            style: 'destructive',
            onPress: async () => {
              await archiveBucket(db, bucket.id);
              refresh();
            },
          },
        ],
      );
    } else {
      Alert.alert('Delete bucket?', `${bucket.name} has no transactions and will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteBucket(db, bucket.id);
            refresh();
          },
        },
      ]);
    }
  };

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={formStyles.title}>Manage buckets</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/add-bucket')}
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
        {(balances ?? []).map(({ bucket, balance }) => (
          <View key={bucket.id} style={styles.card}>
            <Pressable
              style={styles.cardMain}
              onPress={() => router.push({ pathname: '/edit-bucket', params: { id: String(bucket.id) } })}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${bucket.name}`}
            >
              <View style={styles.titleRow}>
                <Icon name={bucket.icon} size={16} color={colors.gold} />
                <Text style={styles.cardTitle}>{bucket.name}</Text>
                {bucket.type === 'credit' && <Text style={styles.creditTag}>CREDIT</Text>}
              </View>
              <Text style={styles.cardSub}>
                {balance < 0 ? `−${formatPeso(-balance)}` : formatPeso(balance)}
              </Text>
            </Pressable>
            <Pressable
              style={styles.remove}
              onPress={() => confirmRemove(bucket)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${bucket.name}`}
            >
              <Icon name="trash" size={18} color={colors.inkDim} />
            </Pressable>
          </View>
        ))}
        {balances !== undefined && balances.length === 0 && (
          <Text style={styles.empty}>No buckets yet. Add one to get started.</Text>
        )}
        <Text style={styles.hint}>
          Tap a bucket to edit it. Buckets with history are archived, never deleted.
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
  // The padding lives on the two pressables, not here, and `stretch` lets them
  // fill the card's height. With the padding on the card and `alignItems:
  // 'center'`, "Edit" was only the ~40dp text block inside a ~72dp card and the
  // whole 16dp band around it was dead — against the screen's own hint that a
  // bucket is tapped to edit it.
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  cardMain: { flex: 1, gap: 2, justifyContent: 'center', minHeight: 44, padding: spacing.md },
  // Padding rather than hitSlop, so the trash target is a real 50dp-wide,
  // full-card-height box that abuts the Edit box instead of overlapping it —
  // a hitSlop wide enough for 44dp used to spill over the Edit pressable and
  // win, because it renders later.
  remove: { justifyContent: 'center', paddingHorizontal: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  creditTag: {
    fontFamily: fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.inkFaint,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs + 1,
    paddingVertical: 1,
  },
  cardSub: { fontFamily: fonts.display, fontSize: 14, color: colors.inkDim },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, paddingVertical: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, marginTop: spacing.xs },
});
