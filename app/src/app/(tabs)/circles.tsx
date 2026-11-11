import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Glyph, Icon, Screen, Stack3, T } from '@/components/ui';
import { circleDone, circleDue, friend, useStore } from '@/lib/store';
import { C, daysLeft, usd0 } from '@/lib/theme';

const STEPS: [any, string][] = [
  ['users', 'Friends or family join, each with the same amount'],
  ['repeat', 'Everyone pays every round, weekly or monthly'],
  ['gift', 'Each round, one member gets the whole pot'],
];

export default function Circles() {
  const { s } = useStore();
  const me = s.user!.handle;
  return (
    <Screen>
      <T s={32} w="x">Circles</T>
      <T s={14} c={C.sub} style={{ marginTop: 4, marginBottom: 20 }}>Save in turns with people you trust</T>

      <View style={st.hero}>
        <LinearGradient colors={['#17153A', '#3F3AA8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <T s={18} w="b" c="#FFFFFF">How a circle works</T>
        <View style={{ gap: 12, marginTop: 14 }}>
          {STEPS.map(([i, t], n) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={st.num}><Icon n={i} s={15} c="#FFFFFF" /></View>
              <T s={14} c="#FFFFFF" style={{ flex: 1 }}>{t}</T>
            </View>
          ))}
        </View>
        <T s={12} c="rgba(255,255,255,0.75)" style={{ marginTop: 14 }}>No interest, no bank. The order and the payouts are enforced by a NEAR smart contract.</T>
      </View>

      <View style={{ gap: 12, marginTop: 20 }}>
        {s.circles.map(c => {
          const done = circleDone(c);
          const mine = c.members.indexOf(me);
          return (
            <Card key={c.id} onPress={() => router.push(`/circle/${c.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={st.emoji}><Glyph v={c.emoji} s={24} c={C.violet} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T s={16} w="s">{c.name}</T>
                  <T s={13} c={C.sub}>{usd0(c.amount)}/{c.periodDays >= 28 ? 'month' : 'week'} · pot {usd0(c.amount * c.members.length)}</T>
                </View>
                <Stack3 people={c.members.map(h => friend(h, s))} size={24} />
              </View>
              <View style={st.foot}>
                <T s={13} c={C.sub}>{c.chainId && !c.startedAt ? `Waiting to start · ${c.members.length} joined` : done ? 'Completed' : `Round ${c.round + 1} of ${c.members.length}`}</T>
                <T s={13} w="s" c={done ? C.mint : c.paid[mine] ? C.mint : C.amber}>
                  {c.chainId && !c.startedAt ? 'Invite friends' : done ? 'All paid out ✓' : c.paid[mine] ? 'You paid ✓' : `Pay in ${daysLeft(circleDue(c))}d`}
                </T>
              </View>
            </Card>
          );
        })}
      </View>

      <Button label="Start a circle" icon="plus" kind={s.circles.length ? 'dark' : 'primary'} style={{ marginTop: 16 }} onPress={() => router.push('/new-circle')} />
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 24, padding: 20, overflow: 'hidden' },
  num: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  emoji: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.violetDim, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
});
