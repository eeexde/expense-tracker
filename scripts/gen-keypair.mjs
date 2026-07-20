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
