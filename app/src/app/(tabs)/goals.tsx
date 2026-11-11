import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Bar, Button, Card, Glyph, Icon, Screen, Stack3, T } from '@/components/ui';
import { friend, goalPot, monthlyEach, useStore } from '@/lib/store';
import { C, G, daysLeft, usd0 } from '@/lib/theme';

const STEPS: [any, string][] = [
  ['flag', 'One event, one goal: a trip, a wedding, a gift'],
  ['calendar', 'The goal becomes a small monthly amount each'],
  ['lock', 'Money waits in escrow on NEAR and earns yield'],
  ['thumbs-up', 'The group votes to release it, or to refund'],
];

export default function Goals() {
  const { s } = useStore();
  const me = s.user!.handle;
  const goals = s.goals ?? [];
  return (
    <Screen>
      <T s={32} w="x">Shared goals</T>
      <T s={14} c={C.sub} style={{ marginTop: 4, marginBottom: 20 }}>Save together for one event</T>

      <View style={st.hero}>
        <LinearGradient colors={['#0B3B2D', '#1E8F6C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <T s={18} w="b" c="#FFFFFF">How a shared goal works</T>
        <View style={{ gap: 12, marginTop: 14 }}>
          {STEPS.map(([i, t]) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={st.num}><Icon n={i} s={15} c="#FFFFFF" /></View>
              <T s={14} c="#FFFFFF" style={{ flex: 1 }}>{t}</T>
            </View>
          ))}
        </View>
        <T s={12} c="rgba(255,255,255,0.75)" style={{ marginTop: 14, lineHeight: 18 }}>
          Nobody can take the money alone. 75% of the money must vote yes to release it to the organiser; more than half to refund everyone.
        </T>
      </View>

      <View style={{ gap: 12, marginTop: 20 }}>
        {goals.map(g => {
          const pot = goalPot(g);
          const p = pot / g.target;
          const mine = g.members.find(m => m.handle === me);
          const closed = g.status !== 'open';
          return (
            <Card key={g.id} onPress={() => router.push(`/goal/${g.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <LinearGradient colors={G[g.color % G.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.cover}>
                  <Glyph v={g.emoji} s={24} />
                </LinearGradient>
                <View style={{ flex: 1, gap: 2 }}>
                  <T s={16} w="s" numberOfLines={1}>{g.name}</T>
                  <T s={13} c={C.sub}>{usd0(pot)} of {usd0(g.target)}</T>
                </View>
                <Stack3 people={g.members.map(m => friend(m.handle, s))} size={24} />
              </View>
              <View style={{ marginTop: 14 }}><Bar p={p} colors={[C.mint, '#1E8F6C']} h={8} /></View>
              <View style={st.foot}>
                <T s={13} c={C.sub}>{closed ? (g.status === 'released' ? 'Released to the organiser' : 'Refunded to everyone') : `${daysLeft(g.date)} days left`}</T>
                {!closed && (g.vote
                  ? <T s={13} w="s" c={C.violet}>Vote open</T>
                  : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {mine && mine.streak > 1 && <><Icon n="fire" s={14} c={C.amber} w="fill" /><T s={13} w="s" c={C.amber}>{mine.streak}</T><T s={13} c={C.mute}> · </T></>}
                      <T s={13} w="s">{usd0(monthlyEach(g))}/mo each</T>
                    </View>)}
              </View>
            </Card>
          );
        })}
        {!goals.length && (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 26 }}>
            <Icon n="flag" s={30} c={C.mint} w="duotone" />
            <T s={15} w="s">No shared goal yet</T>
            <T s={13} c={C.sub} center>Start one and invite your friends.</T>
          </Card>
        )}
      </View>

      <Button label="Start a shared goal" icon="plus" kind={goals.length ? 'dark' : 'primary'} style={{ marginTop: 16 }} onPress={() => router.push('/new-goal')} />
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 24, padding: 20, overflow: 'hidden' },
  num: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cover: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
});
