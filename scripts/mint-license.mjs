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
