import {
  centavosToInput,
  formatPeso,
  parsePesoBalanceInput,
  parsePesoInput,
  sum,
} from './money';

describe('formatPeso', () => {
  it('formats zero', () => {
    expect(formatPeso(0)).toBe('₱0.00');
  });

  it('formats thousands with separators', () => {
    expect(formatPeso(123450)).toBe('₱1,234.50');
  });

  it('formats millions', () => {
    expect(formatPeso(123456789)).toBe('₱1,234,567.89');
  });

  it('formats sub-peso centavos', () => {
    expect(formatPeso(5)).toBe('₱0.05');
  });

  it('formats negatives with leading minus', () => {
    expect(formatPeso(-50000)).toBe('-₱500.00');
  });
});

describe('parsePesoInput', () => {
  it('parses plain integers as pesos', () => {
    expect(parsePesoInput('250')).toBe(25000);
  });

  it('parses decimals and comma separators', () => {
    expect(parsePesoInput('1,234.50')).toBe(123450);
  });

  it('parses single decimal digit', () => {
    expect(parsePesoInput('10.5')).toBe(1050);
  });

  it('trims whitespace and peso sign', () => {
    expect(parsePesoInput(' ₱99.99 ')).toBe(9999);
  });

  it('rejects empty, junk, zero, negative, >2 decimals', () => {
    expect(parsePesoInput('')).toBeNull();
    expect(parsePesoInput('abc')).toBeNull();
    expect(parsePesoInput('0')).toBeNull();
    expect(parsePesoInput('-5')).toBeNull();
    expect(parsePesoInput('1.234')).toBeNull();
  });
});

describe('parsePesoBalanceInput', () => {
  // A bucket holding ₱0 is ordinary — and 0 is the schema default — so the
  // balance parser has to accept what the amount parser deliberately rejects.
  // Rejecting it here left every default-balance bucket permanently unsavable.
  it('accepts exactly zero, which parsePesoInput rejects', () => {
    expect(parsePesoBalanceInput('0')).toBe(0);
    expect(parsePesoBalanceInput('0.00')).toBe(0);
    expect(parsePesoInput('0.00')).toBeNull();
  });

  it('shares the rest of parsePesoInput\'s grammar', () => {
    expect(parsePesoBalanceInput('1,234.50')).toBe(123450);
    expect(parsePesoBalanceInput(' ₱99.99 ')).toBe(9999);
    expect(parsePesoBalanceInput('')).toBeNull();
    expect(parsePesoBalanceInput('abc')).toBeNull();
    expect(parsePesoBalanceInput('1.234')).toBeNull();
    // The leading minus is peeled off by the caller, not here.
    expect(parsePesoBalanceInput('-5')).toBeNull();
  });
});

describe('centavosToInput', () => {
  it('drops the decimals for whole pesos', () => {
    expect(centavosToInput(25000)).toBe('250');
  });

  it('keeps two decimals when there are centavos', () => {
    expect(centavosToInput(123450)).toBe('1234.50');
    expect(centavosToInput(5)).toBe('0.05');
  });

  // Math.floor rounds away from zero on negatives while % keeps the sign, so
  // the two used to disagree and render -150 as "-2.-50" — text no parser can
  // read back, which disabled Save with no way to correct it.
  it('formats negative centavos without mangling the split', () => {
    expect(centavosToInput(-150)).toBe('-1.50');
    expect(centavosToInput(-5)).toBe('-0.05');
    expect(centavosToInput(-123450)).toBe('-1234.50');
  });

  it('drops the decimals for whole negative pesos', () => {
    expect(centavosToInput(-100)).toBe('-1');
    expect(centavosToInput(-25000)).toBe('-250');
  });

  it('round-trips through parsePesoInput', () => {
    for (const c of [1, 5, 99, 100, 1050, 123450, 9999]) {
      expect(parsePesoInput(centavosToInput(c))).toBe(c);
    }
  });

  it('round-trips negatives the way the signed balance field reads them', () => {
    for (const c of [-1, -5, -150, -100, -123450]) {
      const text = centavosToInput(c);
      expect(text.startsWith('-')).toBe(true);
      expect(-(parsePesoBalanceInput(text.slice(1)) as number)).toBe(c);
    }
  });
});

describe('sum', () => {
  it('sums centavo arrays', () => {
    expect(sum([100, 250, 50])).toBe(400);
    expect(sum([])).toBe(0);
  });
});
