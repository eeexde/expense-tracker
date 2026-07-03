/**
 * Kuripot design system — "digital alkansya".
 * Deep forest green, cream ink, peso-gold accent. Fraunces for money
 * numerals and headings, Manrope for everything else.
 */

export const colors = {
  // surfaces, darkest to lightest
  bg: '#0C1712',
  surface: '#12221A',
  surfaceRaised: '#1A2F24',
  border: '#26402F',

  // ink
  ink: '#F3EDDD',
  inkDim: '#A9B5A3',
  inkFaint: '#5F7263',

  // brand + semantics
  gold: '#E9B949',
  goldDim: '#8A6E2A',
  income: '#7FD4A2',
  expense: '#F0785A',
  transfer: '#8FB8DE',

  danger: '#E5533D',
} as const;

/**
 * Chart-only palette, validated (dataviz six checks) against `surface`
 * for dark mode: lightness band, chroma floor, CVD all-pairs ΔE ≥ 12,
 * contrast ≥ 3:1. Fixed order — assign in sequence, never cycle.
 * `chartOther` is the neutral "Iba pa" slot; it always carries a label.
 */
export const chartCategorical = [
  '#B8860B',
  '#D14E2A',
  '#2E9E62',
  '#5595D3',
  '#7E52C9',
] as const;
export const chartOther = '#5F7263';
export const chartIncome = '#2E9E62';
export const chartExpense = '#D14E2A';

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayBlack: 'Fraunces_900Black',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodyBold: 'Manrope_700Bold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

/** Local calendar date, YYYY-MM-DD (device timezone — PH users, PH time). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Current local month, YYYY-MM. */
export function currentMonth(): string {
  return todayLocal().slice(0, 7);
}
