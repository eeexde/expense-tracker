import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { ExportPayload } from '@/db/dataTransfer';

/** Human-friendly backup filename: kuripot-backup-2026-07-06.json. */
function backupFilename(today: string): string {
  return `kuripot-backup-${today}.json`;
}

/**
 * Writes the payload to a cache file and opens the share sheet so the user
 * can save it to Files, Drive, email, etc. Returns false if sharing is
 * unavailable on the device.
 */
export async function shareBackup(payload: ExportPayload, today: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, backupFilename(today));
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(payload, null, 2));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Export Kuripot data',
    UTI: 'public.json',
  });
  return true;
}

/**
 * Opens the file picker and parses the chosen JSON. Returns the parsed object
 * (validated later by importData) or null if the user cancels.
 * @throws when the file isn't valid JSON.
 */
export async function pickBackup(): Promise<unknown | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const file = new File(result.assets[0].uri);
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
}
