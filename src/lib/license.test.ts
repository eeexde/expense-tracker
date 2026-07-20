import { base64urlDecode, base64urlEncode, canonicalPayload, verifyLicense } from './license';
import nacl from 'tweetnacl';

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
  });

  it('produces url-safe output (no +, /, =)', () => {
    const bytes = new Uint8Array([251, 255, 191, 254]);
    const s = base64urlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
  });

  it('decodes without padding', () => {
    // "Ma" -> two bytes
    expect(base64urlDecode('TWE')).toEqual(new Uint8Array([77, 97]));
  });
});

describe('canonicalPayload', () => {
  it('serializes fields in a fixed order regardless of input order', () => {
    const a = canonicalPayload({ buyerId: 'x@y.com', v: 1, issuedAt: '2026-07-20' });
    const b = canonicalPayload({ v: 1, issuedAt: '2026-07-20', buyerId: 'x@y.com' });
    expect(a).toBe(b);
    expect(a).toBe('{"v":1,"buyerId":"x@y.com","issuedAt":"2026-07-20"}');
  });

  it('includes expiresAt only when present, always last', () => {
    expect(canonicalPayload({ v: 1, buyerId: 'x@y.com', issuedAt: '2026-07-20', expiresAt: '2027-07-20' }))
      .toBe('{"v":1,"buyerId":"x@y.com","issuedAt":"2026-07-20","expiresAt":"2027-07-20"}');
  });
});

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Deterministic test keypair (NOT a real key — test only).
const testKp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const testPubHex = bytesToHex(testKp.publicKey);

// Builds a license the way the off-device minter will. The canonical string
// here MUST mirror canonicalPayload in license.ts.
function mint(payload: any, secret: Uint8Array = testKp.secretKey): string {
  const o: any = { v: payload.v, buyerId: payload.buyerId, issuedAt: payload.issuedAt };
  if (payload.expiresAt !== undefined) o.expiresAt = payload.expiresAt;
  const sig = nacl.sign.detached(new TextEncoder().encode(JSON.stringify(o)), secret);
  const env = { p: payload, s: Buffer.from(sig).toString('base64url') };
  return 'kur-' + Buffer.from(JSON.stringify(env)).toString('base64url');
}

describe('verifyLicense', () => {
  const opts = { publicKeyHex: testPubHex };

  it('accepts a valid license', () => {
    const lic = mint({ v: 1, buyerId: 'buyer@x.com', issuedAt: '2026-07-20' });
    expect(verifyLicense(lic, opts)).toEqual({ ok: true, buyerId: 'buyer@x.com' });
  });

  it('rejects a tampered payload', () => {
    const lic = mint({ v: 1, buyerId: 'buyer@x.com', issuedAt: '2026-07-20' });
    // flip the buyer in the envelope without re-signing
    const raw = JSON.parse(Buffer.from(lic.slice(4), 'base64url').toString());
    raw.p.buyerId = 'attacker@x.com';
    const forged = 'kur-' + Buffer.from(JSON.stringify(raw)).toString('base64url');
    expect(verifyLicense(forged, opts).ok).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const other = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9)).secretKey;
    const lic = mint({ v: 1, buyerId: 'buyer@x.com', issuedAt: '2026-07-20' }, other);
    expect(verifyLicense(lic, opts).ok).toBe(false);
  });

  it('rejects an unsupported version', () => {
    const lic = mint({ v: 2, buyerId: 'buyer@x.com', issuedAt: '2026-07-20' });
    expect(verifyLicense(lic, opts).ok).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(verifyLicense('not-a-license', opts).ok).toBe(false);
    expect(verifyLicense('kur-@@@@', opts).ok).toBe(false);
    expect(verifyLicense('', opts).ok).toBe(false);
  });

  it('rejects when no public key is configured', () => {
    const lic = mint({ v: 1, buyerId: 'buyer@x.com', issuedAt: '2026-07-20' });
    expect(verifyLicense(lic, { publicKeyHex: '' }).ok).toBe(false);
  });
});
