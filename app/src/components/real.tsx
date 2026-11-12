// Screens for a real (mainnet) account where the demo flow would move fake money
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, Chip, Field, Fixed, Header, Icon, Screen, T, back } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { NEAR_KEY, when, Quote, SOURCES, Source, Status, allSources, feeBps, quote, status, usdValue } from '@/lib/intents';
import { nearToUsdcDex } from '@/lib/relay';
import { dexQuote, usdcRaw } from '@/lib/dex';
import { EXPLORER } from '@/lib/near';
import { C, F, shadow, usd } from '@/lib/theme';

export function MainnetTag() {
  return <View style={s.tag}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.mint }} /><T s={11} w="s" c={C.mint}>NEAR MAINNET</T></View>;
}

const COPY = (t: string, set: (v: boolean) => void) => {
  navigator.clipboard?.writeText(t).then(() => { set(true); setTimeout(() => set(false), 1800); }).catch(() => {});
};

// Add money: 1) pick the coin, 2) pick the network it is on, 3) amount + confirm. Get USDC on NEAR through NEAR Intents
const BRAND: Record<string, string> = { NEAR: '#00C08B', USDC: '#2775CA', USDT: '#26A17B', ETH: '#627EEA', WETH: '#627EEA', BTC: '#F7931A', WBTC: '#F7931A', CBBTC: '#F7931A', SOL: '#9945FF', BNB: '#F0B90B', POL: '#8247E5', AVAX: '#E84142', TRX: '#EB0029', TON: '#0098EA', XRP: '#23292F', DOGE: '#C2A633', SUI: '#4DA2FF', ARB: '#2D374B', OP: '#FF0420', LTC: '#345D9D', ZEC: '#ECB244', DAI: '#F5AC37' };
const ORDER = ['USDC', 'USDT', 'NEAR', 'ETH', 'BTC', 'SOL', 'BNB', 'POL', 'AVAX', 'TRX', 'TON', 'XRP', 'DOGE', 'SUI', 'ARB', 'OP', 'ZEC', 'LTC', 'DAI'];
const CHAINS = ['NEAR', 'Base', 'Ethereum', 'Solana', 'Arbitrum', 'Tron', 'BNB Chain', 'Polygon', 'Optimism', 'Avalanche', 'Bitcoin', 'TON'];
const rank = (a: string[], v: string) => { const i = a.indexOf(v); return i < 0 ? 999 : i; };
const price = (p?: number) => (p ? (p >= 1 ? usd(p) : `$${p.toPrecision(3)}`) : '');

function Coin({ sym, size = 40 }: { sym: string; size?: number }) {
  const bg = BRAND[sym.toUpperCase()] ?? '#3A3F4B';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T s={Math.round(size * 0.3)} w="b" c="#FFFFFF">{sym.replace(/^W(?=BTC|ETH)/, '').slice(0, 4)}</T>
    </View>
  );
}
function ChainDot({ name }: { name: string }) {
  return (
    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
      <T s={13} w="b" c={C.sub}>{name.slice(0, 2).toUpperCase()}</T>
    </View>
  );
}
function Row({ left, title, sub, right, onPress, last }: { left: ReactNode; title: string; sub?: string; right?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 }, !last && { borderBottomWidth: 1, borderBottomColor: C.line }, pressed && { opacity: 0.6 }]}>
      {left}
      <View style={{ flex: 1 }}>
        <T s={16} w="s">{title}</T>
        {sub ? <T s={13} c={C.sub}>{sub}</T> : null}
      </View>
      {right ? <T s={14} w="m" c={C.sub}>{right}</T> : null}
      <Icon n="chevron-right" s={16} c={C.mute} />
    </Pressable>
  );
}

