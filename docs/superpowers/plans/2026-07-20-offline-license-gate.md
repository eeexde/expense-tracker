# Offline License Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the whole app behind an offline, author-signed license key that a paying user pastes in once to unlock permanently.

**Architecture:** The author holds an Ed25519 private key and mints license strings off-device with a Node script. The app embeds only the public key and verifies license signatures offline (no server, no network). A `LicenseGate` wrapper in the root layout shows a lock screen until a valid key is stored in `expo-secure-store`, then renders the app.

**Tech Stack:** Expo/React Native, TypeScript, `tweetnacl` (pure-JS CJS Ed25519, bundles SHA-512, works in both jest-commonjs and RN/Hermes), `expo-secure-store`, jest (existing `logic` + `ui` projects).

## Global Constraints

- Money columns are integer centavos; dates are `'YYYY-MM-DD'` local strings. (Not touched here, but keep the convention if any code nearby is edited.)
- **Never** put `.test.tsx`/`.test.ts` under `src/app/`. Logic tests go in `src/lib` / `src/db` / `src/__tests__`; screen tests in `src/__tests__` importing via `@/app/<name>`.
- Run tests from repo root with `--testPathIgnorePatterns=".claude"`.
- The **private key never enters the repo or the app bundle.** The app only ever *verifies*. Minting happens off-device.
- License format version is `v: 1`. Unknown `v` verifies as invalid.
- `canonicalPayload()` must produce byte-identical output in `src/lib/license.ts` and `scripts/mint-license.mjs`. Any change to field order/serialization must be mirrored in both.
- Crypto lib is `tweetnacl` (`nacl.sign.detached` / `nacl.sign.detached.verify`). Public key is the 32-byte Ed25519 public key, hex-encoded. The stored private key is tweetnacl's 64-byte secret key, hex-encoded. No separate hash wiring — tweetnacl bundles SHA-512.
- License string prefix is `kur-`.
- `buyerId` is the buyer's email.

---

## File Structure

- `src/lib/license.ts` (new) — pure verification + encoding helpers + app constants (`PUBLIC_KEY_HEX`, `REVOKED_BUYER_IDS`) + `expo-secure-store` wrappers.
- `src/lib/license.test.ts` (new) — unit tests (node `logic` project).
- `src/components/LicenseGate.tsx` (new) — lock screen + gate logic.
- `src/__tests__/license-gate.test.tsx` (new) — component test (`ui` project).
- `scripts/gen-keypair.mjs` (new) — one-off Ed25519 keypair generator.
- `scripts/mint-license.mjs` (new) — per-sale license minter.
- `src/app/_layout.tsx` (modify) — insert `LicenseGate` above `DbProvider`.
- `package.json` (modify) — add deps.
- `.gitignore` (modify) — ignore private key + `licenses.log`.

---

## Task 1: Encoding helpers (base64url + canonical payload)

**Files:**
- Create: `src/lib/license.ts`
- Test: `src/lib/license.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Produces:
  - `base64urlEncode(bytes: Uint8Array): string`
  - `base64urlDecode(str: string): Uint8Array`
  - `LicensePayload = { v: number; buyerId: string; issuedAt: string; expiresAt?: string }`
  - `canonicalPayload(p: LicensePayload): string`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npx expo install expo-secure-store
npm install tweetnacl@^1
```
Expected: `package.json` gains `expo-secure-store` and `tweetnacl`. (tweetnacl ships its own TypeScript types — no `@types` package needed.)

- [ ] **Step 2: Write the failing test**

Create `src/lib/license.test.ts`:
```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/lib/license.test.ts --testPathIgnorePatterns=".claude"`
Expected: FAIL — cannot find module `./license` / exports undefined.

- [ ] **Step 4: Implement the helpers**

Create `src/lib/license.ts`:
```ts
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
```

