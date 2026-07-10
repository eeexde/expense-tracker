import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface CapturedEntry {
  packageName: string;
  title: string | null;
  text: string;
  postedAt: string;
  key: string;
}

export interface LaunchableApp {
  label: string;
  packageName: string;
}

interface NativeModuleShape {
  isPermissionGranted(): boolean;
  openSettings(): void;
  setWatchedPackages(packages: string[]): void;
  drainBuffer(): string;
  getLaunchableApps(): LaunchableApp[];
  addListener(event: string, cb: (payload: { entry: string }) => void): { remove(): void };
}

const native: NativeModuleShape | null =
  Platform.OS === 'android' ? requireNativeModule('NotificationListener') : null;

export const isAvailable = native !== null;

export function isPermissionGranted(): boolean {
  return native?.isPermissionGranted() ?? false;
}

export function openSettings(): void {
  native?.openSettings();
}

export function setWatchedPackages(packages: string[]): void {
  native?.setWatchedPackages(packages);
}

export function drainBuffer(): CapturedEntry[] {
  if (!native) return [];
  try {
    return JSON.parse(native.drainBuffer());
  } catch {
    return [];
  }
}

export function getLaunchableApps(): LaunchableApp[] {
  return native?.getLaunchableApps() ?? [];
}

/** Fires while the app is alive and a watched notification arrives. */
export function addCapturedListener(cb: (entry: CapturedEntry) => void): { remove(): void } {
  if (!native) return { remove: () => {} };
  return native.addListener('onNotificationCaptured', ({ entry }) => {
    try {
      cb(JSON.parse(entry));
    } catch {
      // corrupt payload — skip
    }
  });
}
