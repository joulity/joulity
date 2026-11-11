import { View } from 'react-native';
import { Card, Header, Row, Screen, T } from '@/components/ui';
import { TxRow } from '@/components/tx';
import { Tx, useStore } from '@/lib/store';
import { C, when } from '@/lib/theme';

export default function Activity() {
  const { s } = useStore();
  const groups: [string, Tx[]][] = [];
  for (const t of s.txs) {
    const d = when(t.t);
    const g = groups.find(x => x[0] === d);
    g ? g[1].push(t) : groups.push([d, [t]]);
  }
  return (
    <Screen bottom={60}>
      <Header title="Activity" />
      {groups.length === 0 && <Card><Row icon="clock" iconColor={C.mute} title="No activity yet" last /></Card>}
      {groups.map(([d, list]) => (
        <View key={d} style={{ marginBottom: 18 }}>
          <T s={13} w="s" c={C.mute} style={{ marginBottom: 8, marginLeft: 4 }}>{d.toUpperCase()}</T>
          <Card style={{ paddingVertical: 4 }}>
            {list.map((t, i) => <TxRow key={t.id} t={t} hide={s.hide} last={i === list.length - 1} />)}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
