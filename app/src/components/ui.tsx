import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle as SC, Defs, LinearGradient as SG, Stop } from 'react-native-svg';
import { C, F, shadow } from '@/lib/theme';
import { ICONS, IconName, isIcon } from './icons';

type Weight = 'regular' | 'bold' | 'fill' | 'duotone';

type W = keyof typeof F;

export function T({ s = 15, w = 'r', c = C.text, center, style, ...p }: TextProps & { s?: number; w?: W; c?: string; center?: boolean }) {
  const ls = s >= 30 ? -1.4 : s >= 20 ? -0.5 : s <= 12 ? 0.2 : 0;
  return <Text {...p} style={[{ fontSize: s, fontFamily: F[w], color: c, letterSpacing: ls, textAlign: center ? 'center' : undefined }, style]} />;
}

export function Icon({ n, s = 20, c = C.text, w = 'regular' }: { n: IconName; s?: number; c?: string; w?: Weight }) {
  const I = ICONS[n] ?? ICONS.info;
  return <I size={s} color={c} weight={w} />;
}

// a pocket or circle symbol: an icon key, or an emoji saved by an older version
export function Glyph({ v, s = 22, c = '#FFFFFF' }: { v: string; s?: number; c?: string }) {
  return isIcon(v) ? <Icon n={v} s={s} c={c} w="duotone" /> : <T s={s}>{v}</T>;
}

export function Screen({ children, bottom = 120, pad = 20 }: { children: React.ReactNode; bottom?: number; pad?: number }) {
  const ins = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingHorizontal: pad, paddingTop: ins.top + 14, paddingBottom: bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Fixed({ children }: { children: React.ReactNode }) {
  const ins = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: ins.top + 14, paddingBottom: ins.bottom + 16 }}>{children}</View>;
}

export const back = () => (router.canGoBack() ? router.back() : router.replace('/home'));

export function Header({ title, close, right }: { title?: string; close?: boolean; right?: React.ReactNode }) {
  return (
    <View style={st.header}>
      <Pressable onPress={back} style={[st.round, shadow]} hitSlop={8}><Icon n={close ? 'x' : 'chevron-left'} s={20} /></Pressable>
      <T s={16} w="s">{title}</T>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void }) {
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => [st.card, style as ViewStyle, pressed && { transform: [{ scale: 0.985 }] }]}>{children}</Pressable>;
  return <View style={[st.card, style as ViewStyle]}>{children}</View>;
}

export function Button({ label, onPress, kind = 'primary', icon, disabled, style }: {
  label: string; onPress?: () => void; kind?: 'primary' | 'ghost' | 'dark'; icon?: IconName; disabled?: boolean; style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? C.ink : kind === 'dark' ? C.card : 'transparent';
  const fg = kind === 'primary' ? '#FFFFFF' : C.text;
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [st.btn, { backgroundColor: bg, opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, kind === 'ghost' && { borderWidth: 1, borderColor: C.line }, kind === 'dark' && shadow, style]}>
      {icon && <Icon n={icon} s={18} c={fg} w="bold" />}
      <T s={16} w="s" c={fg}>{label}</T>
    </Pressable>
  );
}

export function Avatar({ name, color, size = 40, ring }: { name: string; color: string; size?: number; ring?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 2 : 0, borderColor: C.card }}>
      <T s={size * 0.38} w="s" c="#FFFFFF">{name.slice(0, 1).toUpperCase()}</T>
    </View>
  );
}

export function Stack3({ people, size = 26 }: { people: { name: string; color: string }[]; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.slice(0, 4).map((p, i) => <View key={i} style={{ marginLeft: i ? -size * 0.3 : 0 }}><Avatar name={p.name} color={p.color} size={size} ring /></View>)}
    </View>
  );
}

