import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { AmountView, Pad } from '@/components/pad';
import { Button, Chip, Done, Fixed, Header, Icon, T } from '@/components/ui';
import { Deposit } from '@/components/real';
import { useStore } from '@/lib/store';
import { C, usd } from '@/lib/theme';

const CHAINS = ['NEAR', 'Ethereum', 'Base', 'Arbitrum', 'Solana', 'Polygon'];

// a real account moves real money, which needs the gas relay first
export default function Add() {
  const { s } = useStore();
  return s.user?.real ? <Deposit /> : <DemoAdd />;
}

function DemoAdd() {
  const { addMoney } = useStore();
  const [v, setV] = useState('');
  const [chain, setChain] = useState('Base');
  const [done, setDone] = useState(0);
  const n = Number(v || 0);
  if (done) return <Done title={`${usd(done)} added`} sub={`USDC from ${chain} arrived in your account and started earning.`} onDone={() => router.replace('/home')} />;
  return (
    <Fixed>
      <Header title="Add money" close />
      <T s={13} w="m" c={C.sub}>From</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 8, marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
        {CHAINS.map(c => <Chip key={c} label={c} active={c === chain} onPress={() => setChain(c)} />)}
      </ScrollView>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <AmountView v={v} note={chain === 'NEAR' ? 'USDC on NEAR · instant' : `USDC on ${chain} → NEAR · about 20 s`} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 4 }}>
        <Icon n="shield" s={13} c={C.mute} />
        <T s={12} c={C.mute}>Cross-chain by NEAR Intents · no gas for you</T>
      </View>
      <Pad v={v} onChange={setV} />
      <Button label={n ? `Add ${usd(n)}` : 'Enter an amount'} disabled={!n} onPress={() => { addMoney(n, chain); setDone(n); }} />
    </Fixed>
  );
}
