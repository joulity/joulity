import { Tx } from '@/lib/store';
import { C, usd, when } from '@/lib/theme';
import { Row } from './ui';

const LOOK: Record<Tx['kind'], { icon: any; color: string; sign: 1 | -1 }> = {
  add: { icon: 'arrow-down-left', color: C.mint, sign: 1 },
  payout: { icon: 'gift', color: C.mint, sign: 1 },
  send: { icon: 'arrow-up-right', color: C.text, sign: -1 },
  in: { icon: 'target', color: C.blue, sign: -1 },
  out: { icon: 'corner-down-left', color: C.blue, sign: 1 },
  circle: { icon: 'users', color: C.violet, sign: -1 },
  goal: { icon: 'flag', color: C.mint, sign: -1 },
};

export function TxRow({ t, hide, last }: { t: Tx; hide?: boolean; last?: boolean }) {
  const l = LOOK[t.kind];
  const plus = l.sign > 0;
  return (
    <Row icon={l.icon} iconColor={l.color} iconBg={l.color + '1F'} title={t.title} sub={t.sub}
      right={hide ? '••••' : (plus ? '+' : '-') + usd(t.amount)} rightColor={plus ? C.mint : C.text}
      rightSub={when(t.t)} last={last} />
  );
}
