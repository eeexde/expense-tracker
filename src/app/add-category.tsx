import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CategoryForm, CategoryFormValues } from '@/components/CategoryForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { createCategory } from '@/db/categoryRepo';

export default function AddCategoryScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const save = async (values: CategoryFormValues) => {
    await createCategory(db, values);
    refresh();
    router.back();
  };

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New category</Text>
      <CategoryForm onSubmit={save} />
    </SafeAreaView>
  );
}
