import { buildPrompt, classifyWithLlm, parseLlmReply } from './llmParser';

// Real GCash strings — a promo blast that the regex parser used to book as a
// transaction, and the genuine receipt it has to stay distinguishable from.
const PROMO = 'GCash: Get up to PHP 500 cashback when you pay your bills this weekend!';
const REAL = 'You have sent PHP 150.00 to JOLLIBEE MAKATI via GCash. Ref. No. 1234567890';

describe('buildPrompt', () => {
  it('lists the candidate amounts by index and asks for an index back', () => {
    const p = buildPrompt('You have an incoming transfer of PHP 15,337.00', [1533700]);
    expect(p).toContain('You have an incoming transfer');
    expect(p).toContain('0.');
    expect(p).toContain('15,337.00');
    expect(p).toMatch(/JSON/);
    expect(p).toContain('isTransaction');
    expect(p).toContain('amountIndex');
  });

  it('numbers every candidate of a multi-amount promo', () => {
    const p = buildPrompt(PROMO, [50000, 100000]);
    expect(p).toContain('0.');
    expect(p).toContain('1.');
    expect(p).toContain('500.00');
    expect(p).toContain('1,000.00');
  });
});

describe('parseLlmReply', () => {
  it('resolves amountIndex against the candidate list', () => {
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":1,"direction":"income","merchant":"METROBANK"}',
        [10000, 1533700],
      ),
    ).toEqual({
      isTransaction: true,
      amountCentavos: 1533700,
      direction: 'income',
      merchant: 'METROBANK',
    });
  });

  it('accepts JSON wrapped in prose or code fences', () => {
    expect(
      parseLlmReply(
        'Sure! ```json\n{"isTransaction":true,"amountIndex":0,"direction":"expense","merchant":null}\n```',
        [15000],
      ),
    ).toEqual({
      isTransaction: true,
      amountCentavos: 15000,
      direction: 'expense',
      merchant: null,
    });
  });

  it('returns isTransaction:false for a promo verdict, whatever else it says', () => {
    const r = parseLlmReply(
      '{"isTransaction":false,"amountIndex":null,"direction":"expense","merchant":null}',
      [50000, 100000],
    );
    expect(r).not.toBeNull();
    expect(r!.isTransaction).toBe(false);
  });

  it('rejects an out-of-range amountIndex — the whole reply, not just the index', () => {
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":5,"direction":"expense","merchant":"X"}',
        [15000],
      ),
    ).toBeNull();
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":-1,"direction":"expense","merchant":"X"}',
        [15000],
      ),
    ).toBeNull();
  });

  it('rejects a hallucinated amount supplied instead of an index', () => {
    // The model may only PICK. A bare number is off-contract even when it looks
    // plausible, because nothing in the text has to back it up.
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amount":499.99,"direction":"expense","merchant":"X"}',
        [15000],
      ),
    ).toBeNull();
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":"0","direction":"expense","merchant":"X"}',
        [15000],
      ),
    ).toBeNull();
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":1.5,"direction":"expense","merchant":"X"}',
        [15000, 20000],
      ),
    ).toBeNull();
  });

  it('rejects a transaction verdict with no candidates to pick from', () => {
    expect(
      parseLlmReply('{"isTransaction":true,"amountIndex":0,"direction":"expense"}', []),
    ).toBeNull();
  });

  it('rejects unknown direction, malformed JSON, and missing fields', () => {
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":0,"direction":"transfer","merchant":"X"}',
        [15000],
      ),
    ).toBeNull();
    expect(parseLlmReply('not json at all', [15000])).toBeNull();
    expect(parseLlmReply('{"merchant":"X"}', [15000])).toBeNull();
    expect(
      parseLlmReply('{"isTransaction":"yes","amountIndex":0,"direction":"expense"}', [15000]),
    ).toBeNull();
  });

  it('picks the real object when the model also echoes the schema', () => {
    const reply =
      'Format: {"isTransaction":true|false,"amountIndex":<int>|null,"direction":"expense"|"income","merchant":string|null}\n' +
      '{"isTransaction":true,"amountIndex":0,"direction":"income","merchant":"BPI"}';
    expect(parseLlmReply(reply, [1533700])).toEqual({
      isTransaction: true,
      amountCentavos: 1533700,
      direction: 'income',
      merchant: 'BPI',
    });
  });

  it('coerces non-string merchant to null and trims overlong merchants', () => {
    expect(
      parseLlmReply(
        '{"isTransaction":true,"amountIndex":0,"direction":"income","merchant":42}',
        [100],
      ),
    ).toEqual({ isTransaction: true, amountCentavos: 100, direction: 'income', merchant: null });
    const long = 'X'.repeat(80);
    expect(
      parseLlmReply(
        `{"isTransaction":true,"amountIndex":0,"direction":"income","merchant":"${long}"}`,
        [100],
      )!.merchant,
    ).toHaveLength(60);
  });
});

