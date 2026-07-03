export const MONTH_NAMES = [
  'Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo',
  'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre',
];

export function shiftMonth(ym: string, delta: number): string {
  let [year, month] = ym.split('-').map(Number);
  month += delta;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Short label for chart axes, e.g. 'Peb'. */
export function monthShort(ym: string): string {
  const month = Number(ym.split('-')[1]);
  return MONTH_NAMES[month - 1].slice(0, 3);
}
