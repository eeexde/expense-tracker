/** All amounts app-wide are integer centavos. */

export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const cents = abs % 100;
  const pesoStr = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₱${pesoStr}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Grammar shared by every peso field: optional ₱, commas and whitespace, at
 * most two decimals. Returns centavos including zero — whether zero is
 * meaningful is a per-field question, answered by the two exports below.
 */
function parsePesoDigits(input: string): number | null {
  const cleaned = input.trim().replace(/[₱,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [pesoPart, centPart = ''] = cleaned.split('.');
  return parseInt(pesoPart, 10) * 100 + parseInt(centPart.padEnd(2, '0') || '0', 10);
}

/**
 * Parse a user-typed *amount* into centavos.
 * Returns null for anything invalid or non-positive: a ₱0 expense, income,
 * debt or installment due is meaningless, so amount fields reject zero — and
 * so does `repo.ts`'s `assertPositive` on the way to the db.
 *
 * Balance fields are the other case and want `parsePesoBalanceInput`.
 */
export function parsePesoInput(input: string): number | null {
  const centavos = parsePesoDigits(input);
  return centavos !== null && centavos > 0 ? centavos : null;
}

/**
 * Parse a user-typed *balance* into centavos, zero included.
 * A bucket holding ₱0 is an ordinary bucket, and 0 is the schema default for
 * `buckets.starting_balance` — rejecting it here is what used to make every
 * such bucket permanently uneditable.
 */
export function parsePesoBalanceInput(input: string): number | null {
  return parsePesoDigits(input);
}

/** Plain editable text ("1234.56") that round-trips through parsePesoInput. */
export function centavosToInput(centavos: number): string {
  // Sign is split off first: `Math.floor` and `%` disagree about direction on
  // negatives, which used to render -150 as "-2.-50".
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const cents = abs % 100;
  return cents === 0 ? `${sign}${pesos}` : `${sign}${pesos}.${String(cents).padStart(2, '0')}`;
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
