import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AmountView, Pad } from '@/components/pad';
import { Button, Chip, Done, Fixed, Header } from '@/components/ui';
import { T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { saveToPocket, takeFromPocket } from '@/lib/relay';
import { C } from '@/lib/theme';
import { myPut, useStore } from '@/lib/store';
import { usd } from '@/lib/theme';

export default function Move() {
  const { id, dir } = useLocalSearchParams<{ id: string; dir: 'in' | 'out' }>();
  const { s, movePocket } = useStore();
  const a = useAuth();
  const real = !!s.user?.real;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [v, setV] = useState('');
  const [done, setDone] = useState(0);
  const p = s.pockets.find(q => q.id === id);
  if (!p) return null;
  const isIn = dir !== 'out';
  const max = isIn ? (real ? (a.chain?.usdc ?? 0) : s.balance) : myPut(p, s.user!.handle);
  const n = Number(v || 0);
  const over = n > max + 1e-9;
  if (done) return <Done title={isIn ? `${usd(done)} saved` : `${usd(done)} taken out`} sub={isIn ? `${p.name} is closer to the goal. It keeps earning.` : 'The money is back in your account.'} onDone={() => router.replace('/home')} />;
  return (
    <Fixed>
      <Header title={isIn ? `Add to ${p.name}` : `Take from ${p.name}`} close />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <AmountView v={v} note={isIn ? `From your account · ${usd(max)} available` : `Your share · ${usd(max)}`} error={over ? (isIn ? 'More than your account balance' : 'You can take out only what you put in') : undefined} />
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
          {[25, 50, 100].map(x => <Chip key={x} label={`$${x}`} onPress={() => setV(String(x))} />)}
          <Chip label="Max" onPress={() => setV(String(Math.floor(max * 100) / 100))} />
        </View>
      </View>
      <Pad v={v} onChange={setV} />
      {err ? <T s={13} c={C.red} style={{ textAlign: 'center', marginBottom: 8 }}>{err}</T> : null}
      <Button label={busy ? 'Working on NEAR…' : n ? (isIn ? `Save ${usd(n)}` : `Take out ${usd(n)}`) : 'Enter an amount'} disabled={!n || over || busy}
        onPress={async () => {
          if (!real) { movePocket(p.id, n, isIn ? 'in' : 'out'); return setDone(n); }
          if (!p.chainId) return setErr('This pocket is not on NEAR.');
          setBusy(true); setErr('');
          try {
            if (isIn) await saveToPocket(a.nearId, p.chainId, n, a.sign); else await takeFromPocket(a.nearId, p.chainId, n, a.sign);
            movePocket(p.id, n, isIn ? 'in' : 'out'); a.refresh(); setDone(n);
          } catch (e) { setErr((e as Error).message); }
          setBusy(false);
        }} />
    </Fixed>
  );
}
