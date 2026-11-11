// Big amount display + number keypad, like a banking app
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { C } from '@/lib/theme';
import { Icon, T } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

export function press(v: string, k: string) {
  if (k === 'del') return v.slice(0, -1);
  if (k === '.') return v.includes('.') ? v : (v || '0') + '.';
  if (v.includes('.') && v.split('.')[1].length >= 2) return v;
  if (!v.includes('.') && v.replace(/^0/, '').length >= 7) return v;
  return v === '0' ? k : v + k;
}

export function AmountView({ v, note, error }: { v: string; note?: string; error?: string }) {
  const [a, b] = (v || '0').split('.');
  return (
    <View style={{ alignItems: 'center', paddingVertical: 18, gap: 10 }}>
      <T s={56} w="b" c={v ? C.text : C.mute}>
        {'$' + Number(a || 0).toLocaleString('en-US')}
        {b !== undefined ? <T s={56} w="b" c={C.text}>{'.' + b}</T> : null}
      </T>
      {error ? <T s={14} w="m" c={C.red}>{error}</T> : note ? <T s={14} c={C.sub}>{note}</T> : null}
    </View>
  );
}

export function Pad({ v, onChange }: { v: string; onChange: (v: string) => void }) {
  return (
    <View style={s.grid}>
      {KEYS.map(k => (
        <Pressable key={k} onPress={() => onChange(press(v, k))} style={({ pressed }) => [s.key, pressed && { backgroundColor: C.card2 }]}>
          {k === 'del' ? <Icon n="delete" s={22} c={C.sub} /> : <T s={26} w="m">{k}</T>}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 },
  key: { width: '33.33%', height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
});