describe('classifyWithLlm', () => {
  const REPLY = '{"isTransaction":true,"amountIndex":0,"direction":"income","merchant":"MB"}';
  /** Runner that answers immediately with `reply`. */
  const run = (reply: string) => jest.fn().mockResolvedValue(reply);

  it('returns parsed result from the injected runner', async () => {
    const run = jest
      .fn()
      .mockResolvedValue('{"isTransaction":true,"amountIndex":0,"direction":"income","merchant":"MB"}');
    await expect(classifyWithLlm(run, REAL, [15000])).resolves.toEqual({
      isTransaction: true,
      amountCentavos: 15000,
      direction: 'income',
      merchant: 'MB',
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining('JOLLIBEE'));
  });

  it('carries a promo verdict back to the caller', async () => {
    const run = jest.fn().mockResolvedValue('{"isTransaction":false,"amountIndex":null}');
    const result = await classifyWithLlm(run, PROMO, [50000]);
    expect(result!.isTransaction).toBe(false);
  });

  it('returns null on runner rejection', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(classifyWithLlm(run, REAL, [15000])).resolves.toBeNull();
  });

  it('cancels the inference on the way out instead of just walking away', async () => {
    jest.useFakeTimers();
    const onCancel = jest.fn();
    const run = jest.fn(() => new Promise<string>(() => {}));
    const promise = classifyWithLlm(run, REAL, [15000], { onCancel });
    jest.advanceTimersByTime(13_000);
    await expect(promise).resolves.toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('never cancels an inference that already answered', async () => {
    // The hard-cap timer outliving a successful call would interrupt whatever
    // the handle does NEXT — the following notification in the drain.
    jest.useFakeTimers();
    const onCancel = jest.fn();
    await expect(classifyWithLlm(run(REPLY), REAL, [15000], { onCancel })).resolves.not.toBeNull();
    jest.advanceTimersByTime(60_000);
    expect(onCancel).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  /**
   * A budget phone decoding Qwen3-1.7B is healthy at a token every few hundred
   * ms. The old flat 5s cap cut those off mid-answer and pushed the item onto
   * the rules path; token liveness lets them finish.
   */
  it('lets a slow but live inference run past the hard cap while tokens flow', async () => {
    jest.useFakeTimers();
    let emit: () => void = () => {};
    let finish: (reply: string) => void = () => {};
    const promise = classifyWithLlm(
      () => new Promise<string>((resolve) => { finish = resolve; }),
      REAL,
      [15000],
      { onTokens: (onToken) => { emit = onToken; return () => {}; } },
    );
    // 20s of steady decoding — well past HARD_TIMEOUT_MS.
    for (let i = 0; i < 20; i += 1) {
      emit();
      jest.advanceTimersByTime(1_000);
    }
    finish(REPLY);
    await expect(promise).resolves.not.toBeNull();
    jest.useRealTimers();
  });

  it('gives up once the tokens stop, without waiting out the hard cap', async () => {
    jest.useFakeTimers();
    const onCancel = jest.fn();
    let emit: () => void = () => {};
    const promise = classifyWithLlm(() => new Promise<string>(() => {}), REAL, [15000], {
      onCancel,
      onTokens: (onToken) => { emit = onToken; return () => {}; },
    });
    emit();
    // Stall clock only, and it is much shorter than the 12s hard cap.
    jest.advanceTimersByTime(2_000);
    await expect(promise).resolves.toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('unsubscribes the token feed so it cannot outlive the inference', async () => {
    const unsubscribe = jest.fn();
    await classifyWithLlm(run(REPLY), REAL, [15000], { onTokens: () => unsubscribe });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('returns null when the runner never produces a first token', async () => {
    jest.useFakeTimers();
    const run = jest.fn(() => new Promise<string>(() => {}));
    const promise = classifyWithLlm(run, REAL, [15000]);
    jest.advanceTimersByTime(13_000);
    await expect(promise).resolves.toBeNull();
    jest.useRealTimers();
  });
});
