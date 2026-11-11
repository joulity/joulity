import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Button, Glyph, Card, Chip, Field, Header, Screen, T } from '@/components/ui';
import { RealNewCircle } from '@/components/onchain';
import { FRIENDS, uid, useStore } from '@/lib/store';
import { C, usd0, shadow } from '@/lib/theme';

const EMOJI = ['handshake', 'family', 'house', 'briefcase', 'confetti', 'moon'];

// a real account moves real money, which needs the gas relay first
export default function NewCircle() {
  const { s } = useStore();
  return s.user?.real ? <RealNewCircle /> : <DemoNewCircle />;
}

function DemoNewCircle() {
  const { createCircle } = useStore();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState(30);
  const [friends, setFriends] = useState<string[]>([]);
  const a = Number(amount.replace(/[^0-9.]/g, ''));
  const n = friends.length + 1;
  const ok = name.trim() && a > 0 && friends.length >= 1;
  const create = () => {
    const id = uid();
    createCircle({ id, name: name.trim(), emoji, amount: a, periodDays: period }, friends);
    router.replace(`/circle/${id}`);
  };
  return (
    <Screen bottom={40}>
      <Header title="New circle" close />
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {EMOJI.map(e => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: e === emoji ? C.ink : C.card, ...(e === emoji ? {} : shadow) }}>
              <Glyph v={e} s={22} c={e === emoji ? '#FFFFFF' : C.text} />
            </Pressable>
          ))}
        </View>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Family circle" maxLength={32} />
        <Field label="Each member pays (USD)" value={amount} onChangeText={setAmount} placeholder="200" keyboardType="decimal-pad" />
        <View style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>Every</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Week" active={period === 7} onPress={() => setPeriod(7)} />
            <Chip label="Month" active={period === 30} onPress={() => setPeriod(30)} />
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <T s={13} w="m" c={C.sub}>Members (payout order = the order you pick them)</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {FRIENDS.map(f => {
              const i = friends.indexOf(f.handle);
              return (
                <Pressable key={f.handle} onPress={() => setFriends(i >= 0 ? friends.filter(x => x !== f.handle) : [...friends, f.handle])} style={{ alignItems: 'center', gap: 4, opacity: i >= 0 ? 1 : 0.45 }}>
                  <View style={{ borderWidth: 2, borderColor: i >= 0 ? C.violet : 'transparent', borderRadius: 28, padding: 2 }}><Avatar name={f.name} color={f.color} size={44} /></View>
                  <T s={12} w="m">{i >= 0 ? `${i + 2}. ${f.name}` : f.name}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
        {a > 0 && friends.length > 0 && (
          <Card style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><T s={12} c={C.mute}>Pot</T><T s={17} w="b">{usd0(a * n)}</T></View>
            <View style={{ flex: 1 }}><T s={12} c={C.mute}>Rounds</T><T s={17} w="b">{n}</T></View>
            <View style={{ flex: 1 }}><T s={12} c={C.mute}>You get it</T><T s={17} w="b" c={C.mint}>Round 1</T></View>
          </Card>
        )}
        <Button label="Start circle" disabled={!ok} onPress={create} />
      </View>
    </Screen>
  );
}
