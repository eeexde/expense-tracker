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
 * Parse user-typed amount into centavos.
 * Returns null for anything invalid or non-positive.
 */
export function parsePesoInput(input: string): number | null {
  const cleaned = input.trim().replace(/[₱,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [pesoPart, centPart = ''] = cleaned.split('.');
  const centavos = parseInt(pesoPart, 10) * 100 + parseInt(centPart.padEnd(2, '0') || '0', 10);
  return centavos > 0 ? centavos : null;
}

/** Plain editable text ("1234.56") that round-trips through parsePesoInput. */
export function centavosToInput(centavos: number): string {
  const pesos = Math.floor(centavos / 100);
  const cents = centavos % 100;
  return cents === 0 ? String(pesos) : `${pesos}.${String(cents).padStart(2, '0')}`;
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
