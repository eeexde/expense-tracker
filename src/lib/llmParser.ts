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

/**
 * Yield each balanced `{...}` substring in source order. Brace depth is tracked
 * outside of JSON strings so nested/adjacent objects split cleanly; a small
 * model that echoes the schema template before its real answer produces two
 * candidates rather than one over-greedy blob.
 */
function* candidateObjects(raw: string): Generator<string> {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < raw.length; j++) {
      const ch = raw[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          yield raw.slice(i, j + 1);
          break;
        }
      }
    }
  }
}

/**
 * Strict validation — anything off-contract returns null (item stays in inbox).
 * Scans candidate objects in order and returns the first that both parses as
 * JSON and validates; the schema template a model may echo is not valid JSON,
 * so it is skipped in favour of the real answer.
 */
export function parseLlmReply(raw: string): LlmClassification | null {
  for (const candidate of candidateObjects(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const direction = (parsed as Record<string, unknown>).direction;
    if (direction !== 'expense' && direction !== 'income') continue;
    const rawMerchant = (parsed as Record<string, unknown>).merchant;
    const merchant =
      typeof rawMerchant === 'string' && rawMerchant.trim()
        ? rawMerchant.trim().slice(0, MERCHANT_MAX)
        : null;
    return { direction, merchant };
  }
  return null;
}

/** Never throws; null means "LLM couldn't help" and the caller falls back. */
export async function classifyWithLlm(
  run: RunInference,
  notificationText: string,
  amountCentavos: number,
): Promise<LlmClassification | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      run(buildPrompt(notificationText, amountCentavos)),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('llm timeout')), TIMEOUT_MS);
      }),
    ]);
    return parseLlmReply(reply);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
