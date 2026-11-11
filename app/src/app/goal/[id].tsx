import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Bar, Button, Card, Chip, Done, Glyph, Header, Icon, Ring, Screen, SectionTitle, T } from '@/components/ui';
import { MILESTONES, VOTE_NEED, VoteKind, friend, goalPot, goalTotal, monthlyEach, useStore, voteShare } from '@/lib/store';
import { C, G, dateShort, daysLeft, usd, usd0 } from '@/lib/theme';

const KIND: Record<VoteKind, { title: string; need: string; icon: any }> = {
  release: { title: 'Release the money to the organiser', need: '75% needed', icon: 'gift' },
  refund: { title: 'Refund everyone now', need: 'more than 50% needed', icon: 'corner-down-left' },
  leave: { title: 'Let a member leave with their part', need: 'more than 50% needed', icon: 'sign-out' },
};
const BADGES = ['Started', 'Halfway', 'Almost', 'Goal!'];

import { RealGoal } from '@/components/onchain';

export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s } = useStore();
  if (!s.user) return <SignInFirst />;
  if (s.user?.real && /^n\d+$/.test(id ?? '')) return <RealGoal chainId={Number(id!.slice(1))} />;
  return <GoalScreen />;
}

function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, putGoal, proposeGoal, voteGoal } = useStore();
  const [amt, setAmt] = useState<number | null>(null);
  const [nudged, setNudged] = useState<string[]>([]);
  const [result, setResult] = useState<null | { title: string; sub: string }>(null);
  const g = (s.goals ?? []).find(q => q.id === id);
  if (!g) return <Screen><Header title="Shared goal" /><T c={C.sub}>This goal does not exist.</T></Screen>;
  if (result) return <Done title={result.title} sub={result.sub} onDone={() => setResult(null)} />;

  const me = s.user!.handle;
  const pot = goalPot(g), total = goalTotal(g);
  const p = pot / g.target;
  const plan = monthlyEach(g);
  const mine = g.members.find(m => m.handle === me);
  const open = g.status === 'open';
  const org = friend(g.organizer, s).name;
  const options = [Math.ceil(plan), 25, 50, 100].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  const pick = amt ?? options[0];
  const low = s.balance < pick;
  const ranked = [...g.members].sort((a, b) => b.put - a.put);

  const put = () => {
    putGoal(g.id, pick);
    const before = pot / g.target, after = (pot + pick) / g.target;
    const hit = MILESTONES.findIndex(m => before < m && after >= m);
    setAmt(null);
    setResult(hit >= 0
      ? { title: `${BADGES[hit]} 🎉`, sub: `The group reached ${Math.round(MILESTONES[hit] * 100)}% of ${g.name}. Your ${usd0(pick)} is locked in escrow on NEAR.` }
      : { title: `${usd0(pick)} added`, sub: `Locked in escrow for ${g.name}. It earns yield until the group decides.` });
  };
  const vote = (yes: boolean, who?: string) => {
    const kind = g.vote!.kind;
    if (voteGoal(g.id, yes, who) === 'passed') {
      setResult(kind === 'release'
        ? { title: 'Released!', sub: `75% voted yes. ${usd0(pot)} went to ${org} for ${g.name}.` }
        : kind === 'refund'
          ? { title: 'Refunded', sub: 'The majority voted yes. Everyone got back their money plus its share of the yield.' }
          : { title: 'Member left', sub: 'The majority voted yes. They got back their money plus its yield; the goal goes on.' });
    }
  };

  return (
    <Screen bottom={60}>
      <Header title={g.name} />
      <View style={st.hero}>
        <LinearGradient colors={G[g.color % G.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ring p={p} size={116} stroke={9} colors={['#FFFFFF', '#CFEFE3']}>
          <Glyph v={g.emoji} s={34} />
          <T s={14} w="b" c="#FFFFFF" style={{ marginTop: 2 }}>{Math.min(100, Math.round(p * 100))}%</T>
        </Ring>
        <T s={40} w="b" c="#FFFFFF" style={{ marginTop: 12 }}>{usd0(pot)}</T>
        <T s={14} c="rgba(255,255,255,0.85)">of {usd0(g.target)} · {open ? `${daysLeft(g.date)} days to ${dateShort(g.date)}` : g.status === 'released' ? 'released' : 'refunded'}</T>
        <View style={st.pills}>
          <View style={st.pill}><Icon n="lock" s={13} c="#FFFFFF" /><T s={12} w="s" c="#FFFFFF">Escrow on NEAR</T></View>
          <View style={st.pill}><Icon n="trending-up" s={13} c="#FFFFFF" /><T s={12} w="s" c="#FFFFFF">+{usd(g.yieldEarned)} yield</T></View>
        </View>
      </View>

      <View style={st.badges}>
        {MILESTONES.map((m, i) => {
          const on = p >= m;
          return (
            <View key={m} style={[st.badge, on && { backgroundColor: C.mintDim, borderColor: C.mint }]}>
              <Icon n={i === 3 ? 'trophy' : 'flag'} s={18} c={on ? C.mint : C.mute} w={on ? 'fill' : 'regular'} />
              <T s={11} w="s" c={on ? C.mint : C.mute}>{BADGES[i]}</T>
            </View>
          );
        })}
      </View>

      {open && !g.vote && (
        <Card style={{ marginTop: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View><T s={12} c={C.mute}>Plan for everyone</T><T s={20} w="b">{usd(plan)}/month</T></View>
            <View style={{ alignItems: 'flex-end' }}>
              <T s={12} c={C.mute}>Your streak</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon n="fire" s={18} c={C.amber} w="fill" /><T s={20} w="b" c={C.amber}>{mine?.streak ?? 0} mo</T>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {options.map((v, i) => <Chip key={v} label={i === 0 ? `${usd0(v)} plan` : usd0(v)} active={v === pick} onPress={() => setAmt(v)} />)}
          </View>
          <Button label={low ? 'Add money first' : `Put ${usd0(pick)} in`} disabled={low} onPress={put} />
          {low && <T s={13} c={C.red} center>Your account has {usd(s.balance)}.</T>}
        </Card>
      )}

      {open && g.vote && (() => {
        const v = g.vote!;
        const yes = voteShare(g, v.yes), no = voteShare(g, v.no);
        const iVoted = v.yes.includes(me) ? 'yes' : v.no.includes(me) ? 'no' : null;
        const k = KIND[v.kind];
        return (
          <Card style={{ marginTop: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[st.ic, { backgroundColor: C.violetDim }]}><Icon n={k.icon} s={18} c={C.violet} /></View>
              <View style={{ flex: 1 }}>
                <T s={15} w="s">{v.kind === 'leave' ? `Let ${friend(v.who!, s).name} leave with their part` : k.title}</T>
                <T s={12} c={C.sub}>Asked by {friend(v.by, s).name} · {k.need} · ends {dateShort(v.ends)}</T>
              </View>
            </View>
            <View>
              <Bar p={yes} colors={[C.mint, '#1E8F6C']} h={10} />
              <View style={[st.mark, { left: `${VOTE_NEED[v.kind] * 100}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T s={13} w="s" c={C.mint}>Yes {Math.round(yes * 100)}%</T>
              <T s={13} w="s" c={C.red}>No {Math.round(no * 100)}%</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label={iVoted === 'yes' ? 'Voted yes' : 'Yes'} icon="thumbs-up" style={{ flex: 1, height: 48 }} disabled={iVoted === 'yes' || !mine?.put} onPress={() => vote(true)} />
              <Button label={iVoted === 'no' ? 'Voted no' : 'No'} kind="dark" icon="thumbs-down" style={{ flex: 1, height: 48 }} disabled={iVoted === 'no' || !mine?.put} onPress={() => vote(false)} />
            </View>
            <T s={12} c={C.mute} style={{ lineHeight: 17 }}>Votes count by money put in: 1 USDC = 1 vote. Demo: tap a friend below to vote for them.</T>
          </Card>
        );
      })()}

      <SectionTitle title="Members" />
      <Card style={{ paddingVertical: 6 }}>
        {ranked.map((m, i) => {
          const f = friend(m.handle, s);
          const share = total ? m.put / total : 0;
          const behind = open && m.handle !== me && m.streak < (mine?.streak ?? 0);
          const v = g.vote;
          const said = v ? (v.yes.includes(m.handle) ? 'yes' : v.no.includes(m.handle) ? 'no' : null) : null;
          const canPlay = open && !!v && m.handle !== me && m.put > 0;
          return (
            <Pressable key={m.handle} disabled={!canPlay} onPress={() => vote(said !== 'yes', m.handle)}
              style={[st.row, i < ranked.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <T s={13} w="b" c={i === 0 ? C.amber : C.mute} style={{ width: 18 }}>{i + 1}</T>
              <Avatar name={f.name} color={f.color} size={38} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T s={15} w="s">{f.name}</T>
                  {m.handle === g.organizer && <View style={st.org}><T s={10} w="s" c={C.blue}>ORGANISER</T></View>}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <T s={12} c={C.sub}>{usd0(m.put)} · {Math.round(share * 100)}% of votes</T>
                  {m.streak > 1 && <><Icon n="fire" s={12} c={C.amber} w="fill" /><T s={12} w="s" c={C.amber}>{m.streak}</T></>}
                </View>
              </View>
              {v ? (
                <T s={13} w="s" c={said === 'yes' ? C.mint : said === 'no' ? C.red : C.mute}>{said === 'yes' ? 'Yes' : said === 'no' ? 'No' : 'Waiting'}</T>
              ) : behind ? (
                <Pressable onPress={() => setNudged([...nudged, m.handle])} disabled={nudged.includes(m.handle)} style={st.nudge} hitSlop={6}>
                  <Icon n={nudged.includes(m.handle) ? 'check' : 'wave'} s={14} c={C.violet} />
                  <T s={12} w="s" c={C.violet}>{nudged.includes(m.handle) ? 'Nudged' : 'Nudge'}</T>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </Card>

      {open && !g.vote && (mine?.put ?? 0) > 0 && (
        <>
          <SectionTitle title="Decide together" />
          <Card style={{ paddingVertical: 4 }}>
            {(['release', 'refund', 'leave'] as VoteKind[]).map((k, i) => (
              <Pressable key={k} onPress={() => proposeGoal(g.id, k, k === 'leave' ? me : undefined)} style={[st.row, i < 2 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                <View style={[st.ic, { backgroundColor: C.card2 }]}><Icon n={KIND[k].icon} s={18} /></View>
                <View style={{ flex: 1 }}>
                  <T s={15} w="s">{k === 'release' ? `Release to ${org}` : k === 'refund' ? 'Refund everyone now' : 'I need to leave'}</T>
                  <T s={12} c={C.sub}>Start a vote · {KIND[k].need}</T>
                </View>
                <Icon n="chevron-right" s={18} c={C.mute} />
              </Pressable>
            ))}
          </Card>
        </>
      )}
      <T s={12} c={C.mute} style={{ marginTop: 12, lineHeight: 18 }}>
        Nobody can take the money alone, not even Joulity. If it is not released 30 days after the date, everyone gets back their money plus yield.
      </T>
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, padding: 22, alignItems: 'center', overflow: 'hidden' },
  pills: { flexDirection: 'row', gap: 8, marginTop: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 10, height: 28, borderRadius: 14 },
  badges: { flexDirection: 'row', gap: 8, marginTop: 14 },
  badge: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  ic: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mark: { position: 'absolute', top: -4, width: 2, height: 18, backgroundColor: C.ink, borderRadius: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  org: { backgroundColor: C.blueDim, paddingHorizontal: 6, height: 18, borderRadius: 9, justifyContent: 'center' },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.violetDim, paddingHorizontal: 10, height: 28, borderRadius: 14 },
});

function SignInFirst() {
  try { if (typeof window !== 'undefined') window.localStorage.setItem('joulity.invite', window.location.pathname.replace(/^\/bank/, '')); } catch {}
  return <Redirect href="/welcome" />;
}
