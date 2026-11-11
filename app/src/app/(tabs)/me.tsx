import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { MainnetTag } from '@/components/real';
import { Avatar, Card, DemoTag, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { EXPLORER, short } from '@/lib/near';
import { useStore } from '@/lib/store';
import { C } from '@/lib/theme';

export default function Me() {
  const { s, reset, toggleHide } = useStore();
  const [sure, setSure] = useState(false);
  const a = useAuth();
  const real = !!s.user?.real;
  const out = async () => { await a.logout().catch(() => {}); reset(); router.replace('/welcome'); };
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 10, marginTop: 10 }}>
        <Avatar name={s.user!.name} color={C.violet} size={84} />
        <T s={24} w="b">{s.user!.name}</T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <T s={14} c={C.sub}>{real ? short(s.user!.handle) : s.user!.handle}</T>
          {real ? <MainnetTag /> : <DemoTag />}
        </View>
      </View>

      <SectionTitle title="Account" />
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="at-sign" iconColor={C.mint} iconBg={C.mintDim} title="NEAR account" sub={real ? short(s.user!.handle) : s.user!.handle}
          onPress={real ? () => Linking.openURL(EXPLORER + s.user!.handle) : undefined} />
        {real && <Row icon="wallet" iconColor={C.blue} iconBg={C.blueDim} title="On NEAR now"
          sub={a.chain ? `${a.chain.usdc.toFixed(2)} USDC · ${a.chain.near.toFixed(4)} NEAR` : 'Reading the chain…'} onPress={a.refresh} />}
        <Row icon="clock" iconColor={C.blue} iconBg="rgba(61,139,255,0.15)" title="All activity" onPress={() => router.push('/activity')} />
        <Row icon={s.hide ? 'eye' : 'eye-off'} title={s.hide ? 'Show balances' : 'Hide balances'} onPress={toggleHide} last />
      </Card>

      <SectionTitle title="Security & privacy" />
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="mail" iconColor={C.violet} iconBg="rgba(123,97,255,0.15)" title="Email sign-in" sub={real ? `Signed in as ${s.user!.email || 'Google'} · no seed phrase` : 'No seed phrase. Sign in from the welcome screen'} />
        <Row icon="zap" iconColor={C.amber} iconBg="rgba(255,181,71,0.15)" title="No gas fees" sub="We pay the network fees for you" />
        <Row icon="cpu" iconColor={C.pink} iconBg="rgba(255,111,216,0.15)" title="Private AI coach" sub="Runs in a secure enclave. Coming soon" last />
      </Card>

      <SectionTitle title="Transparency" />
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="bar-chart-2" iconColor={C.mint} iconBg={C.mintDim} title="Vault dashboard" sub="Where the savings earn, live" onPress={() => Linking.openURL('https://app.joulity.com/vault')} />
        <Row icon="github" title="Open source" sub="github.com/joulity/joulity" onPress={() => Linking.openURL('https://github.com/joulity/joulity')} last />
      </Card>

      {real ? (<>
      <SectionTitle title="Session" />
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="x" iconColor={C.red} iconBg={C.redDim} title="Sign out" sub="Your money stays on NEAR. Sign in again any time." onPress={out} last />
      </Card></>) : (<>
      <SectionTitle title="Demo" />
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="info" iconColor={C.amber} iconBg="rgba(255,181,71,0.15)" title="This is a demo" sub="Numbers are examples. No real money moves." />
        <Row icon="refresh-cw" iconColor={C.red} iconBg="rgba(255,92,122,0.15)" title={sure ? 'Tap again to erase everything' : 'Reset demo'}
          onPress={() => { if (sure) { reset(); router.replace('/welcome'); } else setSure(true); }} last />
      </Card></>)}
      <T s={12} c={C.mute} center style={{ marginTop: 20 }}>Joulity on NEAR · v0.1</T>
    </Screen>
  );
}
