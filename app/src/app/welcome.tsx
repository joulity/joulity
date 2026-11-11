import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { Avatar, Bar, Button, Fixed, Glyph, Icon, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { C, F, G, shadow } from '@/lib/theme';

export default function Welcome() {
  const { start, startReal } = useStore();
  const a = useAuth();
  const [name, setName] = useState('');
  const [want, setWant] = useState(false);
  const go = (sample: boolean) => { start(name || 'Friend', sample); router.replace('/home'); };
  const real = () => { setWant(true); if (!a.authed) a.login(); };
  // after login, wait for the NEAR wallet, then open the real account
  useEffect(() => {
    if (want && a.authed && a.nearId) { startReal(name, a.nearId, a.email); router.replace('/home'); }
  }, [want, a.authed, a.nearId]);
  const making = want && a.authed && !a.nearId;
  return (
    <Fixed>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={s.logo}><T s={18} w="x" c="#FFFFFF">J</T></View>
        <T s={18} w="b">Joulity</T>
      </View>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        {/* preview of a shared pocket, the product in one picture */}
        <View style={[s.preview, shadow]}>
          <LinearGradient colors={G[1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cover}>
            <View style={s.glyph}><Glyph v="airplane" s={22} /></View>
            <View style={{ flexDirection: 'row' }}>
              {[['S', '#B03C7A'], ['A', '#2C5BD6'], ['Y', '#111113']].map(([n, c], i) => (
                <View key={n} style={{ marginLeft: i ? -8 : 0 }}><Avatar name={n} color={c} size={28} ring /></View>
              ))}
            </View>
          </LinearGradient>
          <View style={{ padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T s={14} w="s" c={C.sub}>Summer trip · 3 friends</T>
              <View style={s.earn}><Icon n="trending-up" s={11} c={C.mint} /><T s={11} w="s" c={C.mint}>earning</T></View>
            </View>
            <T s={24} w="b">$1,140 <T s={14} w="m" c={C.mute}>of $3,000</T></T>
            <Bar p={0.38} colors={G[1]} h={6} />
          </View>
        </View>

        <T s={38} w="x" style={{ lineHeight: 42, marginTop: 30 }}>Save together.{'\n'}<T s={38} w="x" c={C.mint}>Earn everywhere.</T></T>
        <T s={16} c={C.sub} style={{ lineHeight: 24, marginTop: 10 }}>Pockets with friends, savings circles, and money from any chain. Powered by NEAR.</T>
      </View>

      <View style={{ gap: 12 }}>
        <TextInput value={name} onChangeText={setName} placeholder="Your first name" placeholderTextColor={C.mute} style={s.input} maxLength={20} />
        {making
          ? <View style={s.making}><ActivityIndicator color={C.ink} /><T s={14} w="s">{a.walletErr ? 'Could not create your account. Try again.' : 'Creating your NEAR account…'}</T></View>
          : <Button label="Continue with email or Google" icon="mail" disabled={!a.ready} onPress={real} />}
        <Button label="Try the demo" kind="dark" onPress={() => go(true)} />
        <T s={12} c={C.mute} center style={{ lineHeight: 18 }}>Real account: a NEAR mainnet wallet, no seed phrase.{'\n'}Demo: sample numbers, nothing leaves this device.</T>
      </View>
    </Fixed>
  );
}

const s = StyleSheet.create({
  logo: { width: 36, height: 36, borderRadius: 11, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  preview: { borderRadius: 24, backgroundColor: C.card, overflow: 'hidden', transform: [{ rotate: '-2deg' }] },
  cover: { height: 84, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  glyph: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  earn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.mintDim, paddingHorizontal: 8, height: 20, borderRadius: 10 },
  making: { height: 56, borderRadius: 28, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  input: { height: 56, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, color: C.text, fontFamily: F.m, fontSize: 16 },
});
