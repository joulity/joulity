import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Button, Card, Chip, Field, Glyph, Header, Screen, T } from '@/components/ui';
import { RealNewGoal } from '@/components/onchain';
import { FRIENDS, uid, useStore } from '@/lib/store';
import { C, DAY, shadow, usd } from '@/lib/theme';

const EMOJI = ['airplane', 'heart', 'gift', 'confetti', 'house', 'car', 'graduation', 'baby', 'moon', 'diamond'];
const WHEN: [string, number][] = [['3 months', 90], ['6 months', 180], ['1 year', 365], ['2 years', 730]];

// a real account moves real money, which needs the gas relay first
export default function NewGoal() {
  const { s } = useStore();
  return s.user?.real ? <RealNewGoal /> : <DemoNewGoal />;
}

function DemoNewGoal() {
  const { createGoal } = useStore();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [target, setTarget] = useState('');
  const [days, setDays] = useState(365);
  const [friends, setFriends] = useState<string[]>([]);
  const t = Number(target.replace(/[^0-9.]/g, ''));
  const people = friends.length + 1;
  const months = Math.round(days / 30);
  const each = t > 0 ? t / months / people : 0;
  const ok = name.trim() && t > 0;
  const create = () => {
    const id = uid();
    createGoal({ id, name: name.trim(), emoji, target: t, date: Date.now() + days * DAY }, friends);
    router.replace(`/goal/${id}`);
  };
  return (
    <Screen bottom={40}>
      <Header title="New shared goal" close />
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {EMOJI.map(e => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: e === emoji ? C.ink : C.card, ...(e === emoji ? {} : shadow) }}>
              <Glyph v={e} s={22} c={e === emoji ? '#FFFFFF' : C.text} />
            </Pressable>
          ))}
        </View>
        <Field label="The event" value={name} onChangeText={setName} placeholder="Summer trip to Istanbul" maxLength={40} />
        <Field label="Goal for the group (USD)" value={target} onChangeText={setTarget} placeholder="3000" keyboardType="decimal-pad" />
        <View style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>When is the event?</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WHEN.map(([l, d]) => <Chip key={d} label={l} active={d === days} onPress={() => setDays(d)} />)}
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <T s={13} w="m" c={C.sub}>Invite friends</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {FRIENDS.map(f => {
              const on = friends.includes(f.handle);
              return (
                <Pressable key={f.handle} onPress={() => setFriends(on ? friends.filter(x => x !== f.handle) : [...friends, f.handle])} style={{ alignItems: 'center', gap: 4, opacity: on ? 1 : 0.45 }}>
                  <View style={{ borderWidth: 2, borderColor: on ? C.mint : 'transparent', borderRadius: 28, padding: 2 }}><Avatar name={f.name} color={f.color} size={44} /></View>
                  <T s={12} w="m">{f.name}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
        {t > 0 && (
          <Card style={{ gap: 6, backgroundColor: C.mintDim }}>
            <T s={13} w="m" c={C.mint}>The plan</T>
            <T s={24} w="b">{usd(each)} / month each</T>
            <T s={13} c={C.sub} style={{ lineHeight: 19 }}>{people} {people > 1 ? 'people' : 'person'} × {months} months. Yield from the vault makes it a bit less. Anyone can put more, any time.</T>
          </Card>
        )}
        <Card style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>Rules (enforced by the NEAR contract)</T>
          <T s={14}>• Release to you, the organiser: 75% of the money votes yes</T>
          <T s={14}>• Refund everyone early: more than half votes yes</T>
          <T s={14}>• One member leaves with their part: more than half</T>
          <T s={14}>• Not released 30 days after the date: everyone is refunded</T>
        </Card>
        <Button label="Create shared goal" disabled={!ok} onPress={create} />
      </View>
    </Screen>
  );
}
