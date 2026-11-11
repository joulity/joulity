// Light premium theme: soft grey canvas, white cards, black ink, one green accent
export const C = {
  bg: '#F4F4F1',
  bg2: '#EBEBE6',
  card: '#FFFFFF',
  card2: '#F0F0EC',
  line: 'rgba(14,16,24,0.07)',
  track: 'rgba(14,16,24,0.08)',
  text: '#111113',
  sub: '#6B6B70',
  mute: '#A3A3A8',
  ink: '#111113',
  mint: '#0E8A63',
  mintDim: '#E3F1EA',
  violet: '#4F46C8',
  violetDim: '#ECEBF8',
  blue: '#2C5BD6',
  blueDim: '#E8EDF9',
  amber: '#B7741A',
  amberDim: '#F7EEDF',
  red: '#C8414B',
  redDim: '#F7E7E8',
  pink: '#B03C7A',
};

export const shadow = { boxShadow: '0px 1px 2px rgba(17,17,19,0.04), 0px 8px 28px rgba(17,17,19,0.06)' } as const;

export const F = {
  r: 'Inter_400Regular',
  m: 'Inter_500Medium',
  s: 'Inter_600SemiBold',
  b: 'Inter_700Bold',
  x: 'Inter_800ExtraBold',
} as const;

// deep, muted gradients for pocket covers (midnight, emerald, plum, bronze, ocean)
export const G: [string, string][] = [
  ['#1C1F3E', '#4A4FB3'],
  ['#0B3B2D', '#1E8F6C'],
  ['#3A1C47', '#A0528F'],
  ['#4A2E14', '#C58B4E'],
  ['#0D2742', '#2F78BC'],
];

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n: number) => (n < 0 ? '-$' : '$') + fmt.format(Math.abs(n));
export const usd0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export const DAY = 24 * 3600 * 1000;
export const daysLeft = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / DAY));
export const when = (t: number) => {
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
export const dateShort = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
