import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';
import { useStore } from '@/lib/store';
import { C, F } from '@/lib/theme';

export default function TabsLayout() {
  const { s } = useStore();
  const ins = useSafeAreaInsets();
  if (!s.user) return <Redirect href="/welcome" />;
  const tab = (title: string, icon: any) => ({
    title,
    tabBarIcon: ({ color, focused }: { color: unknown; focused: boolean }) => <Icon n={icon} s={24} c={String(color)} w={focused ? 'fill' : 'regular'} />,
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.ink,
        tabBarInactiveTintColor: C.mute,
        tabBarLabelStyle: { fontFamily: F.s, fontSize: 11, lineHeight: 14, flexShrink: 0, overflow: 'visible' },
        tabBarIconStyle: { height: 26 },
        tabBarItemStyle: { height: 58, paddingVertical: 4 },
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: C.line, height: 72 + ins.bottom, paddingTop: 6, paddingBottom: ins.bottom + 8 },
        sceneStyle: { backgroundColor: C.bg },
      }}>
      <Tabs.Screen name="home" options={tab('Home', 'home')} />
      <Tabs.Screen name="goals" options={tab('Goals', 'flag')} />
      <Tabs.Screen name="pockets" options={tab('Pockets', 'target')} />
      <Tabs.Screen name="circles" options={{ ...tab('Circles', 'users'), href: null }} />
      <Tabs.Screen name="me" options={tab('Profile', 'user')} />
    </Tabs>
  );
}
