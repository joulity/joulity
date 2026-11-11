import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Button, Glyph, Chip, Field, Header, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { newPocket, saveToPocket } from '@/lib/relay';
import { FRIENDS, uid, useStore } from '@/lib/store';
import { C, DAY, shadow, usd } from '@/lib/theme';

const EMOJI = ['airplane', 'car', 'house', 'laptop', 'graduation', 'diamond', 'umbrella', 'gift', 'baby', 'heart'];
const WHEN: [string, number][] = [['3 months', 90], ['6 months', 180], ['1 year', 365], ['2 years', 730]];

export default function NewPocket() {
  const { s, createPocket, movePocket } = useStore();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const solo = kind === 'solo';
  const a = useAuth();
  const real = !!s.user?.real;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [target, setTarget] = useState('');
  const [days, setDays] = useState(180);
  const [friends, setFriends] = useState<string[]>([]);
  const [now, setNow] = useState('');
  const [step, setStep] = useState('');
  const avail = Math.floor((a.chain?.usdc ?? 0) * 100) / 100;
  const put = Number(now.replace(',', '.')) || 0;
  const t = Number(target.replace(/[^0-9.]/g, ''));
  const ok = name.trim() && t > 0 && (!real || put <= avail);
  const create = async () => {
    const deadline = Date.now() + days * DAY;
    if (!real) {
      const id = uid();
      createPocket({ id, name: name.trim(), emoji, target: t, deadline, color: s.pockets.length, solo }, solo ? [] : friends);
      return router.replace(`/pocket/${id}`);
    }
    // real: the pocket lives on NEAR; its money will sit in the Joulity vault and earn
    setBusy(true); setErr(''); setStep('Creating your pocket…');
    let id = '';
    try {
      const chainId = await newPocket(a.nearId, name.trim(), t, deadline, a.sign);
      id = `n${chainId}`;
      createPocket({ id, chainId, name: name.trim(), emoji, target: t, deadline, color: s.pockets.length, solo }, []);
      if (put > 0) {
        setStep(`Putting ${usd(put)} in…`);
        await saveToPocket(a.nearId, chainId, put, a.sign);
        movePocket(id, put, 'in'); a.refresh();
      }
      router.replace(`/pocket/${id}`);
    } catch (e) {
      if (id) { setErr(`Pocket created, but the money did not move: ${(e as Error).message}. Open the pocket and tap Add.`); a.refresh(); }
      else setErr((e as Error).message);
    }
    setBusy(false); setStep('');
  };
  return (
    <Screen bottom={40}>
      <Header title={solo ? 'Personal pocket' : kind === 'free' ? 'Collective pocket' : 'New pocket'} close />
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {EMOJI.map(e => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: e === emoji ? C.ink : C.card, ...(e === emoji ? {} : shadow) }}>
              <Glyph v={e} s={22} c={e === emoji ? '#FFFFFF' : C.text} />
            </Pressable>
          ))}
        </View>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Summer trip" maxLength={32} />
        <Field label="Goal (USD)" value={target} onChangeText={setTarget} placeholder="3000" keyboardType="decimal-pad" />
        <View style={{ gap: 8 }}>
          <T s={13} w="m" c={C.sub}>When</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WHEN.map(([l, d]) => <Chip key={d} label={l} active={d === days} onPress={() => setDays(d)} />)}
          </View>
        </View>
        {real ? (
          <View style={{ gap: 8 }}>
            <Field label={`Put in now (optional) · you have ${usd(avail)}`} value={now} onChangeText={setNow} placeholder="0" keyboardType="decimal-pad" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[1, 5, 10].filter(v => v <= avail).map(v => <Chip key={v} label={usd(v)} active={put === v} onPress={() => setNow(String(v))} />)}
              {avail > 0 ? <Chip label="All" active={put === avail} onPress={() => setNow(String(avail))} /> : null}
            </View>
            {put > avail ? <T s={13} c={C.red}>{`You have ${usd(avail)}. Add money first.`}</T> : null}
            {avail < 1 ? <Pressable onPress={() => router.push('/add')}><T s={13} w="s" c={C.text}>+ Add money to your account</T></Pressable> : null}
          </View>
        ) : solo ? null : <View style={{ gap: 10 }}>
          <T s={13} w="m" c={C.sub}>Save with friends (optional)</T>
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
        </View>}
        {err ? <T s={13} c={C.red}>{err}</T> : null}
        <Button label={busy ? step || 'Working…' : put > 0 ? `Create and put ${usd(put)}` : 'Create pocket'} disabled={!ok || busy} onPress={create} />
        {real ? <T s={12} c={C.sub} style={{ textAlign: 'center' }}>{kind === 'free' ? 'Next: share the invite link. Everyone can take back their own share at any time.' : 'Your pocket earns from day one. No fees, no gas.'}</T> : null}
      </View>
    </Screen>
  );
}