Note: `base64urlEncode`'s trailing `'-'.repeat(0)` is a no-op kept only to make the "no padding" intent explicit; the reviewer may delete it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/lib/license.test.ts --testPathIgnorePatterns=".claude"`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/license.ts src/lib/license.test.ts
git commit -m "feat: license encoding helpers (base64url, canonical payload)"
```

---

## Task 2: Verify a signed license

**Files:**
- Modify: `src/lib/license.ts`
- Test: `src/lib/license.test.ts`

**Interfaces:**
- Consumes: `base64urlDecode`, `base64urlEncode`, `canonicalPayload`, `LicensePayload` (Task 1).
- Produces:
  - `type VerifyResult = { ok: true; buyerId: string } | { ok: false; reason: string }`
  - `verifyLicense(license: string, opts?: { publicKeyHex?: string; revoked?: string[]; now?: string }): VerifyResult`
  - module constants `PUBLIC_KEY_HEX: string` (empty until keygen) and `REVOKED_BUYER_IDS: string[]`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/license.test.ts`:
```ts
import nacl from 'tweetnacl';
import { verifyLicense } from './license';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/license.test.ts --testPathIgnorePatterns=".claude"`
Expected: FAIL — `verifyLicense` is not exported.

- [ ] **Step 3: Implement `verifyLicense`**

Add to the top of `src/lib/license.ts` (imports) and body:
```ts
import nacl from 'tweetnacl';

/** Author's public key: 32-byte Ed25519 public key, hex. Filled in after
 * running scripts/gen-keypair.mjs. Empty until then → verify always fails. */
export const PUBLIC_KEY_HEX = '';

/** buyerIds whose licenses are no longer honored. Ships in the app bundle. */
export const REVOKED_BUYER_IDS: string[] = [];

const SUPPORTED_VERSION = 1;

export type VerifyResult = { ok: true; buyerId: string } | { ok: false; reason: string };

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
```

Note: `TextEncoder`/`TextDecoder` are available in the jest node env and in React Native (Hermes, RN 0.79+; this app is on 0.86). `import nacl from 'tweetnacl'` works via `esModuleInterop` (already set in the logic jest tsconfig) and under Metro.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/license.test.ts --testPathIgnorePatterns=".claude"`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/license.ts src/lib/license.test.ts
git commit -m "feat: offline Ed25519 license verification"
```

---

## Task 3: Revocation and expiry cases

**Files:**
- Test: `src/lib/license.test.ts`

