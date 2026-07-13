export interface ParsedNotification {
  amountCentavos: number | null;
  merchant: string | null;
  direction: 'expense' | 'income' | null;
  /** high = auto-commit, medium = inbox, none = discard (no amount). */
  confidence: 'high' | 'medium' | 'none';
}

// PHP 1,234.56 | ₱1,234.56 | Php 1500 — currency marker required to avoid
// matching reference numbers or dates. The lookbehind keeps the bare-P marker
// from matching inside words like "OTP 123456".
const AMOUNT = /(?<![A-Za-z0-9])(?:PHP|Php|php|₱|P)\s*([\d,]+(?:\.\d{1,2})?)\b/;
// GCash "send money" logs as expense per spec. "payment" covers email alerts
// phrased as "your payment of ₱X" (e.g. Atome); bare "pay" covers "Pay via
// QR"/"Pay To" (e.g. BPI) — it appears early, so earliest-verb-wins beats a
// stray "credited" in rewards footers.
const EXPENSE_VERB = /\b(spent|pay|paid|payments?|purchased?|charged|debited|sent)\b/i;
// "incoming" leads BPI's Instapay-receive emails, whose body also says
// "transfer *sent* via Instapay" — earliest-verb-wins needs the early signal.
const INCOME_VERB = /\b(incoming|received|refund(?:ed)?|cashback|credited)\b/i;
// "to JOLLIBEE MAKATI via ..." / "at SM SUPERMALLS on 07/10" / "from JUAN." /
// "payment of ₱286.50 for OSAVE ... using your Atome Card".
// {1,40} caps the capture at a plausible merchant-name length.
const MERCHANT =
  /\b(?:at|to|from|for)\s+([A-Z0-9][A-Za-z0-9 .&'\-]{1,40}?)(?=\s+(?:on|via|last|with|using)\b|[.,!]|$)/i;

function centavosFrom(token: string): number {
  const clean = token.replace(/,/g, '');
  const [pesos, cents = ''] = clean.split('.');
  return parseInt(pesos, 10) * 100 + parseInt(cents.padEnd(2, '0'), 10);
}

function decodeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' '; // out-of-range entity — drop it, keep parsing
  }
}

/**
 * Email-sourced notifications (e.g. Gmail snippets of bank alerts) carry HTML
 * tags and entities that break the field regexes. Strip tags first, then
 * decode entities, then collapse whitespace — plain-text input passes through
 * unchanged.
 */
function sanitize(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => decodeCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeCodePoint(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort extraction from a bank/e-wallet notification. Never throws;
 * nulls mean "couldn't tell". Mirrors receiptParser.ts philosophy.
 */
export function parseNotification(rawText: string): ParsedNotification {
  const text = sanitize(rawText);
  const amountMatch = text.match(AMOUNT);
  const amountCentavos = amountMatch ? centavosFrom(amountMatch[1]) : null;

  const expense = text.match(EXPENSE_VERB);
  const income = text.match(INCOME_VERB);
  let direction: 'expense' | 'income' | null = null;
  if (expense && income) {
    direction = (income.index ?? 0) < (expense.index ?? 0) ? 'income' : 'expense';
  } else if (expense) {
    direction = 'expense';
  } else if (income) {
    direction = 'income';
  }

  const merchantMatch = text.match(MERCHANT);
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  const confidence =
    amountCentavos === null ? 'none' : direction === null ? 'medium' : 'high';

  return { amountCentavos, merchant, direction, confidence };
}
