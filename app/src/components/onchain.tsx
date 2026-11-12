// Real accounts: circles and shared goals live in joulity-social.near. Their money sits in the Joulity vault
// (jUSD, it earns) and every action is gasless (the user signs, the Joulity gas operator pays).
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Bar, Button, Card, Chip, Done, Field, Glyph, Header, Icon, Screen, SectionTitle, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { SOCIAL, createSocial, fundUsd, getCircle, getGoal, payShares, sharesFor, social, vaultPrice, viewJson } from '@/lib/relay';
import { Circle, Goal, Pocket, VoteKind, friend, useStore } from '@/lib/store';
import { C, DAY, G, dateShort, daysLeft, shadow, usd, usd0 } from '@/lib/theme';

const LINK = 'https://app.joulity.com/bank';
const units = (usd: number) => String(Math.round(usd * 1e6));

// ---------- chain → app ----------
export function circleFromChain(id: number, c: any, price: number, prev?: Circle): Circle {
  return {
    id: `n${id}`, chainId: id, name: c.name, emoji: prev?.emoji ?? 'handshake',
    amount: (Number(c.amount) / 1e6) * price, periodDays: c.period / 86400,
    members: c.members, round: c.round, paid: c.paid?.length ? c.paid : c.members.map(() => false), startedAt: c.started_at * 1000,
  };
}
export function goalFromChain(id: number, g: any, price: number, prev?: Goal): Goal {
  const total = Number(g.total) / 1e6, cash = Number(g.cash) / 1e6;
  const p = g.proposal;
  const kind: VoteKind | null = !p ? null : p.action === 'Release' ? 'release' : p.action === 'RefundAll' ? 'refund' : 'leave';
  return {
    id: `n${id}`, chainId: id, name: g.name, emoji: prev?.emoji ?? 'flag', target: Number(g.target) / 1e6,
    date: g.date * 1000, createdAt: g.created * 1000, color: prev?.color ?? id, organizer: g.organizer,
    yieldEarned: Math.max(0, cash * price - total),
    status: g.status === 'Open' ? 'open' : g.status === 'Released' ? 'released' : 'refunded',
    members: [...g.members.map((m: any) => ({ handle: m.account, put: Number(m.put) / 1e6, streak: m.streak })),
      ...(prev?.members ?? []).filter(m => !g.members.some((c: any) => c.account === m.handle)).map(m => ({ ...m, put: 0 }))],
    vote: p && kind ? { kind, by: p.by, who: p.action?.Leave?.account, ends: p.ends * 1000, yes: p.yes, no: p.no } : undefined,
  };
}

