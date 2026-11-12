import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Bar, Card, DemoTag, Glyph, Icon, Money, Row, Screen, SectionTitle, Stack3, T, Button } from '@/components/ui';
import { MainnetTag } from '@/components/real';
import { TxRow } from '@/components/tx';
import { useAuth } from '@/lib/auth';
import { short } from '@/lib/near';
import { circleDone, circleDue, friend, goalPot, monthlyEach, inPockets, liveGain, pocketTotal, RATE, useStore } from '@/lib/store';
import { findMyPockets } from '@/lib/relay';
import { goalFromChain } from '@/components/onchain';
import { C, daysLeft, G, shadow, usd, usd0 } from '@/lib/theme';

const ACTIONS: [string, any, string][] = [
  ['Add', 'plus', '/add'],
  ['Send', 'arrow-up-right', '/send'],
  ['Pocket', 'target', '/new-group'],
];

const CHAINS: [string, string][] = [['N', '#0E1016'], ['E', '#627EEA'], ['B', '#0052FF'], ['S', '#9945FF'], ['A', '#28A0F0']];

export default function Home() {
  useEffect(() => { try { const p = window.localStorage.getItem('joulity.invite'); if (p) { window.localStorage.removeItem('joulity.invite'); router.push(p as any); } } catch {} }, []);
  const { s, toggleHide } = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const a = useAuth();
  const real = !!s.user?.real;
  // real account: after a new sign-in the phone has no list yet; bring back the pockets from the chain
  const { saveReal } = useStore();
  useEffect(() => {
    if (!real || !s.user?.handle) return; const me = s.user.handle; let off = false;
    findMyPockets(me).then((list) => { if (off) return; list.forEach((p, i) => {
      const old = s.pockets.find((q) => q.chainId === p.chainId);
      saveReal('pockets', { ...(old ?? { emoji: 'diamond', color: i, createdAt: Date.now() }), id: old?.id ?? `n${p.chainId}`, chainId: p.chainId, name: p.name, target: p.target, deadline: p.deadline,
        members: p.members.map((h) => ({ handle: h, put: h === me ? p.mine : (old?.members.find((x) => x.handle === h)?.put ?? 0) })) } as any);
    });
      list.goals.forEach(({ id, g }) => { const prev = s.goals.find((q) => q.chainId === id); saveReal('goals', goalFromChain(id, g, list.price, prev)); });
    }).catch(() => {});
    return () => { off = true; };
  }, [real, s.user?.handle]);
  const gain = liveGain(s, now);
  const pockets = inPockets(s);
  // real account: the balance is the USDC the chain holds for this NEAR account
  const vault = real && a.chain ? a.chain.jusd * a.chain.price : 0;
  const bal = real ? (a.chain?.usdc ?? 0) + vault : s.balance + gain;
  const total = bal + pockets;
  const earned = s.earned + gain;
  const perDay = (s.balance + pockets) * RATE / 365;
  const circle = s.circles.find(c => !circleDone(c));
  const me = s.user!.handle;
  const hide = (v: string) => (s.hide ? '••••' : v);

  return (
    <Screen>
      <View style={st.top}>
        <Pressable onPress={() => router.push('/me')}><Avatar name={s.user!.name} color={C.violet} size={40} /></Pressable>
        {real ? <MainnetTag /> : <DemoTag />}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={toggleHide} style={[st.iconBtn, shadow]}><Icon n={s.hide ? 'eye-off' : 'eye'} s={18} /></Pressable>
          <Pressable onPress={() => router.push('/activity')} style={[st.iconBtn, shadow]}><Icon n="bell" s={18} /></Pressable>
        </View>
      </View>

      <View style={st.hero}>
        <LinearGradient colors={['#18181B', '#2A2A30', '#141416']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* soft sheen, like brushed metal */}
        <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']} start={{ x: 0.1, y: 0 }} end={{ x: 0.6, y: 0.7 }} style={StyleSheet.absoluteFill} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T s={13} w="m" c="rgba(255,255,255,0.6)">Total balance</T>
          <View style={st.usd}><T s={11} w="s" c="rgba(255,255,255,0.8)">USD</T></View>
        </View>
        <View style={{ marginTop: 10 }}><Money v={total} s={44} hide={s.hide} c="#FFFFFF" dim="rgba(255,255,255,0.4)" /></View>
        {real ? (
          <View style={st.earnRow}>
            <View style={st.earnPill}>
              <Icon n="globe" s={13} c="#5EE0A8" w="bold" />
              <T s={13} w="s" c="#5EE0A8">{a.chain ? 'Live on NEAR' : a.chainErr ? 'NEAR is slow, retrying' : 'Reading NEAR…'}</T>
            </View>
            <T s={13} c="rgba(255,255,255,0.55)">{a.chain ? 'Gas paid by Joulity' : ''}</T>
          </View>
        ) : <View style={st.earnRow}>
          <View style={st.earnPill}>
            <Icon n="trending-up" s={13} c="#5EE0A8" w="bold" />
            <T s={13} w="s" c="#5EE0A8">{hide(`+${usd(perDay)} today`)}</T>
          </View>
          <T s={13} c="rgba(255,255,255,0.55)">{(RATE * 100).toFixed(1)}% a year · demo rate</T>
        </View>}
        <View style={st.heroFoot}>
          <T s={12} w="s" c="rgba(255,255,255,0.45)" style={{ letterSpacing: 1.5 }}>{(real ? short(s.user!.handle) : s.user!.handle).toUpperCase()}</T>
          <T s={14} w="x" c="rgba(255,255,255,0.85)">Joulity</T>
        </View>
      </View>

      <View style={st.actions}>
        {ACTIONS.map(([label, icon, href], i) => (
          <Pressable key={label} onPress={() => router.push(href as any)} style={({ pressed }) => [st.action, pressed && { opacity: 0.6 }]}>
            <View style={[st.actionIcon, shadow]}>
              <Icon n={icon} s={24} c={C.text} w="duotone" />
            </View>
            <T s={13} w="s">{label}</T>
          </Pressable>
        ))}
      </View>

      <Card style={{ flexDirection: 'row', padding: 0 }}>
        {[
          ['Account', usd(bal), C.text, 'credit-card'],
          ['In pockets', usd(pockets), C.text, 'target'],
          ['Earned', '+' + usd(earned), C.mint, 'trending-up'],
        ].map(([label, v, color, icon], i) => (
          <View key={label} style={[st.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: C.line }]}>
            <Icon n={icon as any} s={18} c={C.sub} w="duotone" />
            <T s={12} c={C.sub} style={{ marginTop: 8 }}>{label}</T>
            <T s={15} w="b" c={color} numberOfLines={1}>{hide(v)}</T>
          </View>
        ))}
      </Card>


      <Card onPress={() => router.push('/rewards')} style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <LinearGradient colors={['#7A5C12', '#B08D1E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.round, { overflow: 'hidden' }]}><Icon n="pie" s={22} c="#FFFFFF" w="duotone" /></LinearGradient>
        <View style={{ flex: 1 }}>
          <T s={15} w="s">My rewards portfolio</T>
          <T s={13} c={C.sub}>{`${(s.mix ?? { usd: 40 }).usd}% dollars · ${(s.mix ?? { btc: 30 }).btc}% Bitcoin · ${(s.mix ?? { gold: 30 }).gold}% gold`}</T>
        </View>
        <Icon n="chevron-right" s={18} c={C.mute} />
      </Card>

      <SectionTitle title="Shared goals" action={(s.goals ?? []).length ? 'See all' : undefined} onAction={() => router.push('/goals')} />
      {(s.goals ?? []).filter(g => g.status === 'open').slice(0, 2).map(g => {
        const pot = goalPot(g);
        return (
          <Card key={g.id} onPress={() => router.push(`/goal/${g.id}`)} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <LinearGradient colors={G[g.color % G.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.round, { overflow: 'hidden' }]}><Glyph v={g.emoji} s={20} /></LinearGradient>
              <View style={{ flex: 1 }}>
                <T s={15} w="s" numberOfLines={1}>{g.name}</T>
                <T s={12} c={C.sub}>{g.vote ? 'Vote open: tap to vote' : `${usd0(monthlyEach(g))}/mo each · ${g.members.length} people`}</T>
              </View>
              <T s={15} w="b">{hide(usd0(pot))}</T>
            </View>
            <View style={{ marginTop: 10 }}><Bar p={pot / g.target} colors={[C.mint, '#1E8F6C']} h={5} /></View>
          </Card>
        );
      })}
      {!(s.goals ?? []).some(g => g.status === 'open') && (
        <Card onPress={() => router.push('/new-goal')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={[st.round, { backgroundColor: C.mintDim }]}><Icon n="flag" s={20} c={C.mint} /></View>
          <View style={{ flex: 1 }}><T s={15} w="s">Start a shared goal</T><T s={13} c={C.sub}>One event, friends, money in escrow.</T></View>
        </Card>
      )}

      <SectionTitle title="Pockets" action={s.pockets.length ? 'See all' : undefined} onAction={() => router.push('/pockets')} />
      {s.pockets.length === 0 ? (
        <Card onPress={() => router.push('/new-group')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={[st.round, { backgroundColor: C.mintDim }]}><Icon n="plus" s={20} c={C.mint} /></View>
          <View style={{ flex: 1 }}><T s={15} w="s">Create your first pocket</T><T s={13} c={C.sub}>A trip, a car, a safety net. Invite friends.</T></View>
        </Card>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 6, gap: 12 }}>
          {s.pockets.map(p => {
            const tot = pocketTotal(p);
            const g = G[p.color % G.length];
            return (
              <Pressable key={p.id} onPress={() => router.push(`/pocket/${p.id}`)} style={({ pressed }) => [st.pocket, shadow, pressed && { opacity: 0.85 }]}>
                <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.cover}>
                  <View style={st.glyph}><Glyph v={p.emoji} s={22} /></View>
                  {p.members.length > 1 && <View style={st.coverTag}><Icon n="users" s={11} c="#FFFFFF" /><T s={11} w="s" c="#FFFFFF">{p.members.length}</T></View>}
                </LinearGradient>
                <View style={{ padding: 14, gap: 3 }}>
                  <T s={14} w="s" c={C.sub} numberOfLines={1}>{p.name}</T>
                  <T s={19} w="b">{hide(usd0(tot))}</T>
                  <View style={{ marginTop: 8 }}><Bar p={tot / p.target} colors={g} h={5} /></View>
                  <T s={12} c={C.mute} style={{ marginTop: 6 }}>{Math.round((tot / p.target) * 100)}% of {usd0(p.target)}</T>
                </View>
              </Pressable>
            );
          })}
          <Pressable onPress={() => router.push('/new-group')} style={[st.pocket, st.addPocket]}>
            <View style={[st.round, { backgroundColor: C.card }]}><Icon n="plus" s={20} /></View>
            <T s={14} w="s" c={C.sub}>New pocket</T>
          </Pressable>
        </ScrollView>
      )}

      {circle && (
        <>
          <SectionTitle title="Savings circle" action="See all" onAction={() => router.push('/circles')} />
          <Card onPress={() => router.push(`/circle/${circle.id}`)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={[st.round, { backgroundColor: C.violetDim }]}><Glyph v={circle.emoji} s={22} c={C.violet} /></View>
              <View style={{ flex: 1 }}>
                <T s={15} w="s">{circle.name}</T>
                <T s={13} c={C.sub}>Round {circle.round + 1} of {circle.members.length} · pot {usd0(circle.amount * circle.members.length)}</T>
              </View>
              <Stack3 people={circle.members.map(h => friend(h, s))} size={26} />
            </View>
            <View style={st.segs}>
              {circle.members.map((_, i) => <View key={i} style={[st.seg, { backgroundColor: i < circle.round ? C.violet : i === circle.round ? C.ink : C.track }]} />)}
            </View>
            <View style={st.circleFoot}>
              <View>
                <T s={12} c={C.sub}>This round goes to</T>
                <T s={14} w="s">{friend(circle.members[circle.round], s).name}</T>
              </View>
              {circle.paid[circle.members.indexOf(me)]
                ? <View style={[st.pill, { backgroundColor: C.mintDim }]}><Icon n="check" s={13} c={C.mint} /><T s={13} w="s" c={C.mint}>You paid</T></View>
                : <View style={[st.pill, { backgroundColor: C.amberDim }]}><T s={13} w="s" c={C.amber}>Pay {usd0(circle.amount)} · {daysLeft(circleDue(circle))}d</T></View>}
            </View>
          </Card>
        </>
      )}

      <Card onPress={() => router.push('/add')} style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flexDirection: 'row' }}>
          {CHAINS.map(([l, c], i) => (
            <View key={l} style={[st.chain, { backgroundColor: c, marginLeft: i ? -8 : 0 }]}><T s={10} w="b" c="#FFFFFF">{l}</T></View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <T s={15} w="s">Add from any chain</T>
          <T s={13} c={C.sub}>USDC lands here in about 20 s</T>
        </View>
        <Icon n="chevron-right" s={18} c={C.mute} />
      </Card>

      <SectionTitle title="Recent activity" action={s.txs.length > 5 ? 'See all' : undefined} onAction={() => router.push('/activity')} />
      <Card style={{ paddingVertical: 4 }}>
        {s.txs.length === 0
          ? <Row icon="clock" iconColor={C.mute} title="No activity yet" sub="Add money to get started" last />
          : s.txs.slice(0, 5).map((t, i, a) => <TxRow key={t.id} t={t} hide={s.hide} last={i === a.length - 1} />)}
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  hero: { marginTop: 20, borderRadius: 28, padding: 22, overflow: 'hidden', boxShadow: '0px 18px 40px rgba(17,17,19,0.22)' },
  usd: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center' },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  earnPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(94,224,168,0.12)', paddingHorizontal: 10, height: 28, borderRadius: 14 },
  heroFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28 },
  glyph: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 24, marginBottom: 22 },
  action: { alignItems: 'center', gap: 8, width: 72 },
  actionIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, padding: 16 },
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  pocket: { width: 168, borderRadius: 24, backgroundColor: C.card, overflow: 'hidden' },
  cover: { height: 92, padding: 14, justifyContent: 'space-between', flexDirection: 'row', alignItems: 'flex-start' },
  coverTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 8, height: 22, borderRadius: 11 },
  addPocket: { backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(14,16,24,0.15)', alignItems: 'center', justifyContent: 'center', gap: 10, width: 130 },
  segs: { flexDirection: 'row', gap: 5, marginTop: 16 },
  seg: { flex: 1, height: 5, borderRadius: 3 },
  circleFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 30, borderRadius: 15 },
  chain: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card },
});
