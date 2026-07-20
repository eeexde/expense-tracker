import * as SecureStore from 'expo-secure-store';

const LICENSE_KEY = 'kuripot.license';

/** Persist the raw license string in the OS keystore (never in the SQLite DB,
 * so it stays out of JSON data exports). */
export async function saveLicense(license: string): Promise<void> {
  await SecureStore.setItemAsync(LICENSE_KEY, license);
}

export async function loadLicense(): Promise<string | null> {
  return SecureStore.getItemAsync(LICENSE_KEY);
}

export async function clearLicense(): Promise<void> {
  await SecureStore.deleteItemAsync(LICENSE_KEY);
}
