# Offline license gate — design

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan
**Author:** Claude + edrianthelazy

## Problem

Kuripot is distributed as a sideloaded, signed APK (no Play Store yet). The
author wants to charge for the app and hand a paid user something that unlocks
it, without running a server (which would add data-privacy liability and ops).

An APK cannot enforce "single install" or "expiring link" DRM — the file is
copyable and re-sideloadable forever. So the *gate is not the APK*; the gate is
a **license key** the user enters in the app.

## Decision summary

- **Whole-app gate**, not per-feature. No valid license → app is unusable (lock
  screen at launch). Valid license → full app.
- **Perpetual license** (pay once, unlock forever). No renewal logic built now,
  but the payload carries an optional `expiresAt` so switching to subscriptions
  later needs no format change.
- **Offline Ed25519 verification.** Author holds a private key and mints license
  strings off-device; the app embeds only the public key and verifies offline.
- **No trial.** The author only sends the APK to people who have paid.

### Accepted security limitation

A whole-app gate with no server is **client-side only**: a skilled person can
patch the APK to skip the check. This is unpreventable without server
attestation and is an accepted risk at friends / manual-payment scale. The gate
stops casual sharing, not a determined attacker.

## Rejected alternatives

- **HMAC shared-secret keys** — the secret ships inside the app; extract it once
  and anyone can mint unlimited keys. Rejected.
- **Hashed allow-list shipped in app** — every new buyer needs an app update to
  be admitted. Operationally awful. Rejected.
- **Per-user built APK with embedded token** — one EAS build per sale, no Play
  auto-updates (manual re-send every release). Unscalable. Rejected.
- **Server-checked paid flag / cloud accounts** — rejected earlier: adds DPA
  liability and ops the author does not want.

## License format

```
license string = base64url( JSON({ p, s }) )

p (payload) = {
  v: 1,                       // format version
  buyerId: string,            // buyer email or name; shown when unlocked
  issuedAt: "YYYY-MM-DD",
  expiresAt?: "YYYY-MM-DD"    // optional; absent = perpetual
}
s (signature) = base64url( ed25519_sign(privateKey, canonicalJSON(p)) )
```

- `canonicalJSON(p)` = JSON with keys serialized in a fixed order, so signing and
  verifying produce identical bytes.
- `v` gates future format changes: an unknown `v` verifies as invalid.

## Components

### 1. Minting tool (off-device) — `scripts/mint-license.mjs`

- Node script run by the author: `node scripts/mint-license.mjs "buyer@email"`.
- Reads the **private key** from a gitignored file or env var (never committed).
- Prints the license string to stdout and appends a record
  (`buyerId, issuedAt`) to a gitignored `licenses.log` for the author's records.
- A companion one-off `scripts/gen-keypair.mjs` generates the Ed25519 keypair;
  the author commits only the public key (into app source) and keeps the private
  key out of the repo.

### 2. Verification module — `src/lib/license.ts`

Pure logic, unit-testable, no React/Expo imports except SecureStore wrappers
kept in separate functions.

- `verifyLicense(str): { ok: true; buyerId: string } | { ok: false; reason: string }`
  - decode base64url → parse JSON → check `v` supported
  - `ed25519_verify(PUBLIC_KEY, canonicalJSON(p), s)`
  - reject if `buyerId` in `REVOKED_BUYER_IDS`
  - if `expiresAt` present, reject if past (uses device date; irrelevant while
    perpetual)
- `saveLicense(str)`, `loadLicense(): Promise<string | null>`, `clearLicense()`
  — thin wrappers over `expo-secure-store`.
- `PUBLIC_KEY` and `REVOKED_BUYER_IDS` are module constants shipped in the app.

Embeds `@noble/ed25519` (pure JS, Expo-safe, no native module).

### 3. Gate UI — `src/components/LicenseGate.tsx`

- Wraps the app tree inside `_layout.tsx`, positioned **below `ErrorBoundary` and
  `DbProvider`** so DB is available and gate errors are caught.
