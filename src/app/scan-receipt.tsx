import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { recognizeReceiptText, saveReceiptPhoto } from '@/lib/ocr';
import { parseTransactionImage } from '@/lib/receiptParser';
import { colors, fonts, radii, spacing } from '@/theme';

/**
 * Capture a receipt with the camera or pick one from the gallery, OCR it
 * on-device, and prefill the add-transaction form. OCR output only
 * prefills — the user always reviews before saving.
 */
export default function ScanReceiptScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // OCR keeps running after the screen goes away. Without this flag a run that
  // resolves post-exit would `router.replace` the user into a prefilled
  // add-transaction form from wherever they navigated to instead.
  const gone = useRef(false);
  useEffect(
    () => () => {
      gone.current = true;
    },
    [],
  );

  // The generated permission hook fetches the status exactly once, on mount.
  // Granting camera access in system settings does not restart the app (Android
  // only kills the process on a REVOKE), so without this re-read the "Open
  // settings" escape hatch below is a dead end: the user comes back having
  // enabled the camera and still sees the denial screen. Same AppState pattern
  // as auto-log's notification-access check.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  /**
   * Leaves the screen and abandons any OCR still in flight. `gone` is latched
   * before navigating, so the exit has to actually happen: deep-linked straight
   * into /scan-receipt there is nothing to pop, and a bare `back()` would leave
   * the screen mounted and permanently inert — captures would set `busy`, drop
   * their result, and never clear it or show an error.
   */
  const close = () => {
    gone.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /** Shared tail of both flows: OCR, parse, persist, prefill the form. */
  const processImage = async (uri: string) => {
    // OCR the source image and only copy it into permanent storage once the
    // screen is still there to use it. ML Kit reads any local path, so the copy
    // buys nothing before this point — and running it first orphaned a full-size
    // photo in documents/receipts on every abandoned scan, with nothing that
    // ever collects them.
    const text = await recognizeReceiptText(uri);
    if (gone.current) return;
    const photoUri = saveReceiptPhoto(uri);
    const parsed = parseTransactionImage(text);
    router.replace({
      pathname: '/add-transaction',
      params: {
        amountText:
          parsed.amountCentavos !== null ? (parsed.amountCentavos / 100).toFixed(2) : undefined,
        merchant: parsed.merchant ?? undefined,
        // Screenshots of received money prefill income; everything else
        // keeps the form's expense default.
        kind: parsed.direction === 'income' ? 'income' : undefined,
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
    } catch {
      if (gone.current) return;
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
    } catch {
      if (gone.current) return;
      setError('Could not read that image. Try another one.');
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    // Once the OS stops allowing prompts (permanent denial), requestPermission()
    // silently no-ops — the only way back is the system settings screen. Same
    // idea as auto-log's "Open notification access settings" escape hatch.
    const blocked = !permission.canAskAgain;
    // Camera access is optional: gallery ingestion still works without it.
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.permissionText}>
          {blocked
            ? 'Camera access is turned off for Kuripot. Enable it in system settings to scan receipts, or pick a photo from your gallery instead.'
            : 'Camera access is needed to scan receipts. You can also pick a photo from your gallery.'}
        </Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          style={styles.primaryButton}
          onPress={blocked ? () => Linking.openSettings() : requestPermission}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {blocked ? 'Open settings' : 'Allow camera'}
          </Text>
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
        <Pressable style={styles.cancelButton} onPress={close} accessibilityRole="button">
          <Text style={styles.cancelText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <SafeAreaView style={styles.overlay} edges={['bottom', 'top']} pointerEvents="box-none">
        <Pressable
          style={styles.close}
          onPress={close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
  cancelButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  cancelText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkDim },
});
