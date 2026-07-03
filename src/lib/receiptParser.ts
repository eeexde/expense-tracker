export interface ParsedReceipt {
  amountCentavos: number | null;
  merchant: string | null;
}

const MONEY = /\d{1,3}(?:,\d{3})*\.\d{2}/g;
// \bTOTAL\b will not match SUBTOTAL (no word boundary inside a word)
const TOTAL_LINE = /\bTOTAL\b|AMOUNT\s+DUE|CASH\s+DUE/i;
const EXCLUDED_LINE = /SUBTOTAL|TENDERED|CHANGE|VAT|CASH(?!\s+DUE)/i;
const NON_MERCHANT = /TIN|VAT|STORE\s*#|BRANCH|\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|^\d+$/i;

function centavosFrom(token: string): number {
  const [pesos, cents] = token.replace(/,/g, '').split('.');
  return parseInt(pesos, 10) * 100 + parseInt(cents, 10);
}

/**
 * Best-effort extraction from OCR'd receipt text.
 * Amount: prefer a TOTAL/AMOUNT DUE line; fall back to the largest money
 * token on a non-excluded line. Merchant: first plausible top line.
 * Never throws — nulls mean "couldn't tell", the form stays manual.
 */
export function parseReceipt(text: string): ParsedReceipt {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let amountCentavos: number | null = null;
  for (const line of lines) {
    if (TOTAL_LINE.test(line) && !EXCLUDED_LINE.test(line)) {
      const tokens = line.match(MONEY);
      if (tokens) {
        amountCentavos = centavosFrom(tokens[tokens.length - 1]);
        break;
      }
    }
  }
  if (amountCentavos === null) {
    let largest = -1;
    for (const line of lines) {
      if (EXCLUDED_LINE.test(line)) continue;
      for (const token of line.match(MONEY) ?? []) {
        largest = Math.max(largest, centavosFrom(token));
      }
    }
    amountCentavos = largest > 0 ? largest : null;
  }

  let merchant: string | null = null;
  for (const line of lines.slice(0, 3)) {
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters >= 2 && !NON_MERCHANT.test(line) && !MONEY.test(line)) {
      merchant = line;
      break;
    }
    MONEY.lastIndex = 0; // global regex: reset between .test calls
  }
  MONEY.lastIndex = 0;

  return { amountCentavos, merchant };
}