export function Deposit() {
  const a = useAuth();
  const [list, setList] = useState<Source[]>([]);
  const [q, setQ] = useState('');
  const [tok, setTok] = useState<string | null>(null);
  const [src, setSrc] = useState<Source | 'near' | null>(null);
  const [amount, setAmount] = useState('20');
  const [est, setEst] = useState<Quote | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ q: Quote; src: Source } | null>(null);
  const n = Number(amount.replace(',', '.'));
  const val = src && src !== 'near' ? usdValue(src, n) : 0;

  useEffect(() => { allSources().then(setList).catch(() => setList(SOURCES)); }, []);

  useEffect(() => {
    setEst(null); setErr('');
    if (!src || src === 'near' || src.key === NEAR_KEY || !a.nearId || !(val >= 1)) return;
    const t = setTimeout(() => { quote(src, n, a.nearId, true).then(setEst).catch(e => setErr(e.message)); }, 500);
    return () => clearTimeout(t);
  }, [src, n, val, a.nearId]);

  // coin -> its networks
  const groups = new Map<string, Source[]>();
  for (const x of list) { const s = x.token.toUpperCase(); groups.set(s, [...(groups.get(s) ?? []), x]); }
  groups.forEach(v => v.sort((x, y) => rank(CHAINS, x.chain) - rank(CHAINS, y.chain) || x.chain.localeCompare(y.chain)));
  const nets = (s: string) => groups.get(s) ?? [];
  const netCount = (s: string) => nets(s).length + (s === 'USDC' ? 1 : 0);   // + "already on NEAR"

  const go = async () => {
    if (!src || src === 'near') return;
    setBusy(true); setErr('');
    try { setOpen({ q: await quote(src, n, a.nearId, false), src }); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const pick = (x: Source) => { setSrc(x); setAmount(x.price && x.price > 2 ? String(+(20 / x.price).toPrecision(2)) : '20'); };
  const chooseTok = (s: string) => { setTok(s); setSrc(null); setQ(''); if (netCount(s) === 1) pick(nets(s)[0]); };

  if (open) return <SendTo q={open.q} src={open.src} onBack={() => setOpen(null)} />;

  // 2 + 3. network, then amount + confirm
  if (tok) {
    const ns = nets(tok);
    const p = ns.find(x => x.price)?.price;
    return (
      <Screen bottom={40}>
        <Header title="Add money" close />
        <T s={13} w="m" c={C.sub} style={{ marginBottom: 8 }}>Coin</T>
        <Card onPress={() => { setTok(null); setSrc(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Coin sym={tok} />
          <View style={{ flex: 1 }}><T s={16} w="s">{tok}</T>{p ? <T s={13} c={C.sub}>{price(p)}</T> : null}</View>
          <T s={14} w="s" c={C.sub}>Change</T>
        </Card>

        <T s={13} w="m" c={C.sub} style={{ marginTop: 18, marginBottom: 8 }}>Network</T>
        {src ? (
          <Card onPress={netCount(tok) > 1 ? () => setSrc(null) : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ChainDot name={src === 'near' ? 'NEAR' : src.chain} />
            <View style={{ flex: 1 }}><T s={16} w="s">{src === 'near' ? 'NEAR' : src.chain}</T><T s={13} c={C.sub}>{src === 'near' ? 'Already on NEAR · no fee' : `Fee ${feeBps(src) / 100}%`}</T></View>
            {netCount(tok) > 1 ? <T s={14} w="s" c={C.sub}>Change</T> : null}
          </Card>
        ) : (
          <>
            <T s={13} c={C.sub} style={{ marginBottom: 8 }}>{`Where is your ${tok}? Pick the network you send from.`}</T>
            <Card style={{ padding: 0 }}>
              {tok === 'USDC' ? <Row left={<ChainDot name="NEAR" />} title="NEAR" sub="Already on NEAR · no fee" onPress={() => setSrc('near')} last={!ns.length} /> : null}
              {ns.map((x, i) => <Row key={x.key} left={<ChainDot name={x.chain} />} title={x.chain} sub={`Fee ${feeBps(x) / 100}%`} onPress={() => pick(x)} last={i === ns.length - 1} />)}
            </Card>
          </>
        )}

        {src === 'near' ? <View style={{ marginTop: 16 }}><NearAddress /></View> : src && src.key === NEAR_KEY ? <NearSwap src={src} /> : src ? (
          <View style={{ gap: 14, marginTop: 18 }}>
            <Field label={`Amount (${tok})${src.price && src.price > 2 ? ' ≈ ' + usd(val) : ''}`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="20" />
            <Card style={{ gap: 6 }}>
              <T s={13} c={C.sub}>You get on NEAR</T>
              <T s={26} w="b">{est ? `${usd(est.amountOut)} USDC` : val >= 1 && !err ? '…' : '—'}</T>
              <T s={13} c={C.sub}>{est ? `About ${est.seconds} seconds · fee ${feeBps(src) / 100}%` : n > 0 && val < 1 ? 'Minimum $1' : ' '}</T>
            </Card>
            {err ? <T s={13} c={C.red}>{err}</T> : null}
            <Button label={busy ? 'Opening…' : 'Confirm · get deposit address'} icon="arrow-down-left" disabled={!est || busy} onPress={go} />
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
              <Icon n="shield" s={14} c={C.sub} />
              <T s={12} c={C.sub} style={{ flex: 1, lineHeight: 18 }}>{`Send only ${tok} on ${src.chain} to the address. If something goes wrong, the money comes back to you. Powered by NEAR Intents.`}</T>
            </View>
          </View>
        ) : null}
      </Screen>
    );
  }

  // 1. which coin?
  const k = q.trim().toLowerCase();
  const toks = [...groups.keys()]
    .filter(s => !k || s.toLowerCase().includes(k) || nets(s).some(x => x.chain.toLowerCase().includes(k)))
    .sort((x, y) => rank(ORDER, x) - rank(ORDER, y) || netCount(y) - netCount(x) || x.localeCompare(y));
  const shown = k ? toks.slice(0, 40) : toks.slice(0, 12);
  return (
    <Screen bottom={40}>
      <Header title="Add money" close />
      <T s={14} c={C.sub} style={{ marginBottom: 12 }}>Send any coin from any network or exchange. You get dollars (USDC).</T>
      <View style={dp.search}>
        <Icon n="search" s={18} c={C.mute} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search coin or network" placeholderTextColor={C.mute} style={dp.searchIn} autoCapitalize="none" autoCorrect={false} />
      </View>
      {!list.length ? <ActivityIndicator color={C.sub} style={{ marginTop: 30 }} /> : (
        <>
          <T s={13} w="m" c={C.sub} style={{ marginTop: 18, marginBottom: 8 }}>{k ? 'Results' : 'Choose a coin'}</T>
          <Card style={{ padding: 0 }}>
            {shown.length ? shown.map((s, i) => {
              const c = netCount(s);
              return <Row key={s} left={<Coin sym={s} />} title={s} sub={c === 1 ? `on ${nets(s)[0].chain}` : `${c} networks`} right={price(nets(s).find(x => x.price)?.price)} onPress={() => chooseTok(s)} last={i === shown.length - 1} />;
            }) : <T s={14} c={C.sub} style={{ padding: 16 }}>No coin found</T>}
          </Card>
          {!k ? <T s={12} c={C.mute} style={{ textAlign: 'center', marginTop: 14 }}>{`${groups.size} coins on ${new Set(list.map(x => x.chain)).size} networks · search to find more`}</T> : null}
        </>
      )}
    </Screen>
  );
}

const dp = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 16, paddingHorizontal: 14, height: 50, ...shadow },
  searchIn: { flex: 1, fontSize: 16, color: C.text, fontFamily: F.r, outlineStyle: 'none' } as any,
});

const STEPS: [string, Status[]][] = [
  ['Waiting for your deposit', ['PENDING_DEPOSIT']],
  ['Deposit received', ['KNOWN_DEPOSIT_TX']],
  ['Moving to NEAR', ['PROCESSING']],
  ['Arrived', ['SUCCESS']],
];

function SendTo({ q, src, onBack }: { q: Quote; src: Source; onBack: () => void }) {
  const a = useAuth();
  const [copied, setCopied] = useState(false);
  const [copiedAmt, setCopiedAmt] = useState(false);
  const [st, setSt] = useState<{ status: Status; out?: number; reason?: string }>({ status: 'PENDING_DEPOSIT' });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try { const r = await status(q.depositAddress); if (!stop) { setSt(r); if (r.status === 'SUCCESS') a.refresh(); } } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [q.depositAddress]);
  const done = st.status === 'SUCCESS';
  const bad = st.status === 'REFUNDED' || st.status === 'FAILED' || st.status === 'INCOMPLETE_DEPOSIT';
  const at = Math.max(0, STEPS.findIndex(([, k]) => k.includes(st.status)));
  return (
    <Screen bottom={40}>
      <Header title={`From ${src.chain}`} close />
      <Card style={{ gap: 12 }}>
        <T s={13} w="m" c={C.sub}>Send (exchange fees are fine: a bit less or more also works)</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T s={28} w="b">{q.amountIn} {src.token}</T>
          <Pressable onPress={() => COPY(q.amountIn, setCopiedAmt)} hitSlop={8}><T s={14} w="s" c={C.blue}>{copiedAmt ? 'Copied' : 'Copy'}</T></Pressable>
        </View>
        <T s={13} w="m" c={C.sub}>on {src.chain} to this address</T>
        <T s={15} w="s" selectable style={{ fontFamily: F.m, lineHeight: 22 }}>{q.depositAddress}</T>
        <Button label={copied ? 'Copied' : 'Copy address'} icon={copied ? 'check' : 'at-sign'} style={{ height: 48 }} onPress={() => COPY(q.depositAddress, setCopied)} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Icon n="info" s={14} c={C.amber} />
          <T s={12} c={C.amber} style={{ flex: 1, lineHeight: 18 }}>Only {src.token} on {src.chain}. This address is for this deposit only.</T>
        </View>
      </Card>

      <Card style={{ gap: 14, marginTop: 14 }}>
        {bad ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Icon n="corner-down-left" s={20} c={C.red} />
            <View style={{ flex: 1 }}>
              <T s={15} w="s">{st.status === 'INCOMPLETE_DEPOSIT' ? 'Amount too small' : 'Refunded'}</T>
              <T s={13} c={C.sub} style={{ lineHeight: 19 }}>{st.reason || 'The money goes back to your NEAR account inside NEAR Intents.'}</T>
            </View>
          </View>
        ) : STEPS.map(([label], i) => {
          const ok = done || i < at, now = !done && i === at;
          return (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[s.dot, { backgroundColor: ok ? C.mint : now ? C.ink : C.track }]}>
                {ok ? <Icon n="check" s={13} c="#FFFFFF" w="bold" /> : now ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              </View>
              <T s={15} w={now || ok ? 's' : 'r'} c={ok || now ? C.text : C.mute}>{label}{i === 3 && done && st.out ? ` · ${usd(st.out)} USDC` : ''}</T>
            </View>
          );
        })}
      </Card>
      <T s={12} c={C.mute} style={{ marginTop: 12, lineHeight: 18 }}>
        You get at least {usd(q.minOut)} USDC, usually {usd(q.amountOut)}. You can close this screen: the money still arrives.{q.expires ? ` If it cannot be swapped, it comes back by ${when(q.expires)}.` : ''}
      </T>
      <Button label={done ? 'Done' : 'Another chain'} kind={done ? 'primary' : 'dark'} style={{ marginTop: 16 }} onPress={done ? () => router.replace('/home') : onBack} />
    </Screen>
  );
}

// NEAR on NEAR -> USDC, same flow as the other networks: amount, then the address + steps.
// The NEAR lands in the user's own Joulity account; the app then changes it to USDC through NEAR Intents (one signature, gas ~0.01 NEAR paid in NEAR).
const NEAR_STEPS = ['Waiting for your NEAR', 'NEAR received', 'Changing to USDC', 'Arrived'];
const KEEP = 0.05; // stays in the account: gas (~0.003 used, 0.016 reserved) + account storage
function NearSwap({ src }: { src: Source }) {
  const a = useAuth();
  const have = a.chain?.near ?? 0;
  const [amount, setAmount] = useState('1');
  const n = Number(amount.replace(',', '.'));
  const [est, setEst] = useState<{ amountOut: number } | null>(null);
  const [err, setErr] = useState('');
  const [go, setGo] = useState<{ n: number; start: number } | null>(null);
  const [step, setStep] = useState(0);
  const [dep, setDep] = useState<string | null>(null);
  const [exp, setExp] = useState('');
  const [st, setSt] = useState<{ status: Status; out?: number; reason?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedAmt, setCopiedAmt] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    setEst(null); setErr('');
    if (go || !(n > 0) || usdValue(src, n) < 1) return;
    const t = setTimeout(() => { dexQuote(n).then(setEst).catch(e => setErr(e.message)); }, 500);
    return () => clearTimeout(t);
  }, [n, go]);

  // watch the account: when the NEAR is there, change it
  useEffect(() => {
    if (!go || dep) return;
    const t = setInterval(a.refresh, 5000);
    return () => clearInterval(t);
  }, [go, dep]);
  const need = go ? go.n + KEEP - 0.001 : 0;
  const arrived = !!go && have >= need;
  const change = async () => {
    if (!go || running.current) return;
    running.current = true; setErr(''); setStep(2);
    try {
      const amt = Math.min(go.n, Math.floor((have - KEEP) * 1e6) / 1e6);
      const q = await dexQuote(amt);
      const before = await usdcRaw(a.nearId);
      const r = await nearToUsdcDex(a.nearId, q.amountInRaw, q.msg, a.sign);
      if (!r.ok) throw new Error(r.error || 'Failed');
      let got = 0n;
      for (let i = 0; i < 6 && got <= 0n; i++) { got = (await usdcRaw(a.nearId)) - before; if (got <= 0n) await new Promise(res => setTimeout(res, 1500)); }
      if (got <= 0n) throw new Error('The price moved, nothing was swapped. Your NEAR is kept (as wNEAR). Try again.');
      setDep('dex'); setSt({ status: 'SUCCESS', out: Number(got) / 1e6 }); setStep(3); a.refresh();
    } catch (e) { setErr((e as Error).message); setStep(1); running.current = false; }
  };
  useEffect(() => { if (arrived && !dep && step === 0) { setStep(1); change(); } }, [arrived]);
  useEffect(() => {
    if (!dep || dep === 'dex') return;
    let stop = false;
    const tick = async () => { try { const r = await status(dep); if (!stop) { setSt(r); if (r.status === 'SUCCESS') { setStep(3); a.refresh(); } } } catch {} };
    tick(); const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [dep]);

  if (!go) return (
    <View style={{ gap: 14, marginTop: 18 }}>
      <Field label="Amount (NEAR)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="1" />
      <Card style={{ gap: 6 }}>
        <T s={13} c={C.sub}>You get on NEAR</T>
        <T s={26} w="b">{est ? `${usd(est.amountOut)} USDC` : n > 0 && usdValue(src, n) >= 1 && !err ? '…' : '—'}</T>
        <T s={13} c={C.sub}>{est ? `Instant on Rhea (NEAR's DEX) · gas ≈ 0.003 NEAR` : n > 0 && usdValue(src, n) < 1 ? 'Minimum $1' : ' '}</T>
      </Card>
      {err ? <T s={13} c={C.red}>{err}</T> : null}
      <Button label="Confirm · get deposit address" icon="arrow-down-left" disabled={!est} onPress={() => { setGo({ n, start: have }); setStep(0); }} />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
        <Icon n="shield" s={14} c={C.sub} />
        <T s={12} c={C.sub} style={{ flex: 1, lineHeight: 18 }}>Send only NEAR on NEAR. It lands in your own Joulity account, then changes to dollars on Rhea, in seconds.</T>
      </View>
    </View>
  );

  const done = st?.status === 'SUCCESS';
  const bad = st && ['REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'].includes(st.status);
  const at = done ? 4 : step;
  const short = Math.max(0, need - have);
  return (
    <View style={{ gap: 14, marginTop: 18 }}>
      {!arrived && !dep ? (
        <Card style={{ gap: 12 }}>
          <T s={13} w="m" c={C.sub}>Send</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T s={28} w="b">{+short.toFixed(4)} NEAR</T>
            <Pressable onPress={() => COPY(String(+short.toFixed(4)), setCopiedAmt)} hitSlop={8}><T s={14} w="s" c={C.blue}>{copiedAmt ? 'Copied' : 'Copy'}</T></Pressable>
          </View>
          <T s={13} w="m" c={C.sub}>on NEAR to this address</T>
          <T s={15} w="s" selectable style={{ fontFamily: F.m, lineHeight: 22 }}>{a.nearId}</T>
          <Button label={copied ? 'Copied' : 'Copy address'} icon={copied ? 'check' : 'at-sign'} style={{ height: 48 }} onPress={() => COPY(a.nearId, setCopied)} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Icon n="info" s={14} c={C.amber} />
            <T s={12} c={C.amber} style={{ flex: 1, lineHeight: 18 }}>{`Only NEAR on NEAR. Includes ${KEEP} NEAR that stays in your account.`}</T>
          </View>
        </Card>
      ) : null}
      <Card style={{ gap: 14 }}>
        {bad ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Icon n="corner-down-left" s={20} c={C.red} />
            <View style={{ flex: 1 }}>
              <T s={15} w="s">Refunded</T>
              <T s={13} c={C.sub} style={{ lineHeight: 19 }}>{st?.reason || 'The money goes back to your NEAR account inside NEAR Intents.'}</T>
            </View>
          </View>
        ) : NEAR_STEPS.map((label, i) => {
          const ok = i < at, now = !done && i === at;
          return (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[s.dot, { backgroundColor: ok ? C.mint : now ? C.ink : C.track }]}>
                {ok ? <Icon n="check" s={13} c="#FFFFFF" w="bold" /> : now ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
              </View>
              <T s={15} w={now || ok ? 's' : 'r'} c={ok || now ? C.text : C.mute}>{label}{i === 3 && done && st?.out ? ` · ${usd(st.out)} USDC` : ''}</T>
            </View>
          );
        })}
      </Card>
      {err ? <T s={13} c={C.red}>{err}</T> : null}
      {dep && !done && !bad && exp ? <T s={12} c={C.sub} style={{ lineHeight: 18, paddingHorizontal: 4 }}>{`Usually under a minute. You can close this screen. If it cannot be swapped, the money comes back to your NEAR Intents balance by ${when(exp)}.`}</T> : null}
      {err && arrived && !dep ? <Button label="Try again" onPress={change} /> : null}
      <Button label={done ? 'Done' : 'Back'} kind={done ? 'primary' : 'dark'} onPress={done ? () => router.replace('/home') : () => { setGo(null); setDep(null); setSt(null); setErr(''); running.current = false; }} />
    </View>
  );
}

