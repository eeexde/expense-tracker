import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { formStyles } from '@/components/form';
import { Icon } from '@/components/Icon';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { allBucketBalances, archiveBucket, bucketHasReferences, deleteBucket } from '@/db/repo';
import { Bucket } from '@/db/schema';
import { formatPeso } from '@/lib/money';
import { colors, fonts, radii, spacing } from '@/theme';

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
        <AnimatedPressable onPress={() => router.push('/add-bucket')} hitSlop={8}>
          <Text style={styles.addLink}>＋ Add</Text>
        </AnimatedPressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {(balances ?? []).map(({ bucket, balance }, index) => (
          <Animated.View
            key={bucket.id}
            entering={FadeInDown.delay(index * 40).springify().damping(18)}
            style={styles.card}
          >
            <AnimatedPressable
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
            </AnimatedPressable>
            <AnimatedPressable
              onPress={() => confirmRemove(bucket)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${bucket.name}`}
            >
              <Icon name="trash" size={18} color={colors.inkDim} />
            </AnimatedPressable>
          </Animated.View>
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
  addLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
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
