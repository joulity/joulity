import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Button, Card, Done, Glyph, Header, Icon, Screen, SectionTitle, T } from '@/components/ui';
import { circleDone, circleDue, friend, useStore } from '@/lib/store';
import { C, DAY, dateShort, daysLeft, usd, usd0 } from '@/lib/theme';

import { RealCircle } from '@/components/onchain';

// real accounts (and invite links): circle n<number> is read from NEAR
export default function CircleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s } = useStore();
  if (s.user?.real && /^n\d+$/.test(id ?? '')) return <RealCircle chainId={Number(id!.slice(1))} />;
  return <CircleScreen />;
}

function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, payCircle } = useStore();
  const [result, setResult] = useState<null | { title: string; sub: string }>(null);
  const c = s.circles.find(q => q.id === id);
  if (!c) return <Screen><Header title="Circle" /><T c={C.sub}>This circle does not exist.</T></Screen>;
  if (result) return <Done title={result.title} sub={result.sub} onDone={() => setResult(null)} />;

  const me = s.user!.handle;
  const mi = c.members.indexOf(me);
  const done = circleDone(c);
  const pot = c.amount * c.members.length;
  const paidCount = c.paid.filter(Boolean).length;
  const low = s.balance < c.amount;

  const pay = () => {
    const winner = friend(c.members[c.round], s).name;
    const r = payCircle(c.id);
    setResult(r === 'payout'
      ? { title: `You got ${usd0(pot)}!`, sub: `Everyone paid round ${c.round + 1}, so the pot went straight to your account.` }
      : { title: 'Payment sent', sub: `Everyone paid round ${c.round + 1}. ${winner} received the ${usd0(pot)} pot.` });
  };

  return (
    <Screen bottom={60}>
      <Header title={c.name} />
      <View style={st.hero}>
        <LinearGradient colors={['#17153A', '#3F3AA8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={st.glyph}><Glyph v={c.emoji} s={30} /></View>
        <T s={13} w="m" c="rgba(255,255,255,0.8)" style={{ marginTop: 10 }}>Pot each round</T>
        <T s={40} w="b" c="#FFFFFF">{usd0(pot)}</T>
        <T s={14} c="rgba(255,255,255,0.8)">{usd0(c.amount)} × {c.members.length} members · {c.periodDays >= 28 ? 'monthly' : 'weekly'}</T>
        {!done && (
          <View style={st.progress}>
            {c.members.map((_, i) => <View key={i} style={[st.seg, { backgroundColor: i < c.round ? 'rgba(255,255,255,0.55)' : i === c.round ? '#FFFFFF' : 'rgba(255,255,255,0.18)' }]} />)}
          </View>
        )}
        <T s={13} w="s" c="#FFFFFF" style={{ marginTop: 12 }}>
          {done ? 'Circle completed. Everyone got their pot.' : `Round ${c.round + 1} of ${c.members.length} · ${paidCount}/${c.members.length} paid`}
        </T>
      </View>

      {!done && (
        <Card style={{ marginTop: 16 }}>
          {c.paid[mi] ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon n="check-circle" s={22} c={C.mint} />
              <T s={15} w="s">You paid this round</T>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
                <View><T s={12} c={C.mute}>Your payment</T><T s={20} w="b">{usd(c.amount)}</T></View>
                <View style={{ alignItems: 'flex-end' }}><T s={12} c={C.mute}>Due</T><T s={20} w="b" c={C.amber}>{daysLeft(circleDue(c))} days</T></View>
              </View>
              <Button label={low ? 'Add money first' : `Pay ${usd0(c.amount)}`} disabled={low} onPress={pay} />
              {low && <T s={13} c={C.red} center style={{ marginTop: 8 }}>Your account has {usd(s.balance)}.</T>}
            </>
          )}
        </Card>
      )}

      <SectionTitle title="Payout order" />
      <Card style={{ paddingVertical: 6 }}>
        {c.members.map((h, i) => {
          const f = friend(h, s);
          const got = i < c.round, now = i === c.round && !done;
          return (
            <View key={h} style={[st.row, i < c.members.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <T s={13} w="b" c={C.mute} style={{ width: 18 }}>{i + 1}</T>
              <Avatar name={f.name} color={f.color} size={38} />
              <View style={{ flex: 1 }}>
                <T s={15} w="s">{f.name}</T>
                <T s={12} c={C.sub}>{dateShort(c.startedAt + (i + 1) * c.periodDays * DAY)}</T>
              </View>
              {got ? <T s={13} w="s" c={C.violet}>Received</T>
                : now ? <View style={st.now}><T s={12} w="s" c={C.mint}>This round</T></View>
                : <T s={13} c={C.mute}>Upcoming</T>}
              {now && <Icon n={c.paid[i] ? 'check' : 'clock'} s={14} c={c.paid[i] ? C.mint : C.amber} />}
            </View>
          );
        })}
      </Card>
      <T s={12} c={C.mute} style={{ marginTop: 12, lineHeight: 18 }}>
        If someone does not pay before the round ends, the pot still goes out and the missed payment stays on their record in the contract.
      </T>
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, padding: 22, alignItems: 'center', overflow: 'hidden' },
  glyph: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: 6, marginTop: 18, width: '100%' },
  seg: { flex: 1, height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  now: { backgroundColor: C.mintDim, paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: 'center' },
});
