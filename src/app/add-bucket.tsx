import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BucketForm, BucketFormValues } from '@/components/BucketForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { createBucket } from '@/db/repo';

export default function AddBucketScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const save = async (values: BucketFormValues) => {
    await createBucket(db, values);
    refresh();
    router.back();
  };

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New bucket</Text>
      <BucketForm onSubmit={save} />
    </SafeAreaView>
  );
}
