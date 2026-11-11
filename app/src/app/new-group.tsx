// New pocket: personal, or collective (the group chooses its rules once, when it is created).
//  A. Free pocket: everyone can take back their own share at any time.
//  B. Locked goal: the money stays until the goal; paying out or leaving early needs the group's vote.
import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Header, Icon, Screen, T } from '@/components/ui';
import { C } from '@/lib/theme';

const CHOICES = [
  {
    href: '/new-pocket?kind=solo', glyph: 'user', title: 'Just me',
    line: 'A personal pocket. Only you put money in and take it out.',
    points: ['Earns from day one', 'Good for a safety net, a new laptop'],
  },
  {
    href: '/new-pocket?kind=free', glyph: 'users', title: 'Together · free',
    line: 'Everyone can take back their own share at any time.',
    points: ['Nobody can touch your share', 'Good for a shared trip fund, a family pot'],
  },
  {
    href: '/new-goal', glyph: 'lock', title: 'Together · locked goal',
    line: 'The money stays until the goal. Paying out or leaving early needs the group\'s vote.',
    points: ['Members accept the rules when they join', 'Pay out: 75% yes · leave early: more than 50%', 'Nothing paid out 30 days after the date? Everyone gets their part back'],
  },
];

export default function NewGroup() {
  return (
    <Screen bottom={40}>
      <Header title="New pocket" close />
      <T s={14} c={C.sub} style={{ marginBottom: 16 }}>Just for you, or with friends. For a group, the rules are chosen once and everyone who joins sees them. The money earns in the Joulity vault either way.</T>
      <View style={{ gap: 12 }}>
        {CHOICES.map(c => (
          <Card key={c.href} onPress={() => router.replace(c.href as any)} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><Icon n={c.glyph as any} s={20} c={C.text} /></View>
              <View style={{ flex: 1 }}>
                <T s={17} w="b">{c.title}</T>
                <T s={13} c={C.sub}>{c.line}</T>
              </View>
              <Icon n="chevron-right" s={18} c={C.mute} />
            </View>
            {c.points.map(p => <T key={p} s={13} c={C.text}>{`• ${p}`}</T>)}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
