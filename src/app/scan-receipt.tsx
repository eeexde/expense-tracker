import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';

/** Camera + OCR capture — implemented in Task 11. */
export default function ScanReceiptScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>Receipt scanner — coming in Task 11</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
});
