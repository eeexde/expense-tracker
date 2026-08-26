import { formatPeso } from './money';

export interface LlmClassification {
  /**
   * The model's verdict on whether this notification describes money actually
   * moving. False for marketing blasts ("Get up to ₱500 cashback!"), which the
   * amount regex cannot tell from a receipt — the caller DISCARDS those. When
   * false, every field below is meaningless filler; only read `isTransaction`.
   */
  isTransaction: boolean;
  direction: 'expense' | 'income';
  merchant: string | null;
  /** Resolved from the model's `amountIndex` into the caller's candidate list. */
  amountCentavos: number;
}

/** Inference runner injected by the controller; resolves to raw model text. */
export type RunInference = (prompt: string) => Promise<string>;

/**
 * Hard ceiling on one inference. Governs alone until the first token arrives,
 * so a runtime that never reports tokens degrades to exactly this and nothing
 * else — the stall clock below can only ever cut things SHORTER, never end an
 * inference the old flat timeout would have allowed.
 */
const HARD_TIMEOUT_MS = 12_000;
/**
 * Once tokens are flowing, how long a gap between them means wedged rather than
 * slow. The distinction is the point: a budget phone decoding Qwen3-1.7B is
 * healthy at a token every few hundred ms and should be allowed to finish, while
 * a runtime that has stopped producing anything is never going to recover and
 * every second spent waiting is a second of the pass budget the remaining
 * notifications do not get.
 */
const STALL_MS = 2_000;
const MERCHANT_MAX = 60;

/**
 * Single-turn prompt. The candidate amounts are regex-extracted from the text
 * and presented as a numbered list; the model replies with an INDEX, never a
 * number of its own. A hallucinated peso value is money in the user's ledger
 * that never left their account, so the model is given no way to invent one —
 * the worst it can do is point at the wrong line of the notification.
 *
 * It also decides `isTransaction`: that judgement is the whole reason the model
 * is here, since the rules parser reads "Spend ₱1,000 and get ₱100 back" as a
 * ₱1,000 expense.
 */
export function buildPrompt(notificationText: string, candidates: number[]): string {
  const list = candidates.map((c, i) => `${i}. ${formatPeso(c)}`).join('\n');
  return [
    'You classify bank/e-wallet transaction notifications.',
    'First decide if this notification reports money that actually moved in or',
    'out of the account owner\'s account. Advertisements, promos, vouchers,',
    'rewards offers and reminders are NOT transactions.',
    'If it IS a transaction, pick which of these amounts is the transaction',
    'amount by its index, decide whether the owner SPENT money (expense) or',
    'RECEIVED money (income), and extract the merchant or counterparty name.',
    '',
    'Amounts found in the notification:',
    list,
    '',
    'Reply with ONLY this JSON, nothing else:',
    '{"isTransaction":true|false,"amountIndex":<int>|null,"direction":"expense"|"income","merchant":string|null}',
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
 * Strict validation — anything off-contract returns null (item falls back to
 * the rules path). Scans candidate objects in order looking for one that both
 * parses as JSON and carries a boolean `isTransaction`; the schema template a
 * model may echo is neither, so it is skipped in favour of the real answer.
 *
 * Once such an answer IS found it is the model's word, so a malformed rest —
 * an out-of-range index, a float, a stringified number, a missing index, an
 * unknown direction — rejects the whole reply rather than being patched up.
 * Guessing at a half-valid answer is how a wrong amount reaches a row.
 */
export function parseLlmReply(raw: string, candidates: number[]): LlmClassification | null {
  for (const candidate of candidateObjects(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const fields = parsed as Record<string, unknown>;
    const isTransaction = fields.isTransaction;
    if (typeof isTransaction !== 'boolean') continue;
    // "Not a transaction" is a complete answer on its own: the caller discards
    // the notification, so nothing else in the reply is ever read.
    if (!isTransaction) {
      return { isTransaction: false, direction: 'expense', merchant: null, amountCentavos: 0 };
    }
    const direction = fields.direction;
    if (direction !== 'expense' && direction !== 'income') return null;
    // The index is the ONLY channel through which an amount can arrive. Anything
    // that is not an in-range integer — including a plausible-looking number the
    // model supplied directly — is rejected outright.
    const amountIndex = fields.amountIndex;
    if (
      typeof amountIndex !== 'number' ||
      !Number.isInteger(amountIndex) ||
      amountIndex < 0 ||
      amountIndex >= candidates.length
    ) {
      return null;
    }
    const rawMerchant = fields.merchant;
    const merchant =
      typeof rawMerchant === 'string' && rawMerchant.trim()
        ? rawMerchant.trim().slice(0, MERCHANT_MAX)
        : null;
    return { isTransaction: true, direction, merchant, amountCentavos: candidates[amountIndex] };
  }
  return null;
}

/** Hooks onto the running inference. Both optional; parsing tests pass neither. */
export interface InferenceHooks {
  /** Cancels the native inference. Called once, before we stop waiting on it. */
  onCancel?: () => void;
  /**
   * Subscribes to generated tokens; returns an unsubscribe. Each token proves
   * the runtime is alive and resets the stall clock.
   */
  onTokens?: (onToken: () => void) => () => void;
}

/** Never throws; null means "LLM couldn't help" and the caller falls back. */
export async function classifyWithLlm(
  run: RunInference,
  notificationText: string,
  candidates: number[],
  hooks?: InferenceHooks,
): Promise<LlmClassification | null> {
  let hardId: ReturnType<typeof setTimeout> | undefined;
  let stallId: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let done = false;
  try {
    const reply = await Promise.race([
      run(buildPrompt(notificationText, candidates)).then((r) => {
        done = true;
        return r;
      }),
      new Promise<never>((_, reject) => {
        const giveUp = (why: string) => {
          // The inference won the race in the meantime. Cancelling now would
          // stop whatever the handle is doing NEXT — the following item in the
          // drain — rather than this one.
          if (done) return;
          done = true;
          // Cancel BEFORE rejecting: the rejection resumes the caller, which
          // may free the handle out from under a still-running generate.
          hooks?.onCancel?.();
          reject(new Error(why));
        };
        hardId = setTimeout(() => giveUp('llm timeout'), HARD_TIMEOUT_MS);
        unsubscribe = hooks?.onTokens?.(() => {
          if (done) return;
          // First token switches this inference from "prove you started" to
          // "prove you are still going", and the hard cap stops applying.
          clearTimeout(hardId);
          clearTimeout(stallId);
          stallId = setTimeout(() => giveUp('llm stalled'), STALL_MS);
        });
      }),
    ]);
    return parseLlmReply(reply, candidates);
  } catch {
    return null;
  } finally {
    clearTimeout(hardId);
    clearTimeout(stallId);
    unsubscribe?.();
  }
}
