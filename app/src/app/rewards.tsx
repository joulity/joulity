import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Done, Header, Icon, Screen, SectionTitle, T } from '@/components/ui';
import { ASSETS, Asset, usePrices } from '@/lib/prices';
import { liveGain, useStore } from '@/lib/store';
import { C, usd } from '@/lib/theme';

const PRESETS: [string, Record<Asset, number>][] = [
  ['Careful', { usd: 70, btc: 10, gold: 20 }],
  ['Balanced', { usd: 40, btc: 30, gold: 30 }],
  ['Bitcoin fan', { usd: 20, btc: 60, gold: 20 }],
  ['Gold lover', { usd: 20, btc: 20, gold: 60 }],
];
const units = (k: Asset, v: number) => (k === 'btc' ? v.toFixed(6) : k === 'gold' ? v.toFixed(4) : v.toFixed(2));

export default function Rewards() {
  const { s, setMix, buyRewards } = useStore();
  const p = usePrices();
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (done) return <Done title="Portfolio bought" sub={done} onDone={() => setDone(null)} />;

  const real = !!s.user?.real;
  const mix = s.mix ?? { usd: 40, btc: 30, gold: 30 };
  const bag = s.bag ?? { usd: 0, btc: 0, gold: 0 };
  const cost = s.cost ?? { usd: 0, btc: 0, gold: 0 };
  const value = (k: Asset) => (p ? bag[k] * p[k] : cost[k]);
  const total = ASSETS.reduce((a, x) => a + value(x.key), 0);
  const paid = ASSETS.reduce((a, x) => a + cost[x.key], 0);
  const change = total - paid;
  const pending = Math.max(0, s.earned + liveGain(s, now) - (s.converted ?? 0));

  // +/- 10 on one asset, taken from / given to the others, always 100% in total
  const step = (k: Asset, d: number) => {
    const m = { ...mix };
    if (m[k] + d < 0 || m[k] + d > 100) return;
    m[k] += d;
    const others = (Object.keys(m) as Asset[]).filter(o => o !== k).sort((a, b) => (d > 0 ? m[b] - m[a] : m[a] - m[b]));
    let left = -d;
    for (const o of others) { const take = d > 0 ? Math.max(left, -m[o]) : left; m[o] += take; left -= take; if (!left) break; }
    setMix(m);
  };

  const buy = () => {
    if (!p) return;
    const v = buyRewards(p);
    if (v) setDone(`${usd(v)} of rewards became ${mix.usd}% dollars, ${mix.btc}% Bitcoin and ${mix.gold}% gold, at live NEAR Intents prices.`);
  };

  return (
    <Screen bottom={60}>
      <Header title="My rewards" />
      <View style={st.hero}>
        <LinearGradient colors={['#2B2410', '#7A5C12', '#B08D1E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <T s={13} w="m" c="rgba(255,255,255,0.7)">Rewards portfolio</T>
        <T s={40} w="b" c="#FFFFFF" style={{ marginTop: 4 }}>{real ? '$0.00' : usd(total)}</T>
        {!real && paid > 0 && (
          <T s={14} w="s" c={change >= 0 ? '#9BF0C8' : '#FFB4B4'}>{change >= 0 ? '+' : ''}{usd(change)} since bought</T>
        )}
        <View style={st.bar}>
          {ASSETS.map(x => <View key={x.key} style={{ flex: Math.max(0.001, real ? mix[x.key] : value(x.key)), backgroundColor: x.color }} />)}
        </View>
        <T s={12} c="rgba(255,255,255,0.75)" style={{ marginTop: 12, lineHeight: 18 }}>
          Your savings stay in dollars. Only the rewards they earn buy this portfolio, through NEAR Intents.
        </T>
      </View>

      <Card style={{ marginTop: 16, paddingVertical: 6 }}>
        {ASSETS.map((x, i) => (
          <View key={x.key} style={[st.row, i < 2 && st.line]}>
            <View style={[st.ic, { backgroundColor: x.dim }]}><Icon n={x.icon} s={20} c={x.color} w="duotone" /></View>
            <View style={{ flex: 1 }}>
              <T s={15} w="s">{x.name}</T>
              <T s={12} c={C.sub}>{p ? (x.key === 'usd' ? 'Always $1' : `${usd(p[x.key])} / ${x.key === 'btc' ? 'BTC' : 'oz'} · live`) : 'Loading price…'}</T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T s={15} w="s">{real ? '$0.00' : usd(value(x.key))}</T>
              <T s={12} c={C.mute}>{real ? x.risk : `${units(x.key, bag[x.key])} ${x.unit}`}</T>
            </View>
          </View>
        ))}
      </Card>

      <SectionTitle title="How to split my rewards" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {PRESETS.map(([l, m]) => <Chip key={l} label={l} active={ASSETS.every(x => m[x.key] === mix[x.key])} onPress={() => setMix(m)} />)}
      </View>
      <Card style={{ gap: 14 }}>
        {ASSETS.map(x => (
          <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon n={x.icon} s={18} c={x.color} w="duotone" />
            <T s={15} w="s" style={{ width: 70 }}>{x.name}</T>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' }}>
              <View style={{ width: `${mix[x.key]}%`, height: '100%', backgroundColor: x.color }} />
            </View>
            <Pressable onPress={() => step(x.key, -10)} style={st.step} hitSlop={6}><Icon n="minus" s={14} /></Pressable>
            <T s={14} w="b" style={{ width: 40, textAlign: 'center' }}>{mix[x.key]}%</T>
            <Pressable onPress={() => step(x.key, 10)} style={st.step} hitSlop={6}><Icon n="plus" s={14} /></Pressable>
          </View>
        ))}
      </Card>

      {real ? (
        <Card style={{ marginTop: 16, gap: 6 }}>
          <T s={15} w="s">Starts with the vault</T>
          <T s={13} c={C.sub} style={{ lineHeight: 19 }}>
            Your split is saved. When your savings earn in the Joulity vault on NEAR, every week the rewards buy this mix through NEAR Intents. Prices above are live.
          </T>
        </Card>
      ) : (
        <Card style={{ marginTop: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View><T s={12} c={C.mute}>Rewards ready to invest</T><T s={22} w="b" c={C.mint}>{usd(pending)}</T></View>
            <View style={st.auto}><Icon n="repeat" s={13} c={C.violet} /><T s={12} w="s" c={C.violet}>Every week</T></View>
          </View>
          <Button label={p ? 'Buy my portfolio now' : 'Loading prices…'} icon="pie" disabled={!p || pending < 0.01} onPress={buy} />
          <T s={12} c={C.mute} center>Demo: prices are real, the money is not.</T>
        </Card>
      )}
      <T s={12} c={C.mute} style={{ marginTop: 12, lineHeight: 18 }}>
        Bitcoin and gold prices go up and down; the dollars part does not. Stocks (S&P 500, Nasdaq) come next with NEAR Intents.
      </T>
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, padding: 22, overflow: 'hidden' },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 16, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: C.line },
  ic: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  step: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  auto: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.violetDim, paddingHorizontal: 10, height: 28, borderRadius: 14 },
});
