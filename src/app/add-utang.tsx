import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UtangForm, UtangFormValues } from '@/components/UtangForm';
import { formStyles } from '@/components/form';
import { useDb } from '@/db/DbProvider';
import { addUtang } from '@/db/utangRepo';

export default function AddUtangScreen() {
  const router = useRouter();
  const { db, refresh } = useDb();

  const save = async (values: UtangFormValues) => {
    await addUtang(db, values);
    refresh();
    router.back();
  };

  return (
    <SafeAreaView style={formStyles.screen} edges={['top', 'bottom']}>
      <Text style={formStyles.title}>New utang</Text>
      <UtangForm onSubmit={save} />
    </SafeAreaView>
  );
}
