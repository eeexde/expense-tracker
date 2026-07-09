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
// GCash "send money" logs as expense per spec.
const EXPENSE_VERB = /\b(spent|paid|purchased?|charged|debited|sent)\b/i;
const INCOME_VERB = /\b(received|refund(?:ed)?|cashback|credited)\b/i;
// "to JOLLIBEE MAKATI via ..." / "at SM SUPERMALLS on 07/10" / "from JUAN."
// {1,40} caps the capture at a plausible merchant-name length.
const MERCHANT =
  /\b(?:at|to|from)\s+([A-Z0-9][A-Za-z0-9 .&'\-]{1,40}?)(?=\s+(?:on|via|last|with|using)\b|[.,!]|$)/i;

function centavosFrom(token: string): number {
  const clean = token.replace(/,/g, '');
  const [pesos, cents = ''] = clean.split('.');
  return parseInt(pesos, 10) * 100 + parseInt(cents.padEnd(2, '0'), 10);
}

/**
 * Best-effort extraction from a bank/e-wallet notification. Never throws;
 * nulls mean "couldn't tell". Mirrors receiptParser.ts philosophy.
 */
export function parseNotification(text: string): ParsedNotification {
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
