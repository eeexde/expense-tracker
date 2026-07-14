import { buildPrompt, classifyWithLlm, parseLlmReply } from './llmParser';

describe('buildPrompt', () => {
  it('includes the notification text and formatted amount', () => {
    const p = buildPrompt('You have an incoming transfer of PHP 15,337.00', 1533700);
    expect(p).toContain('You have an incoming transfer');
    expect(p).toContain('15,337.00');
    expect(p).toMatch(/JSON/);
  });
});

describe('parseLlmReply', () => {
  it('accepts a clean JSON reply', () => {
    expect(parseLlmReply('{"direction":"income","merchant":"METROBANK"}')).toEqual({
      direction: 'income',
      merchant: 'METROBANK',
    });
  });

  it('accepts JSON wrapped in prose or code fences', () => {
    expect(
      parseLlmReply('Sure! ```json\n{"direction":"expense","merchant":null}\n```'),
    ).toEqual({ direction: 'expense', merchant: null });
  });

  it('rejects unknown direction, malformed JSON, and missing fields', () => {
    expect(parseLlmReply('{"direction":"transfer","merchant":"X"}')).toBeNull();
    expect(parseLlmReply('not json at all')).toBeNull();
    expect(parseLlmReply('{"merchant":"X"}')).toBeNull();
  });

  it('treats direction "unknown" as null result', () => {
    expect(parseLlmReply('{"direction":"unknown","merchant":null}')).toBeNull();
  });

  it('coerces non-string merchant to null and trims overlong merchants', () => {
    expect(parseLlmReply('{"direction":"income","merchant":42}')).toEqual({
      direction: 'income',
      merchant: null,
    });
    const long = 'X'.repeat(80);
    expect(parseLlmReply(`{"direction":"income","merchant":"${long}"}`)!.merchant).toHaveLength(60);
  });
});

describe('classifyWithLlm', () => {
  it('returns parsed result from the injected runner', async () => {
    const run = jest.fn().mockResolvedValue('{"direction":"income","merchant":"MB"}');
    await expect(classifyWithLlm(run, 'text', 100)).resolves.toEqual({
      direction: 'income',
      merchant: 'MB',
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining('text'));
  });

  it('returns null on runner rejection', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(classifyWithLlm(run, 'text', 100)).resolves.toBeNull();
  });

  it('returns null when the runner exceeds the timeout', async () => {
    jest.useFakeTimers();
    const run = jest.fn(() => new Promise<string>(() => {}));
    const promise = classifyWithLlm(run, 'text', 100);
    jest.advanceTimersByTime(6000);
    await expect(promise).resolves.toBeNull();
    jest.useRealTimers();
  });
});
