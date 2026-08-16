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

/**
 * What the OS setting says, and what the service is actually doing.
 *
 * They disagree after an APK update: Android unbinds the listener but leaves
 * `enabled_notification_listeners` naming us (CLAUDE.md documents the toggle
 * off/on cure), so permission alone must never be rendered as "listening".
 */
export interface ListenerStatus {
  /** The user granted notification access. Says nothing about liveness. */
  enabledInSettings: boolean;
  /**
   * The service is bound to this process right now. `true` is proof it is
   * live; `false` can also mean the bind has not landed yet in a process that
   * only just started, so it is not proof of the opposite.
   */
  connected: boolean;
  /**
   * Epoch millis of the last notification the service saw (any app), or 0 if
   * it has never seen one. Persisted, so it outlives the process.
   */
  lastSeenAtMillis: number;
}

const UNAVAILABLE: ListenerStatus = {
  enabledInSettings: false,
  connected: false,
  lastSeenAtMillis: 0,
};

interface NativeModuleShape {
  isPermissionGranted(): boolean;
  getListenerStatus(): string;
  requestRebind(): void;
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
  try {
    return native?.isPermissionGranted() ?? false;
  } catch {
    // A native build that does not have this function at all.
    return false;
  }
}

/** Permission plus liveness. Never throws; an unusable module reads as "off". */
export function getListenerStatus(): ListenerStatus {
  if (!native) return UNAVAILABLE;
  try {
    const parsed = JSON.parse(native.getListenerStatus()) as Partial<ListenerStatus>;
    return {
      enabledInSettings: parsed.enabledInSettings === true,
      connected: parsed.connected === true,
      lastSeenAtMillis: Number(parsed.lastSeenAtMillis) || 0,
    };
  } catch {
    // An older native build without this function, or a corrupt payload: fall
    // back to the one thing every build can answer.
    return { ...UNAVAILABLE, enabledInSettings: isPermissionGranted() };
  }
}

/** Asks Android to bind the listener again after it dropped it. Best-effort. */
export function requestRebind(): void {
  try {
    native?.requestRebind();
  } catch {
    // Older native build, or the OS refused — the caller has a fallback.
  }
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
