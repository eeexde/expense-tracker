import { formatPeso, parsePesoInput, sum } from './money';

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

describe('sum', () => {
  it('sums centavo arrays', () => {
    expect(sum([100, 250, 50])).toBe(400);
    expect(sum([])).toBe(0);
  });
});
