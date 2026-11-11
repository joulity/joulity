import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AmountView, Pad } from '@/components/pad';
import { Avatar, Button, Done, Fixed, Header, T } from '@/components/ui';
import { Soon } from '@/components/real';
import { FRIENDS, useStore } from '@/lib/store';
import { C, usd } from '@/lib/theme';

// a real account moves real money, which needs the gas relay first
export default function Send() {
  const { s } = useStore();
  return s.user?.real ? <Soon title="Send" /> : <DemoSend />;
}

function DemoSend() {
  const { s, send } = useStore();
  const [v, setV] = useState('');
  const [to, setTo] = useState(FRIENDS[0].handle);
  const [done, setDone] = useState(0);
  const n = Number(v || 0);
  const f = FRIENDS.find(x => x.handle === to)!;
  const over = n > s.balance;
  if (done) return <Done title={`${usd(done)} sent`} sub={`${f.name} (${f.handle}) received it instantly. No fee.`} onDone={() => router.replace('/home')} />;
  return (
    <Fixed>
      <Header title="Send" close />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginHorizontal: -20 }} contentContainerStyle={{ gap: 16, paddingHorizontal: 20 }}>
        {FRIENDS.map(x => (
          <Pressable key={x.handle} onPress={() => setTo(x.handle)} style={{ alignItems: 'center', gap: 6, opacity: x.handle === to ? 1 : 0.5 }}>
            <View style={{ borderWidth: 2, borderColor: x.handle === to ? C.mint : 'transparent', borderRadius: 30, padding: 2 }}>
              <Avatar name={x.name} color={x.color} size={50} />
            </View>
            <T s={12} w="m">{x.name}</T>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <AmountView v={v} note={`To ${f.handle} · available ${usd(s.balance)}`} error={over ? 'More than your account balance' : undefined} />
      </View>
      <Pad v={v} onChange={setV} />
      <Button label={n ? `Send ${usd(n)} to ${f.name}` : 'Enter an amount'} disabled={!n || over} onPress={() => { send(to, n); setDone(n); }} />
    </Fixed>
  );
}
