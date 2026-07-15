import { ReactElement } from 'react';
import { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

/**
 * One-color stroke icon set (24×24 grid, Feather-style). The db `icon`
 * columns store these keys; anything unknown (old emoji, typos) falls
 * back to `tag` so stale data never crashes a render.
 */
const GLYPHS: Record<string, ReactElement> = {
  // buckets
  wallet: (
    <>
      <Rect x={3} y={6} width={18} height={13} rx={2} />
      <Path d="M21 11h-5a2 2 0 0 0 0 4h5" />
    </>
  ),
  cash: (
    <>
      <Rect x={2} y={6} width={20} height={12} rx={2} />
      <Circle cx={12} cy={12} r={2.5} />
      <Path d="M6 12h.01M18 12h.01" />
    </>
  ),
  phone: (
    <>
      <Rect x={7} y={2} width={10} height={20} rx={2} />
      <Path d="M12 18h.01" />
    </>
  ),
  card: (
    <>
      <Rect x={2} y={5} width={20} height={14} rx={2} />
      <Path d="M2 10h20" />
    </>
  ),
  bank: (
    <>
      <Path d="M3 21h18" />
      <Path d="M12 3l9 6H3l9-6z" />
      <Path d="M5 12v6M9.5 12v6M14.5 12v6M19 12v6" />
    </>
  ),
  savings: (
    <>
      <Rect x={4} y={11} width={16} height={10} rx={2} />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  // categories
  signal: <Path d="M3 20h.01M7.5 20v-4M12 20v-8M16.5 20V8M21 20V4" />,
  bus: (
    <>
      <Rect x={4} y={3} width={16} height={14} rx={2} />
      <Path d="M4 11h16" />
      <Circle cx={8} cy={19.5} r={1.5} />
      <Circle cx={16} cy={19.5} r={1.5} />
    </>
  ),
  zap: <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />,
  droplet: <Path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
  cart: (
    <>
      <Circle cx={9} cy={21} r={1} />
      <Circle cx={20} cy={21} r={1} />
      <Path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  dining: (
    <>
      <Path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <Path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <Path d="M6 1v3M10 1v3M14 1v3" />
    </>
  ),
  box: (
    <>
      <Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <Path d="M3.27 6.96L12 12.01l8.73-5.05" />
      <Path d="M12 22.08V12" />
    </>
  ),
  globe: (
    <>
      <Circle cx={12} cy={12} r={10} />
      <Path d="M2 12h20" />
      <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  home: (
    <>
      <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Path d="M9 22V12h6v10" />
    </>
  ),
  receipt: (
    <>
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <Path d="M14 2v6h6" />
      <Path d="M16 13H8M16 17H8M10 9H8" />
    </>
  ),
  users: (
    <>
      <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <Circle cx={9} cy={7} r={4} />
      <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  folder: (
    <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  ),
  laptop: (
    <>
      <Rect x={2} y={3} width={20} height={14} rx={2} />
      <Path d="M8 21h8M12 17v4" />
    </>
  ),
  wrench: (
    <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  tag: (
    <>
      <Path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z" />
      <Path d="M7 7h.01" />
    </>
  ),
  // app chrome
  list: <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  repeat: (
    <>
      <Path d="M17 1l4 4-4 4" />
      <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <Path d="M7 23l-4-4 4-4" />
      <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  chart: <Path d="M18 20V10M12 20V4M6 20v-6" />,
  transfer: (
    <>
      <Path d="M17 3l4 4-4 4" />
      <Path d="M21 7H3" />
      <Path d="M7 21l-4-4 4-4" />
      <Path d="M3 17h18" />
    </>
  ),
  camera: (
    <>
      <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <Circle cx={12} cy={13} r={4} />
    </>
  ),
  image: (
    <>
      <Rect x={3} y={3} width={18} height={18} rx={2} />
      <Circle cx={8.5} cy={8.5} r={1.5} />
      <Path d="M21 15l-5-5L5 21" />
    </>
  ),
  calendar: (
    <>
      <Rect x={3} y={4} width={18} height={18} rx={2} />
      <Path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  trash: (
    <>
      <Path d="M3 6h18" />
      <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
};

export type IconName = keyof typeof GLYPHS;

/** Keys offered in the category icon picker. */
export const CATEGORY_ICON_OPTIONS: IconName[] = [
  'tag',
  'signal',
  'bus',
  'zap',
  'droplet',
  'cart',
  'dining',
  'box',
  'globe',
  'home',
  'receipt',
  'users',
  'folder',
  'laptop',
  'wrench',
];

/** Keys offered in the bucket icon picker. */
export const BUCKET_ICON_OPTIONS: IconName[] = [
  'wallet',
  'cash',
  'phone',
  'card',
  'bank',
  'savings',
  'globe',
  'home',
  'cart',
  'laptop',
  'box',
  'tag',
];

interface Props {
  name: string;
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, color = colors.inkDim, strokeWidth = 1.8 }: Props) {
  const glyph = GLYPHS[name] ?? GLYPHS.tag;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </Svg>
  );
}
