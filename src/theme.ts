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

  /**
   * Ink ramp. Every one of these is used as body text on `bg`, `surface` AND
   * `surfaceRaised`, so each has to clear WCAG AA (4.5:1) against the *lightest*
   * of the three — `surfaceRaised` — not just against `bg`. Ratios on
   * bg / surface / surfaceRaised:
   *   ink      15.67 / 14.15 / 12.17
   *   inkDim    8.57 /  7.74 /  6.66
   *   inkFaint  6.01 /  5.43 /  4.67
   * `inkFaint` was #5F7263 (3.55 / 3.21 / 2.76) and failed on all three.
   * Lifting it costs some of its distance from `inkDim` — ΔL* 26.2 → 11.1,
   * ΔE76 26.2 → 11.7 — but that is still a wider step than the one between
   * `surface` and `surfaceRaised` (ΔE76 6.4), which the whole card design
   * already leans on to read as two layers.
   */
  ink: '#F3EDDD',
  inkDim: '#A9B5A3',
  inkFaint: '#849988',

  // brand + semantics
  gold: '#E9B949',
  goldDim: '#8A6E2A',
  income: '#7FD4A2',
  expense: '#F0785A',
  transfer: '#8FB8DE',

  /**
   * Same AA problem as `inkFaint`: #E5533D cleared 4.5:1 on `bg` (4.91) alone
   * and failed as text on `surface` (4.44) and `surfaceRaised` (3.82) — the
   * inbox card's Discard label, every form error hint. Now 6.14 / 5.55 / 4.77.
   * Pushed toward crimson rather than simply lightened, so it keeps its
   * distance from the neighbouring `expense` coral (ΔE76 14.4, against 15.4
   * before) instead of collapsing into it.
   */
  danger: '#F26A6A',
} as const;

/**
 * Chart-only palette, validated (dataviz six checks) against `surface`
 * for dark mode: lightness band, chroma floor, CVD all-pairs ΔE ≥ 12,
 * contrast ≥ 3:1. Fixed order — assign in sequence, never cycle.
 * `chartOther` is the neutral "Others" slot; it always carries a label. It
 * happened to be the same hex as the old `inkFaint` and is not derived from it:
 * it is a fill, judged at 3:1, and stays put now that `inkFaint` has been
 * lifted to an AA-passing text color.
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