export function Bar({ p, colors = [C.mint, C.blue], h = 6 }: { p: number; colors?: [string, string]; h?: number }) {
  return (
    <View style={{ height: h, borderRadius: h, backgroundColor: C.track, overflow: 'hidden' }}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.min(100, Math.max(2, p * 100))}%`, height: '100%', borderRadius: h }} />
    </View>
  );
}

export function Ring({ p, size = 56, stroke = 6, colors, children }: { p: number; size?: number; stroke?: number; colors: [string, string]; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, id = 'g' + colors.join('').replace(/#/g, '');
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs><SG id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors[0]} /><Stop offset="1" stopColor={colors[1]} /></SG></Defs>
        <SC cx={size / 2} cy={size / 2} r={r} stroke={C.track} strokeWidth={stroke} fill="none" />
        <SC cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, p)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, active && { backgroundColor: C.ink, borderColor: C.ink }]}>
      {icon && <Icon n={icon} s={14} c={active ? '#FFFFFF' : C.sub} />}
      <T s={13} w="m" c={active ? '#FFFFFF' : C.text}>{label}</T>
    </Pressable>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={st.section}>
      <T s={17} w="b">{title}</T>
      {action && <Pressable onPress={onAction} hitSlop={8}><T s={14} w="s" c={C.blue}>{action}</T></Pressable>}
    </View>
  );
}

export function Row({ icon, iconColor = C.text, iconBg = C.card2, emoji, title, sub, right, rightSub, rightColor, onPress, last }: {
  icon?: IconName; iconColor?: string; iconBg?: string; emoji?: string;
  title: string; sub?: string; right?: string; rightSub?: string; rightColor?: string; onPress?: () => void; last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [st.row, !last && st.rowLine, pressed && { opacity: 0.7 }]}>
      <View style={[st.bubble, { backgroundColor: iconBg }]}>{emoji ? <Glyph v={emoji} s={20} c={iconColor} /> : icon && <Icon n={icon} s={20} c={iconColor} w="duotone" />}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <T s={15} w="s" numberOfLines={1}>{title}</T>
        {sub ? <T s={13} c={C.sub} numberOfLines={1}>{sub}</T> : null}
      </View>
      {right ? (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <T s={15} w="s" c={rightColor ?? C.text}>{right}</T>
          {rightSub ? <T s={12} c={C.mute}>{rightSub}</T> : null}
        </View>
      ) : onPress ? <Icon n="chevron-right" s={18} c={C.mute} /> : null}
    </Pressable>
  );
}

export function Field(p: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <T s={13} w="m" c={C.sub}>{p.label}</T>
      <TextInput placeholderTextColor={C.mute} {...p} style={[st.field, p.style]} />
    </View>
  );
}

export function Money({ v, s = 40, hide, c = C.text, dim = C.mute }: { v: number; s?: number; hide?: boolean; c?: string; dim?: string }) {
  if (hide) return <T s={s} w="b" c={c}>••••••</T>;
  const [a, b] = Math.abs(v).toFixed(2).split('.');
  return (
    <Text>
      <T s={s} w="b" c={c}>{(v < 0 ? '-' : '') + '$' + Number(a).toLocaleString('en-US')}</T>
      <T s={s * 0.55} w="b" c={dim}>{'.' + b}</T>
    </Text>
  );
}

export function DemoTag() {
  return <View style={st.demo}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.amber }} /><T s={11} w="s" c={C.amber}>DEMO</T></View>;
}

export function Done({ title, sub, onDone }: { title: string; sub: string; onDone: () => void }) {
  return (
    <Fixed>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.mintDim, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center' }}><Icon n="check" s={34} c="#FFFFFF" w="bold" /></View>
        </View>
        <T s={28} w="b" center>{title}</T>
        <T s={15} c={C.sub} center style={{ maxWidth: 300, lineHeight: 22 }}>{sub}</T>
      </View>
      <Button label="Done" onPress={onDone} />
    </Fixed>
  );
}

export const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: 24, padding: 18, ...shadow },
  btn: { height: 56, borderRadius: 28, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  chip: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 16, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  bubble: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  field: { height: 56, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, color: C.text, fontFamily: F.m, fontSize: 16 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: C.amberDim },
});
