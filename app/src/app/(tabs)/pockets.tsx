import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Bar, Button, Glyph, Icon, Money, Screen, Stack3, T } from '@/components/ui';
import { friend, inPockets, pocketTotal, useStore } from '@/lib/store';
import { C, daysLeft, G, shadow, usd0 } from '@/lib/theme';

export default function Pockets() {
  const { s } = useStore();
  return (
    <Screen>
      <T s={32} w="x">Pockets</T>
      <T s={14} c={C.sub} style={{ marginTop: 6 }}>Your share in all pockets</T>
      <View style={{ marginTop: 6, marginBottom: 22 }}><Money v={inPockets(s)} s={36} hide={s.hide} /></View>

      <View style={{ gap: 14 }}>
        {s.pockets.map(p => {
          const tot = pocketTotal(p);
          const g = G[p.color % G.length];
          const pct = Math.round((tot / p.target) * 100);
          return (
            <Pressable key={p.id} onPress={() => router.push(`/pocket/${p.id}`)} style={({ pressed }) => [st.card, shadow, pressed && { opacity: 0.9 }]}>
              <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.cover}>
                <View style={st.emoji}><Glyph v={p.emoji} s={24} /></View>
                <View style={{ flex: 1 }}>
                  <T s={17} w="b" c="#FFFFFF">{p.name}</T>
                  <T s={13} w="m" c="rgba(255,255,255,0.85)">{daysLeft(p.deadline)} days left</T>
                </View>
                <View style={st.pct}><T s={13} w="b" c="#FFFFFF">{pct}%</T></View>
              </LinearGradient>
              <View style={{ padding: 16, gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <View>
                    <T s={22} w="b">{s.hide ? '••••' : usd0(tot)}</T>
                    <T s={13} c={C.sub}>of {usd0(p.target)}</T>
                  </View>
                  {p.members.length > 1
                    ? <Stack3 people={p.members.map(m => friend(m.handle, s))} />
                    : <View style={st.solo}><Icon n="lock" s={12} c={C.sub} /><T s={12} w="s" c={C.sub}>Just you</T></View>}
                </View>
                <Bar p={tot / p.target} colors={g} h={6} />
              </View>
            </Pressable>
          );
        })}
      </View>

      <Button label="New pocket" icon="plus" kind={s.pockets.length ? 'dark' : 'primary'} style={{ marginTop: 18 }} onPress={() => router.push('/new-pocket')} />
      <View style={st.note}>
        <Icon n="shield" s={14} c={C.sub} />
        <T s={12} c={C.sub} style={{ flex: 1, lineHeight: 18 }}>Group pockets live in a NEAR smart contract. Each member can take back only what they put in.</T>
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 24, backgroundColor: C.card, overflow: 'hidden' },
  cover: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  emoji: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  pct: { backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 10, height: 26, borderRadius: 13, justifyContent: 'center' },
  solo: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.card2, paddingHorizontal: 10, height: 26, borderRadius: 13 },
  note: { flexDirection: 'row', gap: 8, marginTop: 16, paddingHorizontal: 4 },
});