**Interfaces:**
- Consumes: `verifyLicense` (Task 2). No new production code — this task proves the revoked/expiry branches already implemented in Task 2.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/license.test.ts` inside the `describe('verifyLicense', ...)` block (or a new one reusing `mint`/`testPubHex`):
```ts
describe('verifyLicense revocation + expiry', () => {
  const opts = { publicKeyHex: testPubHex };

  it('rejects a revoked buyerId', () => {
    const lic = mint({ v: 1, buyerId: 'bad@x.com', issuedAt: '2026-07-20' });
    expect(verifyLicense(lic, { ...opts, revoked: ['bad@x.com'] }))
      .toEqual({ ok: false, reason: 'This license was revoked' });
  });

  it('honors expiresAt: past = invalid', () => {
    const lic = mint({ v: 1, buyerId: 'b@x.com', issuedAt: '2026-01-01', expiresAt: '2026-06-01' });
    expect(verifyLicense(lic, { ...opts, now: '2026-07-20' }).ok).toBe(false);
  });

  it('honors expiresAt: future = valid', () => {
    const lic = mint({ v: 1, buyerId: 'b@x.com', issuedAt: '2026-01-01', expiresAt: '2027-01-01' });
    expect(verifyLicense(lic, { ...opts, now: '2026-07-20' })).toEqual({ ok: true, buyerId: 'b@x.com' });
  });

  it('absent expiresAt = perpetual', () => {
    const lic = mint({ v: 1, buyerId: 'b@x.com', issuedAt: '2026-01-01' });
    expect(verifyLicense(lic, { ...opts, now: '2999-01-01' }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/lib/license.test.ts --testPathIgnorePatterns=".claude"`
Expected: PASS (Task 2 already implements these branches). If any fail, fix `verifyLicense` accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/license.test.ts
git commit -m "test: license revocation and expiry cases"
```

---

## Task 4: SecureStore wrappers

**Files:**
- Modify: `src/lib/license.ts`

**Interfaces:**
- Produces:
  - `saveLicense(license: string): Promise<void>`
  - `loadLicense(): Promise<string | null>`
  - `clearLicense(): Promise<void>`

No unit test: these are thin wrappers over the native `expo-secure-store`, which cannot load in the node `logic` jest project. They are exercised through the mocked component test in Task 6 and by a typecheck.

- [ ] **Step 1: Add the wrappers**

Append to `src/lib/license.ts`:
```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/license.ts
git commit -m "feat: secure-store wrappers for license persistence"
```

---

## Task 5: Keypair generator + license minter (off-device scripts)

**Files:**
- Create: `scripts/gen-keypair.mjs`
- Create: `scripts/mint-license.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the `tweetnacl` dep (already installed). Duplicates `canonicalPayload` + `hexToBytes` (documented) so the minted signature matches `src/lib/license.ts`.
- Produces: a license string on stdout compatible with `verifyLicense`.

- [ ] **Step 1: Ignore secrets**

Append to `.gitignore`:
```
# License signing — NEVER commit
.keys/
licenses.log
```

- [ ] **Step 2: Write the keypair generator**

Create `scripts/gen-keypair.mjs`:
```js
// One-off: generate the Ed25519 keypair for license signing.
//   node scripts/gen-keypair.mjs
// Saves the PRIVATE key (tweetnacl 64-byte secret) to .keys/license-ed25519.hex
// (gitignored) and prints the 32-byte PUBLIC key to paste into PUBLIC_KEY_HEX
// in src/lib/license.ts.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import nacl from 'tweetnacl';

const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

if (existsSync('.keys/license-ed25519.hex')) {
  console.error('Refusing to overwrite existing .keys/license-ed25519.hex');
  process.exit(1);
}
const kp = nacl.sign.keyPair(); // tweetnacl uses Node's crypto RNG here
mkdirSync('.keys', { recursive: true });
writeFileSync('.keys/license-ed25519.hex', bytesToHex(kp.secretKey), { mode: 0o600 });

console.log('Private key saved to .keys/license-ed25519.hex (gitignored — back it up).');
console.log('\nPaste this into PUBLIC_KEY_HEX in src/lib/license.ts:\n');
console.log(bytesToHex(kp.publicKey));
```

- [ ] **Step 3: Write the minter**

Create `scripts/mint-license.mjs`:
```js
// Mint a license for a paying buyer:
//   node scripts/mint-license.mjs "buyer@email.com" [expiresAt=YYYY-MM-DD]
// Reads the private key from .keys/license-ed25519.hex (or KURIPOT_LICENSE_KEY).
import { readFileSync, appendFileSync } from 'node:fs';
import nacl from 'tweetnacl';

const hexToBytes = (h) => {
  const o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return o;
};

// MUST stay byte-identical to canonicalPayload in src/lib/license.ts.
function canonicalPayload(p) {
  const o = { v: p.v, buyerId: p.buyerId, issuedAt: p.issuedAt };
  if (p.expiresAt !== undefined) o.expiresAt = p.expiresAt;
  return JSON.stringify(o);
}

const buyerId = process.argv[2];
const expiresAt = process.argv[3];
if (!buyerId) {
  console.error('Usage: node scripts/mint-license.mjs "buyer@email.com" [YYYY-MM-DD]');
  process.exit(1);
}

const secretHex =
  process.env.KURIPOT_LICENSE_KEY?.trim() ||
  readFileSync('.keys/license-ed25519.hex', 'utf8').trim();
const secret = hexToBytes(secretHex);

const issuedAt = new Date().toISOString().slice(0, 10);
const payload = { v: 1, buyerId, issuedAt, ...(expiresAt ? { expiresAt } : {}) };
const sig = nacl.sign.detached(new TextEncoder().encode(canonicalPayload(payload)), secret);
const env = { p: payload, s: Buffer.from(sig).toString('base64url') };
const license = 'kur-' + Buffer.from(JSON.stringify(env)).toString('base64url');

appendFileSync('licenses.log', `${issuedAt}\t${buyerId}\t${expiresAt ?? 'perpetual'}\n`);
console.log(license);
```

- [ ] **Step 4: Ephemeral round-trip verification (no real key, no repo writes)**

Do NOT generate the real production keypair here and do NOT edit `PUBLIC_KEY_HEX` — that is the author's deliberate act (Post-Implementation, below). Instead prove the minter is self-consistent with an ephemeral key, writing nothing into the repo.

Run this self-contained check (git-bash):
```bash
node --input-type=module -e '
import nacl from "tweetnacl";
import { execSync } from "node:child_process";
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => { const o=new Uint8Array(h.length/2); for(let i=0;i<o.length;i++) o[i]=parseInt(h.slice(i*2,i*2+2),16); return o; };
const canonical = (p) => { const o={v:p.v,buyerId:p.buyerId,issuedAt:p.issuedAt}; if(p.expiresAt!==undefined) o.expiresAt=p.expiresAt; return JSON.stringify(o); };
const kp = nacl.sign.keyPair();
const lic = execSync("node scripts/mint-license.mjs test@example.com", { env: { ...process.env, KURIPOT_LICENSE_KEY: bytesToHex(kp.secretKey) } }).toString().trim();
const env = JSON.parse(Buffer.from(lic.slice(4), "base64url").toString());
const ok = nacl.sign.detached.verify(new TextEncoder().encode(canonical(env.p)), Buffer.from(env.s, "base64url"), kp.publicKey);
console.log("prefix ok:", lic.startsWith("kur-"), "buyer:", env.p.buyerId, "verify:", ok);
if (!ok || env.p.buyerId !== "test@example.com") process.exit(1);
'
```
Expected: `prefix ok: true buyer: test@example.com verify: true`. This proves the minter's `canonicalPayload`, envelope shape, and signature match what `verifyLicense` will check. Then remove the stray `licenses.log` line the mint wrote during the test:
```bash
rm -f licenses.log
```
(`licenses.log` is gitignored, so this is just tidiness.)

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-keypair.mjs scripts/mint-license.mjs .gitignore
git commit -m "feat: license keypair generator and minter scripts"
```

Note: `PUBLIC_KEY_HEX` stays empty (`''`) at this commit — the app will not unlock until the author runs `gen-keypair.mjs` and pastes their real public key (Post-Implementation). `.keys/` and `licenses.log` stay untracked. Do NOT `git add src/lib/license.ts` here — it must not change in this task.

---

## Task 6: LicenseGate component + wire into root layout

**Files:**
- Create: `src/components/LicenseGate.tsx`
- Test: `src/__tests__/license-gate.test.tsx`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Consumes: `loadLicense`, `saveLicense`, `verifyLicense` (Tasks 2 & 4); `colors`, `fonts`, `radii`, `spacing` from `@/theme`.
- Produces: `export function LicenseGate({ children }: { children: React.ReactNode })`.

- [ ] **Step 1: Write the failing component test**

Create `src/__tests__/license-gate.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LicenseGate } from '@/components/LicenseGate';

let stored: string | null = null;
jest.mock('@/lib/license', () => ({
  loadLicense: jest.fn(async () => stored),
  saveLicense: jest.fn(async (s: string) => {
    stored = s;
  }),
  verifyLicense: jest.fn((s: string) =>
    s === 'kur-good' ? { ok: true, buyerId: 'b@x.com' } : { ok: false, reason: 'That key is not valid' },
  ),
}));

const Child = () => <Text>UNLOCKED APP</Text>;

describe('LicenseGate', () => {
  beforeEach(() => {
    stored = null;
    jest.clearAllMocks();
  });

  it('shows the lock screen when no license is stored', async () => {
    render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => expect(screen.getByTestId('license-input')).toBeTruthy());
    expect(screen.queryByText('UNLOCKED APP')).toBeNull();
  });

  it('renders children when a valid license is already stored', async () => {
    stored = 'kur-good';
    render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => expect(screen.getByText('UNLOCKED APP')).toBeTruthy());
  });

  it('unlocks after pasting a valid key', async () => {
    render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => screen.getByTestId('license-input'));
    fireEvent.changeText(screen.getByTestId('license-input'), 'kur-good');
    fireEvent.press(screen.getByTestId('license-unlock'));
    await waitFor(() => expect(screen.getByText('UNLOCKED APP')).toBeTruthy());
  });

  it('shows an error and stays locked on an invalid key', async () => {
    render(
      <LicenseGate>
        <Child />
      </LicenseGate>,
    );
    await waitFor(() => screen.getByTestId('license-input'));
    fireEvent.changeText(screen.getByTestId('license-input'), 'kur-bad');
    fireEvent.press(screen.getByTestId('license-unlock'));
    await waitFor(() => expect(screen.getByText('That key is not valid')).toBeTruthy());
    expect(screen.queryByText('UNLOCKED APP')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/license-gate.test.tsx --testPathIgnorePatterns=".claude"`
Expected: FAIL — cannot find module `@/components/LicenseGate`.

- [ ] **Step 3: Implement the component**

Create `src/components/LicenseGate.tsx`:
```tsx
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { loadLicense, saveLicense, verifyLicense } from '@/lib/license';
import { colors, fonts, radii, spacing } from '@/theme';

type Phase = 'checking' | 'locked' | 'unlocked';

/**
 * Whole-app gate. Renders children only when a valid license is stored.
 * Re-verifies the signature from storage on every launch — there is no cached
 * "unlocked" boolean, so flipping a flag cannot bypass the gate.
 */
export function LicenseGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLicense().then((stored) => {
      if (cancelled) return;
      setPhase(stored && verifyLicense(stored).ok ? 'unlocked' : 'locked');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = async () => {
    const result = verifyLicense(input.trim());
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    await saveLicense(input.trim());
    setError(null);
    setPhase('unlocked');
  };

  if (phase === 'unlocked') return <>{children}</>;

  if (phase === 'checking') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Unlock Kuripot</Text>
        <Text style={styles.body}>
          Paste the license key you received after purchase. Keep it safe — you&apos;ll need it again
          if you reinstall the app.
        </Text>
        <TextInput
          testID="license-input"
          style={styles.input}
          value={input}
          onChangeText={(t) => {
            setInput(t);
            setError(null);
          }}
          placeholder="kur-..."
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable testID="license-unlock" style={styles.button} onPress={unlock}>
          <Text style={styles.buttonText}>Unlock</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.lg },
  center: { alignItems: 'center' },
  card: { gap: spacing.md },
  title: { fontFamily: fonts.displayBlack, fontSize: 28, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkDim },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 88,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.danger },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.bg },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/license-gate.test.tsx --testPathIgnorePatterns=".claude"`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the root layout**

In `src/app/_layout.tsx`, add the import next to the other component imports:
```tsx
import { LicenseGate } from '@/components/LicenseGate';
```
Change the provider stack so `LicenseGate` sits inside `ErrorBoundary` but **outside** `DbProvider`:
```tsx
  return (
    <ErrorBoundary>
      <LicenseGate>
        <DbProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            {/* ...existing <Stack.Screen /> entries unchanged... */}
          </Stack>
        </DbProvider>
      </LicenseGate>
    </ErrorBoundary>
  );
```
(Keep every existing `<Stack.Screen>` line exactly as-is; only the two wrapper lines around `DbProvider` change.)

- [ ] **Step 6: Full verification**

Run:
```bash
npx tsc --noEmit
npx expo lint
npx jest --testPathIgnorePatterns=".claude"
```
Expected: typecheck exit 0; lint 0 errors; all suites pass (including the two new files).

- [ ] **Step 7: Commit**

```bash
git add src/components/LicenseGate.tsx src/__tests__/license-gate.test.tsx src/app/_layout.tsx
git commit -m "feat: whole-app license gate at root layout"
```

---

## Post-Implementation (author's manual step — NOT a subagent task)

After all tasks are merged, the author activates licensing on their own machine:

1. `node scripts/gen-keypair.mjs` — writes the private key to `.keys/license-ed25519.hex` (gitignored) and prints the public key. **Back up the private key** (password manager); losing it means no new licenses can be minted.
2. Paste the printed public key into `PUBLIC_KEY_HEX` in `src/lib/license.ts`, commit, and build the APK. Until this is done, `verifyLicense` fails closed and the app stays locked for everyone.
3. Per sale: `node scripts/mint-license.mjs "buyer@email.com"` → send the printed `kur-...` string to the buyer.

## Self-Review Notes

- **Spec coverage:** minting tool (Tasks 5), `license.ts` verify + storage (Tasks 1–4), `LicenseGate` + `_layout` wiring (Task 6), SecureStore-not-DB storage (Task 4), re-verify-every-launch (Task 6 Step 3), revocation + optional expiry (Tasks 2–3), `tweetnacl` dep (Task 1), edge cases (Task 6 tests + verify reasons). Covered.
- **Client-side-only limitation** is documented in the spec and inherent to the approach; no task attempts server attestation (out of scope).
- **canonicalPayload duplication** between `license.ts` and `mint-license.mjs` is intentional and flagged in both files + Global Constraints.
- **AI gate unaffected:** `llmEnabled` already sits behind the whole-app gate; no change needed.
