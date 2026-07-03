import TextRecognition from '@react-native-ml-kit/text-recognition';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Move a just-captured photo into permanent storage so the transaction can
 * reference it after the camera cache is cleared.
 */
export function saveReceiptPhoto(tempUri: string): string {
  const dir = new Directory(Paths.document, 'receipts');
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `receipt-${Date.now()}.jpg`);
  new File(tempUri).copy(dest);
  return dest.uri;
}

/** On-device ML Kit text recognition (Latin script covers PH receipts). */
export async function recognizeReceiptText(photoUri: string): Promise<string> {
  const result = await TextRecognition.recognize(photoUri);
  return result.text;
}
