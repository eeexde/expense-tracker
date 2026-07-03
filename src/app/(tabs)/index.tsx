import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing } from '@/theme';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>Kuripot</Text>
        <Text style={styles.subtitle}>Home — coming in Task 10</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.displayBlack, fontSize: 32, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
});
