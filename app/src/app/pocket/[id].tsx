import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Avatar, Bar, Button, Card, Glyph, Header, Ring, Row, Screen, SectionTitle, T } from '@/components/ui';
import { TxRow } from '@/components/tx';
import { friend, myPut, pocketTotal, useStore } from '@/lib/store';
import { Invite, RealPocketJoin } from '@/components/onchain';
import { C, dateShort, daysLeft, G, usd, usd0 } from '@/lib/theme';

export default function PocketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s } = useStore();
  if (!s.user) return <SignInFirst />;
  const p = s.pockets.find(q => q.id === id);
  if (!p && s.user?.real && /^n\d+$/.test(id ?? '')) return <RealPocketJoin chainId={Number(id!.slice(1))} />;
  if (!p) return <Screen><Header title="Pocket" /><T c={C.sub}>This pocket does not exist.</T></Screen>;
  const tot = pocketTotal(p);
  const g = G[p.color % G.length];
  const mine = myPut(p, s.user!.handle);
  const days = daysLeft(p.deadline);
  const perWeek = days > 0 ? Math.max(0, p.target - tot) / Math.max(1, days / 7) : 0;
  const txs = s.txs.filter(t => t.ref === p.id);

  return (
    <Screen bottom={60}>
      <Header title={p.name} />
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Ring p={tot / p.target} size={168} stroke={12} colors={g}>
          <Glyph v={p.emoji} s={40} c={g[1]} />
          <T s={15} w="s" c={C.sub}>{Math.round((tot / p.target) * 100)}%</T>
        </Ring>
        <T s={38} w="b" style={{ marginTop: 14 }}>{s.hide ? '••••' : usd(tot)}</T>
        <T s={14} c={C.sub}>of {usd0(p.target)} by {dateShort(p.deadline)}</T>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
        <Button label="Add" icon="plus" style={{ flex: 1 }} onPress={() => router.push(`/move?id=${p.id}&dir=in`)} />
        <Button label="Take out" icon="arrow-up" kind="dark" style={{ flex: 1 }} disabled={mine <= 0} onPress={() => router.push(`/move?id=${p.id}&dir=out`)} />
      </View>

      <Card style={{ marginTop: 16, flexDirection: 'row' }}>
        <View style={{ flex: 1 }}><T s={12} c={C.mute}>Your share</T><T s={16} w="s">{s.hide ? '••••' : usd(mine)}</T></View>
        <View style={{ flex: 1 }}><T s={12} c={C.mute}>Days left</T><T s={16} w="s">{days}</T></View>
        <View style={{ flex: 1 }}><T s={12} c={C.mute}>To stay on track</T><T s={16} w="s" c={C.mint}>{usd0(perWeek)}/wk</T></View>
      </Card>

      <SectionTitle title={p.members.length > 1 ? `Members · ${p.members.length}` : 'Members'} />
      <Card style={{ paddingVertical: 8 }}>
        {[...p.members].sort((a, b) => b.put - a.put).map((m, i, a) => {
          const f = friend(m.handle, s);
          return (
            <View key={m.handle} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: i < a.length - 1 ? 1 : 0, borderBottomColor: C.line }}>
              <Avatar name={f.name} color={f.color} size={38} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T s={15} w="s">{f.name}</T>
                  <T s={15} w="s">{s.hide ? '••••' : usd0(m.put)}</T>
                </View>
                <Bar p={tot ? m.put / tot : 0} colors={[f.color, f.color]} h={4} />
              </View>
            </View>
          );
        })}
      </Card>
      {p.solo ? null : p.chainId != null ? <Invite path={`pocket/n${p.chainId}`} what="this pocket" /> : p.members.length === 1 && <T s={13} c={C.mute} style={{ marginTop: 10 }}>Tip: share this pocket with friends to save for it together.</T>}

      <SectionTitle title="Activity" />
      <Card style={{ paddingVertical: 4 }}>
        {txs.length ? txs.map((t, i) => <TxRow key={t.id} t={t} hide={s.hide} last={i === txs.length - 1} />)
          : <Row icon="clock" iconColor={C.mute} title="Nothing yet" sub="Add money to this pocket" last />}
      </Card>
    </Screen>
  );
}

function SignInFirst() {
  try { if (typeof window !== 'undefined') window.localStorage.setItem('joulity.invite', window.location.pathname.replace(/^\/bank/, '')); } catch {}
  return <Redirect href="/welcome" />;
}