- On mount: `loadLicense()` → `verifyLicense()`.
  - valid → render `children` (the app)
  - missing / invalid / revoked → render lock screen
- **Re-verifies the signature every launch** from the stored string. There is no
  cached "unlocked" boolean anywhere (a boolean is trivially flipped; a signature
  is not).
- **Lock screen:** app name, short explanation, paste-key `TextInput`, "Unlock"
  button, inline error area. Copy notes "keep your key — you'll need it if you
  reinstall." Themed with existing `colors`/`fonts` (matches `ErrorBoundary`).
- On successful verify: `saveLicense(str)`, transition to the app.

### 4. Storage

- Raw license string in `expo-secure-store` (Android Keystore-backed).
- Deliberately **not** in `app_settings` / the SQLite DB, so the license never
  appears in the JSON data export produced by `dataTransfer.ts`.

## Data flow

```
launch
  └─ ErrorBoundary
       └─ DbProvider
            └─ LicenseGate
                 ├─ loadLicense() → verifyLicense()
                 │     ├─ ok    → render app (Stack/tabs)
                 │     └─ !ok   → lock screen
                 │                   └─ user pastes key → verifyLicense()
                 │                         ├─ ok  → saveLicense() → render app
                 │                         └─ !ok → inline error, stay locked
```

## Edge cases

| Case | Behavior |
|------|----------|
| Reinstall / new phone | SecureStore cleared → re-paste key. Same key works forever. Lock screen tells user to keep their key. |
| Typo / bad key | Inline error "That key isn't valid." Stay locked. |
| Revoked buyerId | Invalid; lock screen shows "This license was revoked." |
| Lost key | Author reissues from `licenses.log` record. |
| Clock tampering | Only relevant if `expiresAt` is used (not now). Perpetual keys are clock-independent. |
| Malformed / truncated string | Caught by decode/parse; treated as invalid. |

## Testing

`src/lib/license.test.ts` (node "logic" jest project):

- generates a **test keypair in-test** (real private key never in repo/tests)
- valid key → `ok: true`, correct `buyerId`
- tampered payload (mutate a field after signing) → invalid
- signature from a different key → invalid
- revoked buyerId → invalid
- malformed / non-base64 / wrong `v` → invalid
- `expiresAt` in the past → invalid; in the future → valid (forward-compat check)

The mint scripts are dev tooling; not unit-tested beyond a manual round-trip
(mint → verify) note in the plan.

## Dependencies

- `@noble/ed25519` — pure-JS Ed25519, Expo/RN-safe, no native build step.
- `@noble/hashes` — supplies SHA-512. `@noble/ed25519` v2 does not bundle a hash;
  verification requires wiring it once at module load:
  `ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))`. Without this,
  `verify` throws. Both mint scripts and `license.ts` set this up.
- `expo-secure-store` — Expo-managed; `npx expo install` if not present.

Note: React Native lacks a global `crypto.getRandomValues`. It is **not** needed
for verification (the app only verifies), but the off-device mint/keygen scripts
run under Node where it is available. If any signing ever moves on-device,
`expo-crypto`/`react-native-get-random-values` would be required — out of scope
here.

## Out of scope

- Subscriptions / renewal / expiry enforcement (format supports it; logic not
  built).
- Server verification, account system, cloud sync.
- Device binding / anti-sharing beyond blocklist revocation.
- Play Store billing (the eventual real paywall).

## Affected existing code

- `src/app/_layout.tsx` — insert `LicenseGate` in the provider stack.
- `package.json` — add `@noble/ed25519` (+ `expo-secure-store` if missing).
- New: `src/lib/license.ts`, `src/components/LicenseGate.tsx`,
  `scripts/mint-license.mjs`, `scripts/gen-keypair.mjs`, `.gitignore` entries for
  the private key and `licenses.log`.
- The existing AI-parsing gate (`llmEnabled`) is unaffected — it already sits
  behind the whole-app gate, so AI parsing needs no separate license check.
