import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { recognizeReceiptText, saveReceiptPhoto } from '@/lib/ocr';
import { parseReceipt } from '@/lib/receiptParser';
import { colors, fonts, radii, spacing } from '@/theme';

/**
 * Capture a receipt with the camera or pick one from the gallery, OCR it
 * on-device, and prefill the add-transaction form. OCR output only
 * prefills — the user always reviews before saving.
 */
export default function ScanReceiptScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Shared tail of both flows: persist, OCR, parse, prefill the form. */
  const processImage = async (uri: string) => {
    const photoUri = saveReceiptPhoto(uri);
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
  };

  const capture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync();
      await processImage(photo.uri);
    } catch (e) {
      setError('Could not read the receipt. Try again.');
      setBusy(false);
    }
  };

  const pickFromGallery = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled) {
        setBusy(false);
        return;
      }
      await processImage(result.assets[0].uri);
    } catch (e) {
      setError('Could not read that image. Try another one.');
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    // Camera access is optional: gallery ingestion still works without it.
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.permissionText}>
          Camera access is needed to scan receipts. You can also pick a photo from your gallery.
        </Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={styles.primaryButton} onPress={requestPermission} disabled={busy}>
          <Text style={styles.primaryButtonText}>Allow camera</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={pickFromGallery}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Choose from gallery"
        >
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <>
              <Icon name="image" size={16} color={colors.ink} />
              <Text style={styles.secondaryButtonText}>Choose from gallery</Text>
            </>
          )}
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancelText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <SafeAreaView style={styles.overlay} edges={['bottom', 'top']} pointerEvents="box-none">
        <Pressable style={styles.close} onPress={() => router.back()} accessibilityLabel="Close">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View style={styles.bottom}>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.controls}>
            <Pressable
              style={[styles.galleryButton, busy && styles.controlBusy]}
              onPress={pickFromGallery}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Pick receipt from gallery"
            >
              <Icon name="image" size={22} color={colors.ink} />
            </Pressable>
            <Pressable
              style={[styles.shutter, busy && styles.controlBusy]}
              onPress={capture}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Capture receipt"
            >
              {busy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>
            <View style={styles.galleryButtonSpacer} />
          </View>
          <Text style={styles.hint}>Capture the whole receipt, or pick it from your gallery</Text>
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
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBusy: { opacity: 0.7 },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    borderColor: colors.bg,
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(12, 23, 18, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Mirrors the gallery button so the shutter stays centered.
  galleryButtonSpacer: { width: 48, height: 48 },
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
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  cancelText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
});