// ---------- small helpers ----------
function useRun(reload: () => Promise<void>) {
  const a = useAuth();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState<null | { title: string; sub: string }>(null);
  const run = async (label: string, f: () => Promise<unknown>, done?: { title: string; sub: string }) => {
    setBusy(label); setErr('');
    try { await f(); await reload(); a.refresh(); if (done) setOk(done); } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  return { busy, err, ok, setOk, run };
}

export function Invite({ path, what }: { path: string; what: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${LINK}/${path}`;
  const copy = async () => { try { await (navigator as any).clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  return (
    <Card style={{ marginTop: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon n="users" s={18} c={C.violet} />
        <T s={15} w="s" style={{ flex: 1 }}>{`Invite people to ${what}`}</T>
      </View>
      <T s={13} c={C.sub} selectable>{url}</T>
      <Button label={copied ? 'Link copied ✓' : 'Copy invite link'} kind="dark" onPress={copy} />
    </Card>
  );
}

function Busy({ busy, err }: { busy: string; err: string }) {
  if (!busy && !err) return null;
  return <T s={13} c={err ? C.red : C.sub} style={{ marginTop: 10, textAlign: 'center' }}>{err || `${busy} Confirm on your phone if asked. Gas is paid by Joulity.`}</T>;
}

const nameOf = (h: string, me: string, s: any) => (h === me ? 'You' : friend(h, s).name.length > 16 ? `${h.slice(0, 6)}…${h.slice(-4)}` : friend(h, s).name);
const PICK = ['handshake', 'family', 'house', 'briefcase', 'confetti', 'moon'];
const GOAL_PICK = ['airplane', 'confetti', 'gift', 'house', 'graduation', 'heart'];

function Glyphs({ list, v, set }: { list: string[]; v: string; set: (x: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {list.map(e => (
        <Pressable key={e} onPress={() => set(e)} style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: e === v ? C.ink : C.card, ...(e === v ? {} : shadow) }}>
          <Glyph v={e} s={22} c={e === v ? '#FFFFFF' : C.text} />
        </Pressable>
      ))}
    </View>
  );
}

// ================= circles =================
export function RealNewCircle() {
  const a = useAuth();
  const { saveReal } = useStore();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(PICK[0]);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState(30 * 86400);
  const [max, setMax] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = Number(amount.replace(',', '.')) || 0;
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const price = await vaultPrice();
      const id = await createSocial(a.nearId, 'create_circle', { name: name.trim(), amount: sharesFor(n, price).toString(), period, max_members: max }, a.sign);
      const c = await getCircle(id);
      saveReal('circles', circleFromChain(id, c, price, { emoji } as Circle));
      router.replace(`/circle/n${id}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <Screen bottom={40}>
      <Header title="New circle" close />
      <View style={{ gap: 20 }}>
        <Glyphs list={PICK} v={emoji} set={setEmoji} />
        <Field label="Name" value={name} onChangeText={setName} placeholder="Family circle" maxLength={32} />
        <Field label="Each member pays (USD)" value={amount} onChangeText={setAmount} placeholder="50" keyboardType="decimal-pad" />
        <View style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>Every</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Day" active={period === 86400} onPress={() => setPeriod(86400)} />
            <Chip label="Week" active={period === 7 * 86400} onPress={() => setPeriod(7 * 86400)} />
            <Chip label="Month" active={period === 30 * 86400} onPress={() => setPeriod(30 * 86400)} />
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>Up to how many members</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[2, 3, 5, 8, 12].map(m => <Chip key={m} label={String(m)} active={max === m} onPress={() => setMax(m)} />)}
          </View>
        </View>
        {n > 0 && (
          <Card style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><T s={12} c={C.mute}>Pot if full</T><T s={17} w="b">{usd0(n * max)}</T></View>
            <View style={{ flex: 1 }}><T s={12} c={C.mute}>You get it</T><T s={17} w="b" c={C.mint}>Round 1</T></View>
          </Card>
        )}
        <T s={13} c={C.sub} style={{ lineHeight: 19 }}>Next you get an invite link. Friends join with it, then you start the circle. The payout order is the join order.</T>
        {err ? <T s={13} c={C.red}>{err}</T> : null}
        <Button label={busy ? 'Creating on NEAR…' : 'Create circle'} disabled={!name.trim() || n <= 0 || busy} onPress={create} />
      </View>
    </Screen>
  );
}

