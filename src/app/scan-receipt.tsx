import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { recognizeReceiptText, saveReceiptPhoto } from '@/lib/ocr';
import { parseReceipt } from '@/lib/receiptParser';
import { colors, fonts, radii, spacing } from '@/theme';

/**
 * Capture a receipt, OCR it on-device, and prefill the add-transaction form.
 * OCR output only prefills — the user always reviews before saving.
 */
export default function ScanReceiptScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync();
      const photoUri = saveReceiptPhoto(photo.uri);
      const text = await recognizeReceiptText(photoUri);
      const parsed = parseReceipt(text);
      router.replace({
        pathname: '/add-transaction',
        params: {
          amountText:
            parsed.amountCentavos !== null ? (parsed.amountCentavos / 100).toFixed(2) : undefined,
          merchant: parsed.merchant ?? undefined,
          photoUri,
        },
      });
    } catch (e) {
      setError('Could not read the receipt. Try again.');
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.permissionText}>
          Camera access is needed to scan receipts.
        </Text>
        <AnimatedPressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Allow camera</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={() => router.back()}>
          <Text style={styles.cancelText}>Go back</Text>
        </AnimatedPressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <SafeAreaView style={styles.overlay} edges={['bottom', 'top']} pointerEvents="box-none">
        <AnimatedPressable style={styles.close} onPress={() => router.back()} accessibilityLabel="Close">
          <Text style={styles.closeText}>✕</Text>
        </AnimatedPressable>
        <View style={styles.bottom}>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <AnimatedPressable
            scaleTo={0.9}
            style={[styles.shutter, busy && styles.shutterBusy]}
            onPress={capture}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Capture receipt"
          >
            {busy ? <ActivityIndicator color={colors.bg} /> : <View style={styles.shutterInner} />}
          </AnimatedPressable>
          <Text style={styles.hint}>Capture the whole receipt</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  camera: StyleSheet.absoluteFill,
  overlay: { flex: 1, justifyContent: 'space-between' },
  close: {
    alignSelf: 'flex-end',
    margin: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(12, 23, 18, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.ink, fontSize: 18 },
  bottom: { alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.lg },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: { opacity: 0.7 },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    borderColor: colors.bg,
  },
  hint: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  errorText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },
  permissionText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: colors.gold,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.bg },
  cancelText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
});
