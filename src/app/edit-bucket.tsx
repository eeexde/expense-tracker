import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { BucketForm, BucketFormValues } from '@/components/BucketForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { updateBucket } from '@/db/repo';
import { buckets as bucketsTable } from '@/db/schema';

export default function EditBucketScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bucketId = Number(id);

  const bucket = useAppQuery(async (db) => {
    const [row] = await db.select().from(bucketsTable).where(eq(bucketsTable.id, bucketId));
    return row;
  }, [bucketId]);

  const save = async (values: BucketFormValues) => {
    await updateBucket(db, bucketId, values);
    refresh();
    router.back();
  };

  if (!bucket) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>Edit bucket</Text>
      <BucketForm
        initial={{
          name: bucket.name,
          icon: bucket.icon,
          color: bucket.color,
          type: bucket.type,
          startingBalance: bucket.startingBalance,
        }}
        onSubmit={save}
      />
    </SafeAreaView>
  );
}
