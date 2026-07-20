import { base64urlDecode, base64urlEncode, canonicalPayload } from './license';

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
