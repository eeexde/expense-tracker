/**
 * Offline license verification. The app ONLY verifies — minting happens
 * off-device with the private key (see scripts/mint-license.mjs). No network.
 */

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