function NearAddress() {
  const a = useAuth();
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ gap: 14, marginTop: 20 }}>
      <Card style={{ gap: 12 }}>
        <T s={13} w="m" c={C.sub}>Your NEAR account</T>
        <T s={15} w="s" selectable style={{ fontFamily: F.m, lineHeight: 22 }}>{a.nearId || '…'}</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={copied ? 'Copied' : 'Copy'} icon={copied ? 'check' : 'at-sign'} style={{ flex: 1, height: 46 }} onPress={() => COPY(a.nearId, setCopied)} />
          <Button label="Explorer" kind="dark" icon="arrow-up-right" style={{ flex: 1, height: 46 }} onPress={() => Linking.openURL(EXPLORER + a.nearId)} />
        </View>
      </Card>
      <T s={12} c={C.sub} style={{ lineHeight: 18, paddingHorizontal: 4 }}>
        Native USDC on NEAR only. It shows here in a few seconds.{a.chain ? `  Now: ${usd(a.chain.usdc)} USDC.` : ''}
      </T>
    </View>
  );
}

// sending and pockets on chain need the gas relay; until then say so instead of moving fake money
export function Soon({ title }: { title: string }) {
  return (
    <Fixed>
      <Header title={title} close />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <View style={s.big}><Icon n="clock" s={36} c={C.violet} w="duotone" /></View>
        <T s={22} w="b" center>Coming to mainnet</T>
        <T s={15} c={C.sub} center style={{ maxWidth: 300, lineHeight: 22 }}>
          This moves real money, so it waits for gasless NEAR transactions. Try it now in the demo.
        </T>
      </View>
      <Button label="Back" onPress={back} />
    </Fixed>
  );
}

const s = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.mintDim, paddingHorizontal: 10, height: 26, borderRadius: 13 },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  big: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.violetDim, alignItems: 'center', justifyContent: 'center' },
});
