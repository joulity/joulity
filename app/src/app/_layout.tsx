import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth';
import { StoreProvider } from '@/lib/store';
import { C } from '@/lib/theme';

export default function Root() {
  const [ok, err] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  // never stay on a blank screen: open with system fonts if Inter fails or is slow
  const [late, setLate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLate(true), 2500); return () => clearTimeout(t); }, []);
  if (!ok && !err && !late) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const modal = { presentation: 'modal' as const, animation: 'slide_from_bottom' as const };
  return (
    <SafeAreaProvider>
      <AuthProvider>
      <StoreProvider>
        {/* on a desktop browser the app sits in a phone-width column */}
        <View style={{ flex: 1, backgroundColor: '#E4E6EB', alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 480, backgroundColor: C.bg, overflow: 'hidden' }}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
              <Stack.Screen name="add" options={modal} />
              <Stack.Screen name="send" options={modal} />
              <Stack.Screen name="move" options={modal} />
              <Stack.Screen name="new-group" options={modal} />
              <Stack.Screen name="new-pocket" options={modal} />
              <Stack.Screen name="new-circle" options={modal} />
              <Stack.Screen name="new-goal" options={modal} />
            </Stack>
          </View>
        </View>
      </StoreProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