export function RealCircle({ chainId }: { chainId: number }) {
  const a = useAuth();
  const { s, saveReal } = useStore();
  const prev = s.circles.find(q => q.chainId === chainId);
  const [c, setC] = useState<any>(undefined);
  const [price, setPrice] = useState(1);
  const load = useCallback(async () => {
    const [x, p] = await Promise.all([getCircle(chainId), vaultPrice()]);
    setC(x); setPrice(p);
    if (x && (prev || x.members.includes(a.nearId))) saveReal('circles', circleFromChain(chainId, x, p, prev));
  }, [chainId, a.nearId, prev?.emoji]);
  useEffect(() => { load().catch(() => setC(null)); const t = setInterval(() => load().catch(() => {}), 15000); return () => clearInterval(t); }, [load]);
  const { busy, err, ok, setOk, run } = useRun(load);

  if (c === undefined) return <Screen><Header title={prev?.name ?? 'Circle'} /><T c={C.sub}>Loading from NEAR…</T></Screen>;
  if (c === null) return <Screen><Header title="Circle" /><T c={C.sub}>This circle does not exist.</T></Screen>;
  if (ok) return <Done title={ok.title} sub={ok.sub} onDone={() => setOk(null)} />;

  const me = a.nearId;
  const cv = circleFromChain(chainId, c, price, prev);
  const mi = c.members.indexOf(me);
  const started = c.started_at > 0;
  const done = started && c.round >= c.members.length;
  const pot = cv.amount * c.members.length;
  const roundEnd = (c.started_at + (c.round + 1) * c.period) * 1000;
  const allPaid = started && c.paid.every(Boolean);
  const canPayout = started && !done && Number(c.pot) > 0 && (allPaid || Date.now() >= roundEnd);
  const have = (a.chain?.usdc ?? 0) + (a.chain?.jusd ?? 0) * price;
  const low = have < cv.amount;
  const every = c.period >= 28 * 86400 ? 'month' : c.period >= 7 * 86400 ? 'week' : 'day';

  return (
    <Screen bottom={60}>
      <Header title={c.name} />
      <View style={st.hero}>
        <LinearGradient colors={['#17153A', '#3F3AA8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={st.glyph}><Glyph v={cv.emoji} s={30} /></View>
        <T s={13} w="m" c="rgba(255,255,255,0.8)" style={{ marginTop: 10 }}>Pot each round</T>
        <T s={40} w="b" c="#FFFFFF">{usd(pot)}</T>
        <T s={14} c="rgba(255,255,255,0.8)">{`${usd(cv.amount)} × ${c.members.length} members · every ${every}`}</T>
        {started && !done && (
          <View style={st.progress}>
            {c.members.map((_: string, i: number) => <View key={i} style={[st.seg, { backgroundColor: i < c.round ? 'rgba(255,255,255,0.55)' : i === c.round ? '#FFFFFF' : 'rgba(255,255,255,0.18)' }]} />)}
          </View>
        )}
        <T s={13} w="s" c="#FFFFFF" style={{ marginTop: 12 }}>
          {!started ? `Waiting to start · ${c.members.length}/${c.max_members} joined` : done ? 'Circle completed. Everyone got their pot.' : `Round ${c.round + 1} of ${c.members.length} · ${c.paid.filter(Boolean).length}/${c.members.length} paid`}
        </T>
      </View>

      {!started && (
        <Card style={{ marginTop: 16, gap: 10 }}>
          {mi < 0 ? (
            c.members.length >= c.max_members ? <T s={15} c={C.sub}>This circle is full.</T> : (
              <>
                <T s={15} w="s">{`Join and pay ${usd(cv.amount)} every ${every}. You get the pot in round ${c.members.length + 1}.`}</T>
                <Button label={busy || 'Join circle'} disabled={!!busy} onPress={() => run('Joining…', () => social(me, 'join_circle', { id: chainId }, a.sign), { title: 'You joined', sub: `You are number ${c.members.length + 1} in ${c.name}. Payments start when the creator starts the circle.` })} />
              </>
            )
          ) : c.creator === me ? (
            <>
              <T s={15} w="s">{c.members.length < 2 ? 'Invite at least one person, then start.' : 'Everyone in? Start the circle. The order is fixed from here.'}</T>
              <Button label={busy || 'Start circle'} disabled={!!busy || c.members.length < 2} onPress={() => run('Starting…', () => social(me, 'start_circle', { id: chainId }, a.sign), { title: 'Circle started', sub: 'Round 1 is open. Everyone pays, then the pot goes to round 1.' })} />
            </>
          ) : <T s={15} c={C.sub}>You are in. Waiting for the creator to start.</T>}
        </Card>
      )}
      {!started && <Invite path={`circle/n${chainId}`} what="this circle" />}

      {started && !done && mi >= 0 && (
        <Card style={{ marginTop: 16 }}>
          {c.paid[mi] ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon n="check-circle" s={22} c={C.mint} />
              <T s={15} w="s">You paid this round</T>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
                <View><T s={12} c={C.mute}>Your payment</T><T s={20} w="b">{usd(cv.amount)}</T></View>
                <View style={{ alignItems: 'flex-end' }}><T s={12} c={C.mute}>Due</T><T s={20} w="b" c={C.amber}>{`${daysLeft(roundEnd)} days`}</T></View>
              </View>
              {low ? <Button label="Add money first" onPress={() => router.push('/add')} />
                : <Button label={busy || `Pay ${usd(cv.amount)}`} disabled={!!busy} onPress={() => run('Paying…', () => payShares(me, BigInt(c.amount), { circle: chainId }, a.sign), { title: 'Payment sent', sub: `Round ${c.round + 1} of ${c.name}. The pot goes to ${nameOf(c.members[c.round], me, s)} when everyone has paid.` })} />}
            </>
          )}
        </Card>
      )}
      {canPayout && (
        <Button label={busy || `Send the pot to ${nameOf(c.members[c.round], me, s)}`} kind="dark" style={{ marginTop: 12 }} disabled={!!busy}
          onPress={() => run('Paying out…', () => social(me, 'payout', { id: chainId }, a.sign), { title: 'Pot sent', sub: `${usd((Number(c.pot) / 1e6) * price)} went to ${nameOf(c.members[c.round], me, s)}. It keeps earning in their account.` })} />
      )}
      <Busy busy={busy} err={err} />

      <SectionTitle title={started ? 'Payout order' : 'Members (payout order)'} />
      <Card style={{ paddingVertical: 6 }}>
        {c.members.map((h: string, i: number) => {
          const got = started && i < c.round, now = started && i === c.round && !done;
          return (
            <View key={h} style={[st.row, i < c.members.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <T s={13} w="b" c={C.mute} style={{ width: 18 }}>{i + 1}</T>
              <Avatar name={nameOf(h, me, s)} color={h === me ? '#111113' : '#9AA0B4'} size={38} />
              <View style={{ flex: 1 }}>
                <T s={15} w="s">{nameOf(h, me, s)}</T>
                <T s={12} c={C.sub}>{started ? dateShort((c.started_at + (i + 1) * c.period) * 1000) : 'Joined'}{c.missed?.[i] ? ` · missed ${c.missed[i]}` : ''}</T>
              </View>
              {got ? <T s={13} w="s" c={C.violet}>Received</T> : now ? <View style={st.now}><T s={12} w="s" c={C.mint}>This round</T></View> : <T s={13} c={C.mute}>{started ? 'Upcoming' : ''}</T>}
              {now && <Icon n={c.paid[i] ? 'check' : 'clock'} s={14} c={c.paid[i] ? C.mint : C.amber} />}
            </View>
          );
        })}
      </Card>
      <T s={12} c={C.mute} style={{ marginTop: 12, lineHeight: 18 }}>
        Circle #{chainId} on joulity-social.near. While the pot waits, it earns in the Joulity vault. If someone does not pay before the round ends, the pot still goes out and the missed payment stays on their record.
      </T>
    </Screen>
  );
}

// ================= shared goals =================
export function RealNewGoal() {
  const a = useAuth();
  const { saveReal } = useStore();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(GOAL_PICK[0]);
  const [target, setTarget] = useState('');
  const [months, setMonths] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = Number(target.replace(',', '.')) || 0;
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const date = Math.floor((Date.now() + months * 30 * DAY) / 1000);
      const id = await createSocial(a.nearId, 'create_goal', { name: name.trim(), target: units(t), date }, a.sign);
      let g = await getGoal(id);
      for (let i = 0; !g && i < 15; i++) { await new Promise(r => setTimeout(r, 1000)); g = await getGoal(id); }
      if (!g) throw new Error('Goal created; NEAR is slow to show it. Open Home in a few seconds.');
      const price = await vaultPrice();
      saveReal('goals', goalFromChain(id, g, price, { emoji, color: Date.now() % 7 } as Goal));
      router.replace(`/goal/n${id}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <Screen bottom={40}>
      <Header title="New shared goal" close />
      <View style={{ gap: 20 }}>
        <Glyphs list={GOAL_PICK} v={emoji} set={setEmoji} />
        <Field label="What for" value={name} onChangeText={setName} placeholder="Trip to Istanbul" maxLength={40} />
        <Field label="Goal (USD)" value={target} onChangeText={setTarget} placeholder="1500" keyboardType="decimal-pad" />
        <View style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>When</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[1, 3, 6, 12].map(m => <Chip key={m} label={m === 12 ? '1 year' : `${m} month${m > 1 ? 's' : ''}`} active={months === m} onPress={() => setMonths(m)} />)}
          </View>
        </View>
        <T s={13} c={C.sub} style={{ lineHeight: 19 }}>Next you get an invite link. Money waits in escrow on NEAR and earns. Nobody can take it alone: 75% of the money must vote to release it to you, more than half to refund everyone.</T>
        {err ? <T s={13} c={C.red}>{err}</T> : null}
        <Button label={busy ? 'Creating on NEAR…' : 'Create goal'} disabled={!name.trim() || t <= 0 || busy} onPress={create} />
      </View>
    </Screen>
  );
}

const VOTE_TITLE: Record<VoteKind, string> = { release: 'Release the money to the organiser', refund: 'Refund everyone now', leave: 'Let a member leave with their part' };

export function RealGoal({ chainId }: { chainId: number }) {
  const a = useAuth();
  const { s, saveReal } = useStore();
  const prev = (s.goals ?? []).find(q => q.chainId === chainId);
  const [g, setG] = useState<any>(undefined);
  const [price, setPrice] = useState(1);
  const [amt, setAmt] = useState('10');
  const load = useCallback(async () => {
    const [x, p] = await Promise.all([getGoal(chainId), vaultPrice()]);
    setG(x); setPrice(p);
    if (x && (prev || x.members.some((m: any) => m.account === a.nearId))) saveReal('goals', goalFromChain(chainId, x, p, prev));
  }, [chainId, a.nearId, prev?.emoji]);
  useEffect(() => { load().catch(() => setG(null)); const t = setInterval(() => load().catch(() => {}), 15000); return () => clearInterval(t); }, [load]);
  const { busy, err, ok, setOk, run } = useRun(load);

  if (g === undefined) return <Screen><Header title={prev?.name ?? 'Shared goal'} /><T c={C.sub}>Loading from NEAR…</T></Screen>;
  if (g === null) return <Screen><Header title="Shared goal" /><T c={C.sub}>This goal does not exist.</T></Screen>;
  if (ok) return <Done title={ok.title} sub={ok.sub} onDone={() => setOk(null)} />;

  const me = a.nearId;
  const gv = goalFromChain(chainId, g, price, prev);
  const pot = (Number(g.cash) / 1e6) * price;
  const target = Number(g.target) / 1e6;
  const total = Number(g.total);
  const mine = g.members.find((m: any) => m.account === me);
  const myPut = mine ? Number(mine.put) / 1e6 : 0;
  const voter = myPut >= 1;
  const open = g.status === 'Open';
  const v = gv.vote;
  const share = (list: string[]) => (total ? list.reduce((x, h) => x + Number(g.members.find((m: any) => m.account === h)?.put ?? 0), 0) / total : 0);
  const n = Number(amt.replace(',', '.')) || 0;
  const have = a.chain?.usdc ?? 0;
  const refunding = g.status === 'Refunding' || (open && Date.now() >= (g.date + 30 * 86400) * 1000);
  const joined = !!mine || !!prev?.members.some(m => m.handle === me);
  const shown = joined && !mine ? [...g.members, { account: me, put: '0', streak: 0 }] : g.members;

  return (
    <Screen bottom={60}>
      <Header title={g.name} />
      <View style={st.hero}>
        <LinearGradient colors={G[gv.color % G.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={st.glyph}><Glyph v={gv.emoji} s={30} /></View>
        <T s={40} w="b" c="#FFFFFF" style={{ marginTop: 10 }}>{usd(pot)}</T>
        <T s={14} c="rgba(255,255,255,0.85)">{`of ${usd0(target)} · ${open ? `${daysLeft(g.date * 1000)} days to ${dateShort(g.date * 1000)}` : g.status === 'Released' ? 'released' : 'refunding'}`}</T>
        <View style={{ width: '100%', marginTop: 14 }}><Bar p={target ? pot / target : 0} colors={['#FFFFFF', '#CFEFE3']} h={8} /></View>
        <View style={st.pills}>
          <View style={st.pill}><Icon n="lock" s={13} c="#FFFFFF" /><T s={12} w="s" c="#FFFFFF">Escrow on NEAR</T></View>
          <View style={st.pill}><Icon n="trending-up" s={13} c="#FFFFFF" /><T s={12} w="s" c="#FFFFFF">{`Earning in the vault`}</T></View>
        </View>
      </View>

      {open && !refunding && !joined && <JoinRules kind="goal" name={g.name} onJoin={() => { saveReal('goals', { ...gv, members: [...gv.members.filter(m => m.handle !== me), { handle: me, put: 0, streak: 0 }] }); }} />}

      {open && !refunding && joined && (
        <Card style={{ marginTop: 16, gap: 12 }}>
          <T s={15} w="s">{mine ? `You put ${usd(myPut)}` : 'You joined · add money whenever you want'}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[5, 10, 25, 50].map(x => <Chip key={x} label={usd0(x)} active={n === x} onPress={() => setAmt(String(x))} />)}
          </View>
          <Field label={`Amount (you have ${usd(have)})`} value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder="10" />
          {n > have ? <Button label="Add money first" onPress={() => router.push('/add')} />
            : <Button label={busy || `Put ${usd(n)} in`} disabled={!!busy || n < 1} onPress={() => run('Putting money in…', () => fundUsd(me, n, { goal: chainId }, a.sign), { title: `${usd(n)} added`, sub: `Locked in escrow for ${g.name}. It earns until the group decides.` })} />}
        </Card>
      )}

      {open && !refunding && (
        <>
          <SectionTitle title="Group vote" />
          <Card style={{ gap: 12 }}>
            {v ? (
              <>
                <T s={15} w="s">{VOTE_TITLE[v.kind]}</T>
                <T s={13} c={C.sub}>{`Yes ${Math.round(share(v.yes) * 100)}% · No ${Math.round(share(v.no) * 100)}% · needs ${v.kind === 'release' ? '75%' : 'more than 50%'} · ends ${dateShort(v.ends)}`}</T>
                <Bar p={share(v.yes)} colors={[C.mint, '#1E8F6C']} h={6} />
                {voter ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Button label="Yes" icon="thumbs-up" style={{ flex: 1 }} disabled={!!busy} onPress={() => run('Voting…', () => social(me, 'vote', { id: chainId, yes: true }, a.sign))} />
                    <Button label="No" icon="thumbs-down" kind="dark" style={{ flex: 1 }} disabled={!!busy} onPress={() => run('Voting…', () => social(me, 'vote', { id: chainId, yes: false }, a.sign))} />
                  </View>
                ) : <T s={13} c={C.mute}>Put at least $1 in to vote.</T>}
              </>
            ) : voter ? (
              <>
                <T s={13} c={C.sub}>Nobody can take the money alone. Ask the group:</T>
                <Button label={`Release to ${g.organizer === me ? 'me (organiser)' : 'the organiser'}`} icon="gift" disabled={!!busy} onPress={() => run('Opening the vote…', () => social(me, 'propose', { id: chainId, action: 'Release' }, a.sign))} />
                <Button label="Refund everyone" icon="corner-down-left" kind="dark" disabled={!!busy} onPress={() => run('Opening the vote…', () => social(me, 'propose', { id: chainId, action: 'RefundAll' }, a.sign))} />
              </>
            ) : <T s={13} c={C.mute}>Put at least $1 in to open or join a vote.</T>}
          </Card>
        </>
      )}

      {refunding && mine && Number(mine.put) > 0 && (
        <Button label={busy || 'Take my part back (money + yield)'} style={{ marginTop: 16 }} disabled={!!busy} onPress={() => run('Taking your part…', () => social(me, 'claim_refund', { id: chainId }, a.sign), { title: 'Refunded', sub: 'Your money and its yield are back in your account.' })} />
      )}
      <Busy busy={busy} err={err} />
      {open && <Invite path={`goal/n${chainId}`} what="this goal" />}

      <SectionTitle title={`Members · ${shown.length}`} />
      <Card style={{ paddingVertical: 8 }}>
        {[...shown].sort((x: any, y: any) => Number(y.put) - Number(x.put)).map((m: any, i: number, arr: any[]) => (
          <View key={m.account} style={[st.row, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
            <Avatar name={nameOf(m.account, me, s)} color={m.account === me ? '#111113' : '#9AA0B4'} size={38} />
            <View style={{ flex: 1 }}>
              <T s={15} w="s">{nameOf(m.account, me, s)}{m.account === g.organizer ? ' · organiser' : ''}</T>
              <T s={12} c={C.sub}>{m.streak > 1 ? `${m.streak} months in a row 🔥` : m.streak === 1 ? 'Saving this month' : 'Not yet'}</T>
            </View>
            <T s={15} w="s">{usd((Number(m.put) / 1e6) * price)}</T>
          </View>
        ))}
      </Card>
      <T s={12} c={C.mute} style={{ marginTop: 12, lineHeight: 18 }}>Goal #{chainId} on joulity-social.near. If nothing is released 30 days after the date, everyone can take their part back.</T>
    </Screen>
  );
}

// ================= join without a first deposit =================
const RULES: Record<'goal' | 'pocket', string[]> = {
  goal: [
    'The money is locked for this goal and earns in the Joulity vault until the group decides.',
    'Nobody can take the money alone. Paying it out to the organiser needs 75% yes, weighted by the money each member put in.',
    'Leaving early with your part, or refunding everyone, needs more than 50% yes.',
    'If nothing is paid out 30 days after the goal date, everyone can take back their part plus its yield.',
    'Everything runs on NEAR (joulity-social.near). Every move is public.',
  ],
  pocket: [
    'You can take back your own share at any time. Nobody else can touch it.',
    'The money earns in the Joulity vault while it waits.',
    'Everything runs on NEAR (joulity-social.near). Every move is public.',
  ],
};
export function JoinRules({ kind, name, onJoin }: { kind: 'goal' | 'pocket'; name: string; onJoin: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <Card style={{ marginTop: 16, gap: 12 }}>
      <T s={17} w="b">{`Join ${name}`}</T>
      <T s={13} c={C.sub}>{kind === 'goal' ? 'Locked goal. Read the rules before you join:' : 'Free pocket. How it works:'}</T>
      {RULES[kind].map((r, i) => <T key={i} s={14} c={C.text}>{`${i + 1}. ${r}`}</T>)}
      <Pressable onPress={() => setOk(!ok)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
        <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: ok ? C.mint : C.mute, backgroundColor: ok ? C.mint : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{ok ? <Icon n="check" s={14} c="#FFFFFF" /> : null}</View>
        <T s={14} w="s">I accept the rules</T>
      </Pressable>
      <Button label="Join the group" disabled={!ok} onPress={onJoin} />
      <T s={12} c={C.mute}>Joining is free. You add money later, whenever you want.</T>
    </Card>
  );
}

// a free pocket opened from an invite link
export function RealPocketJoin({ chainId }: { chainId: number }) {
  const a = useAuth();
  const { s, saveReal } = useStore();
  const [p, setP] = useState<any>(undefined);
  const [price, setPrice] = useState(1);
  useEffect(() => { Promise.all([viewJson(SOCIAL, 'get_pocket', { id: chainId }), vaultPrice()]).then(([x, pr]) => { setP(x); setPrice(pr); }).catch(() => setP(null)); }, [chainId]);
  if (p === undefined) return <Screen><Header title="Pocket" /><T c={C.sub}>Loading from NEAR…</T></Screen>;
  if (p === null) return <Screen><Header title="Pocket" /><T c={C.sub}>This pocket does not exist.</T></Screen>;
  const me = a.nearId;
  const tot = p.members.reduce((x: number, m: any) => x + Number(m.balance), 0) / 1e6 * price;
  const join = () => {
    const item: Pocket = { id: `n${chainId}`, chainId, name: p.name, emoji: 'target', target: Number(p.target) / 1e6, deadline: p.deadline > 1e12 ? p.deadline : p.deadline * 1000, color: (s.pockets ?? []).length, createdAt: Date.now(),
      members: [...p.members.map((m: any) => ({ handle: m.account, put: Number(m.balance) / 1e6 * price })), ...(p.members.some((m: any) => m.account === me) ? [] : [{ handle: me, put: 0 }])] };
    (saveReal as any)('pockets', item);
    router.replace(`/pocket/n${chainId}`);
  };
  return (
    <Screen bottom={60}>
      <Header title={p.name} />
      <Card style={{ gap: 6 }}>
        <T s={13} c={C.sub}>{`Free pocket · ${p.members.length} member${p.members.length === 1 ? '' : 's'}`}</T>
        <T s={32} w="b">{usd(tot)}</T>
        <T s={13} c={C.sub}>{`of ${usd0(Number(p.target) / 1e6)} goal`}</T>
      </Card>
      <JoinRules kind="pocket" name={p.name} onJoin={join} />
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
  pills: { flexDirection: 'row', gap: 8, marginTop: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, height: 28, borderRadius: 14 },
});
