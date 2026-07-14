import { formatPeso } from './money';

export interface LlmClassification {
  direction: 'expense' | 'income';
  merchant: string | null;
}

/** Inference runner injected by the controller; resolves to raw model text. */
export type RunInference = (prompt: string) => Promise<string>;

const TIMEOUT_MS = 5000;
const MERCHANT_MAX = 60;

/**
 * Single-turn prompt. The amount is regex-extracted and included only as
 * context — the model is never asked for numbers (hallucinated money is worse
 * than a missed log).
 */
export function buildPrompt(notificationText: string, amountCentavos: number): string {
  return [
    'You classify bank/e-wallet transaction notifications.',
    `The transaction amount is ${formatPeso(amountCentavos)}.`,
    'Decide if the account owner SPENT money (expense) or RECEIVED money (income),',
    'and extract the merchant or counterparty name if present.',
    'Reply with ONLY this JSON, nothing else:',
    '{"direction":"expense"|"income"|"unknown","merchant":string|null}',
    '',
    'Notification:',
    notificationText,
  ].join('\n');
}

/** Strict validation — anything off-contract returns null (item stays in inbox). */
export function parseLlmReply(raw: string): LlmClassification | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const direction = (parsed as Record<string, unknown>).direction;
  if (direction !== 'expense' && direction !== 'income') return null;
  const rawMerchant = (parsed as Record<string, unknown>).merchant;
  const merchant =
    typeof rawMerchant === 'string' && rawMerchant.trim()
      ? rawMerchant.trim().slice(0, MERCHANT_MAX)
      : null;
  return { direction, merchant };
}

/** Never throws; null means "LLM couldn't help" and the caller falls back. */
export async function classifyWithLlm(
  run: RunInference,
  notificationText: string,
  amountCentavos: number,
): Promise<LlmClassification | null> {
  try {
    const reply = await Promise.race([
      run(buildPrompt(notificationText, amountCentavos)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('llm timeout')), TIMEOUT_MS),
      ),
    ]);
    return parseLlmReply(reply);
  } catch {
    return null;
  }
}
