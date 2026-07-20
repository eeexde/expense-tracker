/**
 * Offline license verification. The app ONLY verifies — minting happens
 * off-device with the private key (see scripts/mint-license.mjs). No network.
 */

import nacl from 'tweetnacl';

/** Author's public key: 32-byte Ed25519 public key, hex. Filled in after
 * running scripts/gen-keypair.mjs. Empty until then → verify always fails. */
export const PUBLIC_KEY_HEX = '';

/** buyerIds whose licenses are no longer honored. Ships in the app bundle. */
export const REVOKED_BUYER_IDS: string[] = [];

export type VerifyResult = { ok: true; buyerId: string } | { ok: false; reason: string };

export interface LicensePayload {
  v: number;
  buyerId: string;
  issuedAt: string; // YYYY-MM-DD
  expiresAt?: string; // YYYY-MM-DD; absent = perpetual
}

// RFC 4648 §5 base64url alphabet: standard base64 with +/ replaced by -_ (64 chars).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out; // url-safe alphabet excludes + / =; no padding emitted
}

export function base64urlDecode(str: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  // Keep base64url data chars incl. - and _; drop only stray whitespace/other.
  const clean = str.replace(/[^A-Za-z0-9_-]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)];
    const c1 = lookup[clean.charCodeAt(i + 1)];
    const c2 = i + 2 < clean.length ? lookup[clean.charCodeAt(i + 2)] : -1;
    const c3 = i + 3 < clean.length ? lookup[clean.charCodeAt(i + 3)] : -1;
    out.push((c0 << 2) | (c1 >> 4));
    if (c2 !== -1) out.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 !== -1) out.push(((c2 & 3) << 6) | c3);
  }
  return new Uint8Array(out);
}

/**
 * Deterministic serialization signed by the minter and re-derived on verify.
 * MUST stay byte-identical to canonicalPayload in scripts/mint-license.mjs.
 */
export function canonicalPayload(p: LicensePayload): string {
  const ordered: Record<string, unknown> = {
    v: p.v,
    buyerId: p.buyerId,
    issuedAt: p.issuedAt,
  };
  if (p.expiresAt !== undefined) ordered.expiresAt = p.expiresAt;
  return JSON.stringify(ordered);
}

const SUPPORTED_VERSION = 1;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function verifyLicense(
  license: string,
  opts: { publicKeyHex?: string; revoked?: string[]; now?: string } = {},
): VerifyResult {
  const publicKeyHex = opts.publicKeyHex ?? PUBLIC_KEY_HEX;
  const revoked = opts.revoked ?? REVOKED_BUYER_IDS;
  if (!publicKeyHex) return { ok: false, reason: 'No public key configured' };
  if (!license.startsWith('kur-')) return { ok: false, reason: 'Not a Kuripot license' };

  let env: { p: LicensePayload; s: string };
  try {
    const json = new TextDecoder().decode(base64urlDecode(license.slice(4)));
    env = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'That key is not valid' };
  }
  const p = env?.p;
  if (!p || typeof p.buyerId !== 'string' || typeof p.issuedAt !== 'string') {
    return { ok: false, reason: 'That key is not valid' };
  }
  if (p.v !== SUPPORTED_VERSION) return { ok: false, reason: 'Unsupported license version' };

  let valid = false;
  try {
    const msg = new TextEncoder().encode(canonicalPayload(p));
    const sig = base64urlDecode(env.s);
    valid = nacl.sign.detached.verify(msg, sig, hexToBytes(publicKeyHex));
  } catch {
    // nacl throws on wrong-length sig/key; treat as invalid.
    return { ok: false, reason: 'That key is not valid' };
  }
  if (!valid) return { ok: false, reason: 'That key is not valid' };

  if (revoked.includes(p.buyerId)) return { ok: false, reason: 'This license was revoked' };

  if (p.expiresAt) {
    const now = opts.now ?? new Date().toISOString().slice(0, 10);
    if (p.expiresAt < now) return { ok: false, reason: 'This license has expired' };
  }
  return { ok: true, buyerId: p.buyerId };
}

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
