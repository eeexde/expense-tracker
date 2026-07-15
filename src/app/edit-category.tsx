import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eq } from 'drizzle-orm';
import { CategoryForm, CategoryFormValues } from '@/components/CategoryForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { useAppQuery } from '@/db/hooks';
import { updateCategory } from '@/db/categoryRepo';
import { categories as categoriesTable } from '@/db/schema';

export default function EditCategoryScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const categoryId = Number(id);

  const category = useAppQuery(async (db) => {
    const [row] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, categoryId));
    return row;
  }, [categoryId]);

  const save = async (values: CategoryFormValues) => {
    await updateCategory(db, categoryId, { name: values.name, icon: values.icon });
    refresh();
    router.back();
  };

  if (!category) return <SafeAreaView style={formStyles.screen} />;

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>Edit category</Text>
      <CategoryForm
        initial={{ name: category.name, icon: category.icon, type: category.type }}
        lockType
        onSubmit={save}
      />
    </SafeAreaView>
  );
}
