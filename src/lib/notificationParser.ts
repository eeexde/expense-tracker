export interface ParsedNotification {
  amountCentavos: number | null;
  /**
   * EVERY currency-marked amount in the text, in source order. The LLM is the
   * authority on which one (if any) is the transaction, and it may only PICK
   * from this list — see llmParser.buildPrompt. `amountCentavos` stays the
   * first one so the rules-only fallback behaves exactly as it always did.
   */
  amountCandidates: number[];
  merchant: string | null;
  direction: 'expense' | 'income' | null;
  /** Text reads like a marketing blast rather than a transaction receipt. */
  promotional: boolean;
  /** high = auto-commit, medium = inbox, none = discard. See confidenceOf. */
  confidence: 'high' | 'medium' | 'none';
}

// PHP 1,234.56 | ₱1,234.56 | Php 1500 — currency marker required to avoid
// matching reference numbers or dates. The lookbehind keeps the bare-P marker
// from matching inside words like "OTP 123456". Global because promos routinely
// carry several amounts ("Spend ₱1,000, get ₱100 back") and the LLM needs all of
// them to pick from; `lastIndex` never carries between calls, since every use
// below runs its own matchAll walk.
const AMOUNT = /(?<![A-Za-z0-9])(?:PHP|Php|php|₱|P)\s*([\d,]+(?:\.\d{1,2})?)\b/g;
// GCash "send money" logs as expense per spec. "payment" covers email alerts
// phrased as "your payment of ₱X" (e.g. Atome); bare "pay" covers "Pay via
// QR"/"Pay To" (e.g. BPI) — it appears early, so earliest-verb-wins beats a
// stray "credited" in rewards footers.
const EXPENSE_VERB = /\b(spent|pay|paid|payments?|purchased?|charged|debited|sent)\b/i;
// "incoming" leads BPI's Instapay-receive emails, whose body also says
// "transfer *sent* via Instapay" — earliest-verb-wins needs the early signal.
const INCOME_VERB = /\b(incoming|received|refund(?:ed)?|cashback|credited)\b/i;
/**
 * Marketing vocabulary. GCash blasts ("Get up to PHP 500 cashback!") carry
 * currency-marked amounts, so the amount regex alone cannot tell them from a
 * receipt — without this the rules-only path books the promo as a real expense.
 *
 * Word-boundary matched so the legitimate half of each near-miss survives:
 * \bget\b misses "budget"/"target"/"getting", \bspend\b misses "spent" (the
 * actual expense verb), \bwin\b misses "winning". Deliberately NOT included:
 * "cashback", "credited", "rewards", "points" — every one of those also appears
 * in the footer of a genuine BPI/GCash transaction receipt.
 *
 * A heuristic, not a verdict: when the LLM is available it overrules this (the
 * amounts are still offered to it as candidates). This is the rules-only safety
 * net for iOS, un-downloaded models, and inference timeouts.
 */
const PROMOTIONAL =
  /\b(?:get|spend|win|enjoy|vouchers?|promos?|expires?|claims?|discounts?)\b|\bup to\b|\bas low as\b|%\s*off\b/i;

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
 * Every currency-marked amount in the text, in source order, as centavos.
 * Exported for the LLM path: the model is handed this list and may only reply
 * with an INDEX into it, so a hallucinated number can never reach a row.
 */
export function findAmountCandidates(rawText: string): number[] {
  return amountsIn(sanitize(rawText));
}

/** Candidate scan over already-sanitized text. */
function amountsIn(text: string): number[] {
  return [...text.matchAll(AMOUNT)].map((m) => centavosFrom(m[1]));
}

/**
 * Promo wording never auto-commits. How far it demotes turns on WHERE it sits
 * relative to the direction verb — the same earliest-wins tie-break this file
 * already uses to settle expense-vs-income:
 *
 * - No verb at all: nothing but marketing ("Enjoy 20% off, vouchers worth
 *   ₱150"). Discarded. These arrive in bulk and an inbox full of them is the
 *   exact noise this feature exists to avoid; the audit row still records it.
 * - Promo wording FIRST: a blast that happens to contain a verb ("GCash: GET up
 *   to ₱500 cashback when you PAY bills!"). Also discarded — the sentence is
 *   selling something, and the verb is part of the pitch.
 * - Verb FIRST: a receipt carrying a marketing footer ("You PAID ₱286.50. GET
 *   your e-receipt here.", "...CHARGED ₱1,234.56. Card EXPIRES 09/26."). Real
 *   money moved, so it is kept — but at 'medium', never 'high'. It goes to the
 *   inbox for one confirming tap instead of auto-committing, because the
 *   ordering cue is weak enough to be inverted by a blast that leads with its
 *   verb ("PAY your bills with GCash and GET ₱500 back!").
 *
 * The asymmetry is deliberate: a wrong discard silently loses a real expense
 * with nothing left to recover it, while a wrong queue costs one dismissing tap.
 *
 * All of this is the rules-only path (iOS, no model downloaded, inference timed
 * out or out of budget). With the model available its isTransaction verdict
 * overrules every branch here.
 */
function confidenceOf(
  amountCentavos: number | null,
  direction: 'expense' | 'income' | null,
  promoIndex: number | null,
  verbIndex: number | null,
): 'high' | 'medium' | 'none' {
  if (amountCentavos === null) return 'none';
  if (promoIndex === null) return direction === null ? 'medium' : 'high';
  if (verbIndex === null || promoIndex < verbIndex) return 'none';
  return 'medium';
}

/**
 * Best-effort extraction from a bank/e-wallet notification. Never throws;
 * nulls mean "couldn't tell". Mirrors receiptParser.ts philosophy.
 */
export function parseNotification(rawText: string): ParsedNotification {
  const text = sanitize(rawText);
  const amountCandidates = amountsIn(text);
  // First candidate wins, exactly as when this was a single non-global match —
  // banks lead with the transaction amount and trail with balances/footers.
  const amountCentavos = amountCandidates.length > 0 ? amountCandidates[0] : null;

  const expense = text.match(EXPENSE_VERB);
  const income = text.match(INCOME_VERB);
  let direction: 'expense' | 'income' | null = null;
  // Where the winning verb sits, for the promo tie-break in confidenceOf.
  let verbIndex: number | null = null;
  if (expense && income) {
    const incomeAt = income.index ?? 0;
    const expenseAt = expense.index ?? 0;
    direction = incomeAt < expenseAt ? 'income' : 'expense';
    verbIndex = Math.min(incomeAt, expenseAt);
  } else if (expense) {
    direction = 'expense';
    verbIndex = expense.index ?? 0;
  } else if (income) {
    direction = 'income';
    verbIndex = income.index ?? 0;
  }

  const merchantMatch = text.match(MERCHANT);
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  const promoMatch = text.match(PROMOTIONAL);
  const promotional = promoMatch !== null;
  const confidence = confidenceOf(amountCentavos, direction, promoMatch?.index ?? null, verbIndex);

  return { amountCentavos, amountCandidates, merchant, direction, promotional, confidence };
}
