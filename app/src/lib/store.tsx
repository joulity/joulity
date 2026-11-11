// Demo store: everything lives on this device. No real money moves yet.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { DAY } from './theme';
import type { Asset, Prices } from './prices';

export const RATE = 0.05; // example rate for demo mode only
const YEAR = 365 * DAY;
const KEY = 'joulity.near.v2';

export type Friend = { handle: string; name: string; color: string };
export const FRIENDS: Friend[] = [
  { handle: 'sara.near', name: 'Sara', color: '#B03C7A' },
  { handle: 'alex.near', name: 'Alex', color: '#2C5BD6' },
  { handle: 'omar.near', name: 'Omar', color: '#B7741A' },
  { handle: 'lina.near', name: 'Lina', color: '#0E8A63' },
  { handle: 'noah.near', name: 'Noah', color: '#6B5BD2' },
  { handle: 'mia.near', name: 'Mia', color: '#C8414B' },
];

export type TxKind = 'add' | 'send' | 'in' | 'out' | 'circle' | 'payout' | 'goal';
export type Tx = { id: string; t: number; kind: TxKind; amount: number; title: string; sub: string; ref?: string };
export type Pocket = {
  id: string; name: string; emoji: string; target: number; deadline: number; color: number;
  members: { handle: string; put: number }[]; createdAt: number;
  chainId?: number;   // real account: the pocket number in joulity-social.near (money sits in the vault as jUSD)
  solo?: boolean;     // personal pocket: no invite
};
export type Circle = {
  id: string; name: string; emoji: string; amount: number; periodDays: number;
  members: string[]; round: number; paid: boolean[]; startedAt: number;
  chainId?: number;   // real account: circle number in joulity-social.near (startedAt 0 = not started)
};
// Shared goal (cha9a9a): one event, one objective. Money is in escrow; every exit is a vote weighted by money put in.
export type VoteKind = 'release' | 'refund' | 'leave';
export type GoalVote = { kind: VoteKind; by: string; who?: string; ends: number; yes: string[]; no: string[] };
export type Goal = {
  id: string; name: string; emoji: string; target: number; date: number; createdAt: number; color: number;
  organizer: string; yieldEarned: number; status: 'open' | 'released' | 'refunded';
  members: { handle: string; put: number; streak: number }[]; vote?: GoalVote;
  chainId?: number;   // real account: goal number in joulity-social.near
};
export const VOTE_NEED: Record<VoteKind, number> = { release: 0.75, refund: 0.5, leave: 0.5 };
export const goalTotal = (g: Goal) => g.members.reduce((a, m) => a + m.put, 0);
export const goalPot = (g: Goal) => goalTotal(g) + g.yieldEarned;
export const voteShare = (g: Goal, list: string[]) => {
  const t = goalTotal(g);
  return t ? g.members.filter(m => list.includes(m.handle)).reduce((a, m) => a + m.put, 0) / t : 0;
};
export const votePassed = (g: Goal, v: GoalVote) => (v.kind === 'release' ? voteShare(g, v.yes) >= 0.75 : voteShare(g, v.yes) > 0.5);
// what each member should put every month to reach the goal on time
export const monthlyEach = (g: Goal) => {
  const left = Math.max(0, g.target - goalPot(g));
  const months = Math.max(1, Math.ceil((g.date - Date.now()) / (30 * DAY)));
  return left / months / Math.max(1, g.members.length);
};
export const MILESTONES = [0.25, 0.5, 0.75, 1];

// real = signed in with Privy; handle is then the user's NEAR mainnet account
export type User = { name: string; handle: string; real?: boolean; email?: string };
export type State = {
  v: 1; user: User | null; balance: number; earned: number; last: number;
  pockets: Pocket[]; circles: Circle[]; goals: Goal[]; txs: Tx[]; hide: boolean;
  // rewards portfolio: how rewards are split, what they bought (units), what it cost, rewards already used
  mix: Record<Asset, number>; bag: Record<Asset, number>; cost: Record<Asset, number>; converted: number;
};

const empty = (): State => ({ v: 1, user: null, balance: 0, earned: 0, last: Date.now(), pockets: [], circles: [], goals: [], txs: [], hide: false,
  mix: { usd: 40, btc: 30, gold: 30 }, bag: { usd: 0, btc: 0, gold: 0 }, cost: { usd: 0, btc: 0, gold: 0 }, converted: 0 });
export const uid = () => Math.random().toString(36).slice(2, 9);

export const pocketTotal = (p: Pocket) => p.members.reduce((a, m) => a + m.put, 0);
export const myPut = (p: Pocket, me: string) => p.members.find(m => m.handle === me)?.put ?? 0;
const inGoals = (s: State) => (s.goals ?? []).filter(g => g.status === 'open').reduce((a, g) => a + (g.members.find(m => m.handle === s.user?.handle)?.put ?? 0), 0);
export const inPockets = (s: State) => s.pockets.reduce((a, p) => a + myPut(p, s.user?.handle ?? ''), 0) + inGoals(s);
export const principal = (s: State) => s.balance + inPockets(s);
// demo yield only: a real account shows what the chain says, nothing simulated
export const liveGain = (s: State, now: number) => (s.user?.real ? 0 : principal(s) * RATE * Math.max(0, now - s.last) / YEAR);

export const friend = (h: string, s: State): Friend =>
  h === s.user?.handle ? { handle: h, name: `${s.user.name} (you)`, color: '#111113' } : FRIENDS.find(f => f.handle === h) ?? { handle: h, name: h.split('.')[0], color: '#9AA0B4' };

export const circleDue = (c: Circle) => c.startedAt + (c.round + 1) * c.periodDays * DAY;
export const circleDone = (c: Circle) => c.round >= c.members.length;

function accrue(s: State): State {
  const now = Date.now();
  const g = liveGain(s, now);
  return { ...s, balance: s.balance + g, earned: s.earned + g, last: now };
}

const tx = (kind: TxKind, amount: number, title: string, sub: string, ref?: string, t = Date.now()): Tx => ({ id: uid(), t, kind, amount, title, sub, ref });

function seed(user: User): Partial<State> {
  const now = Date.now();
  const me = user.handle;
  return {
    balance: 1250,
    earned: 52.4, converted: 48.3,
    bag: { usd: 19.3, btc: 0.00019, gold: 0.0037 }, cost: { usd: 19.3, btc: 13.9, gold: 15.1 },
    pockets: [
      { id: 'trip', name: 'Summer trip', emoji: 'airplane', target: 3000, deadline: now + 120 * DAY, color: 1, createdAt: now - 40 * DAY,
        members: [{ handle: me, put: 520 }, { handle: 'sara.near', put: 380 }, { handle: 'alex.near', put: 240 }] },
      { id: 'safety', name: 'Safety net', emoji: 'umbrella', target: 5000, deadline: now + 300 * DAY, color: 0, createdAt: now - 90 * DAY,
        members: [{ handle: me, put: 2300 }] },
      { id: 'laptop', name: 'New laptop', emoji: 'laptop', target: 1500, deadline: now + 60 * DAY, color: 2, createdAt: now - 20 * DAY,
        members: [{ handle: me, put: 420 }] },
    ],
    goals: [
      { id: 'wedding', name: "Sara's wedding gift", emoji: 'heart', target: 1200, date: now + 75 * DAY, createdAt: now - 105 * DAY, color: 2,
        organizer: 'sara.near', yieldEarned: 11.4, status: 'open',
        members: [{ handle: 'sara.near', put: 260, streak: 4 }, { handle: me, put: 240, streak: 4 }, { handle: 'alex.near', put: 180, streak: 3 },
          { handle: 'omar.near', put: 160, streak: 2 }, { handle: 'lina.near', put: 120, streak: 1 }] },
      { id: 'umrah', name: 'Family trip 2027', emoji: 'airplane', target: 5000, date: now + 300 * DAY, createdAt: now - 60 * DAY, color: 4,
        organizer: me, yieldEarned: 6.2, status: 'open',
        members: [{ handle: me, put: 400, streak: 2 }, { handle: 'noah.near', put: 300, streak: 2 }, { handle: 'mia.near', put: 150, streak: 1 }] },
    ],
    circles: [
      { id: 'family', name: 'Family circle', emoji: 'handshake', amount: 200, periodDays: 30, round: 1, startedAt: now - 42 * DAY,
        members: ['omar.near', 'lina.near', me, 'noah.near', 'mia.near'], paid: [true, true, false, true, true] },
    ],
    txs: [
      tx('add', 500, 'Added from Base', 'USDC via NEAR Intents', undefined, now - 1 * DAY),
      tx('in', 120, 'Summer trip', 'Moved to pocket', 'trip', now - 2 * DAY),
      tx('circle', 200, 'Family circle', 'Round 1 payment', 'family', now - 12 * DAY),
      tx('send', 35, 'Sent to Sara', 'sara.near', undefined, now - 14 * DAY),
      tx('add', 1000, 'Added from Ethereum', 'USDC via NEAR Intents', undefined, now - 30 * DAY),
    ],
  };
}

type Ctx = {
  s: State;
  start: (name: string, sample: boolean) => void;
  startReal: (name: string, near: string, email: string) => void;
  addMoney: (amount: number, chain: string) => void;
  send: (to: string, amount: number) => void;
  createPocket: (p: Omit<Pocket, 'members' | 'createdAt'>, friends: string[]) => void;
  movePocket: (id: string, amount: number, dir: 'in' | 'out') => void;
  createCircle: (c: Omit<Circle, 'members' | 'round' | 'paid' | 'startedAt'>, friends: string[]) => void;
  payCircle: (id: string) => 'paid' | 'payout' | 'paid_out_other';
  createGoal: (g: { id: string; name: string; emoji: string; target: number; date: number }, friends: string[]) => void;
  putGoal: (id: string, amount: number) => void;
  proposeGoal: (id: string, kind: VoteKind, who?: string) => void;
  voteGoal: (id: string, yes: boolean, who?: string) => 'open' | 'passed';
  setMix: (m: Record<Asset, number>) => void;
  buyRewards: (p: Prices) => number;
  toggleHide: () => void;
  reset: () => void;
  /** real accounts: keep a copy of what the chain says (insert or replace by id) */
  saveReal: (kind: 'circles' | 'goals' | 'pockets', item: Circle | Goal | Pocket) => void;
};

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => {
      try { setS(v ? { ...empty(), ...JSON.parse(v) } : empty()); } catch { setS(empty()); }
    }).catch(() => setS(empty()));
  }, []);

  useEffect(() => { if (s) AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {}); }, [s]);

  // fold interest into the balance every 30 s so it survives reloads
  useEffect(() => {
    const t = setInterval(() => setS(x => (x?.user ? accrue(x) : x)), 30000);
    return () => clearInterval(t);
  }, []);

  if (!s) return null;
  const act = (f: (x: State) => State) => setS(x => f(accrue(x!)));
  const me = s.user?.handle ?? '';

  const ctx: Ctx = {
    s,
    start: (name, sample) => {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'me';
      const user = { name: name.trim() || 'Friend', handle: `${slug}.joulity.near` };
      setS({ ...empty(), user, ...(sample ? seed(user) : {}) });
    },
    startReal: (name, near, email) => {
      // keep pockets made earlier by the same account, start clean for a new one
      if (s.user?.real && s.user.handle === near) return;
      setS({ ...empty(), user: { name: name.trim() || email.split('@')[0] || 'Friend', handle: near, real: true, email } });
    },
    addMoney: (amount, chain) => act(x => ({ ...x, balance: x.balance + amount, txs: [tx('add', amount, `Added from ${chain}`, 'USDC via NEAR Intents'), ...x.txs] })),
    send: (to, amount) => act(x => ({ ...x, balance: x.balance - amount, txs: [tx('send', amount, `Sent to ${friend(to, x).name}`, to), ...x.txs] })),
    createPocket: (p, friends) => act(x => ({
      ...x,
      pockets: [{ ...p, createdAt: Date.now(), members: [{ handle: me, put: 0 }, ...friends.map(h => ({ handle: h, put: 0 }))] }, ...x.pockets],
    })),
    movePocket: (id, amount, dir) => act(x => {
      const p = x.pockets.find(q => q.id === id)!;
      const d = dir === 'in' ? amount : -amount;
      return {
        ...x,
        balance: x.balance - d,
        pockets: x.pockets.map(q => q.id !== id ? q : { ...q, members: q.members.map(m => m.handle === me ? { ...m, put: m.put + d } : m) }),
        txs: [tx(dir, amount, p.name, dir === 'in' ? 'Moved to pocket' : 'Taken from pocket', id), ...x.txs],
      };
    }),
    createCircle: (c, friends) => act(x => {
      const members = [me, ...friends];
      return { ...x, circles: [{ ...c, members, round: 0, startedAt: Date.now(), paid: members.map(h => h !== me) }, ...x.circles] };
    }),
    payCircle: id => {
      const c = s.circles.find(q => q.id === id)!;
      const winner = c.members[c.round];
      const pot = c.amount * c.members.length;
      act(x => {
        const txs = [tx('circle', c.amount, c.name, `Round ${c.round + 1} payment`, id), ...x.txs];
        let balance = x.balance - c.amount;
        // demo: the other members already paid this round, so the pot goes out at once
        if (winner === me) { balance += pot; txs.unshift(tx('payout', pot, c.name, `You received the round ${c.round + 1} pot`, id)); }
        const round = c.round + 1;
        return {
          ...x, balance, txs,
          circles: x.circles.map(q => q.id !== id ? q : { ...q, round, paid: q.members.map(h => h !== me) }),
        };
      });
      return winner === me ? 'payout' : 'paid_out_other';
    },
    createGoal: (g, friends) => act(x => ({
      ...x,
      goals: [{ ...g, createdAt: Date.now(), color: (x.goals ?? []).length, organizer: me, yieldEarned: 0, status: 'open' as const,
        members: [me, ...friends].map(handle => ({ handle, put: 0, streak: 0 })) }, ...(x.goals ?? [])],
    })),
    putGoal: (id, amount) => act(x => {
      const g = x.goals.find(q => q.id === id)!;
      return {
        ...x,
        balance: x.balance - amount,
        goals: x.goals.map(q => q.id !== id ? q : { ...q, members: q.members.map(m => m.handle === me ? { ...m, put: m.put + amount, streak: Math.max(1, m.streak) } : m) }),
        txs: [tx('goal', amount, g.name, 'Put into the shared goal', id), ...x.txs],
      };
    }),
    proposeGoal: (id, kind, who) => act(x => ({
      ...x,
      goals: x.goals.map(q => q.id !== id ? q : { ...q, vote: { kind, by: me, who, ends: Date.now() + 7 * DAY, yes: [me], no: [] } }),
    })),
    // who = a friend voting (demo only: lets you play the other members)
    voteGoal: (id, yes, who) => {
      const voter = who ?? me;
      const g0 = s.goals.find(q => q.id === id)!;
      const v0 = g0.vote!;
      const v = { ...v0, yes: v0.yes.filter(h => h !== voter), no: v0.no.filter(h => h !== voter) };
      (yes ? v.yes : v.no).push(voter);
      const passed = votePassed(g0, v);
      act(x => {
        const g = x.goals.find(q => q.id === id)!;
        if (!passed) return { ...x, goals: x.goals.map(q => q.id !== id ? q : { ...q, vote: v }) };
        const pot = goalPot(g), total = goalTotal(g);
        const part = (h: string) => (total ? pot * (g.members.find(m => m.handle === h)?.put ?? 0) / total : 0);
        let balance = x.balance, txs = x.txs, next: Goal;
        if (v.kind === 'release') {
          next = { ...g, status: 'released', vote: undefined };
          if (g.organizer === me) { balance += pot; txs = [tx('payout', pot, g.name, 'Released to you by vote', id), ...txs]; }
        } else if (v.kind === 'refund') {
          next = { ...g, status: 'refunded', vote: undefined };
          balance += part(me);
          txs = [tx('payout', part(me), g.name, 'Refund by vote: your money + yield', id), ...txs];
        } else {
          const out = part(v.who!);
          const share = total ? out / pot : 0;
          next = { ...g, vote: undefined, yieldEarned: g.yieldEarned * (1 - share), members: g.members.map(m => m.handle === v.who ? { ...m, put: 0 } : m) };
          if (v.who === me) { balance += out; txs = [tx('payout', out, g.name, 'You left by vote', id), ...txs]; }
        }
        return { ...x, balance, txs, goals: x.goals.map(q => q.id !== id ? q : next) };
      });
      return passed ? 'passed' : 'open';
    },
    setMix: m => setS(x => ({ ...x!, mix: m })),
    // demo: turn the rewards not used yet into the chosen mix at live prices
    buyRewards: p => {
      const x0 = accrue(s);
      const pending = Math.max(0, x0.earned - x0.converted);
      if (pending < 0.01) return 0;
      act(x => {
        const bag = { ...x.bag }, cost = { ...x.cost };
        (Object.keys(x.mix) as Asset[]).forEach(k => {
          const usdIn = pending * x.mix[k] / 100;
          bag[k] += usdIn / p[k];
          cost[k] += usdIn;
        });
        return { ...x, bag, cost, converted: x.converted + pending, balance: x.balance - pending,
          txs: [tx('in', pending, 'Rewards portfolio', `Bought ${x.mix.btc}% Bitcoin · ${x.mix.gold}% Gold via NEAR Intents`), ...x.txs] };
      });
      return pending;
    },
    toggleHide: () => setS(x => ({ ...x!, hide: !x!.hide })),
    reset: () => setS(empty()),
    saveReal: (kind, item) => setS(x => { const list = ((x as any)[kind] ?? []) as { id: string }[]; const has = list.some(q => q.id === item.id); return { ...x!, [kind]: has ? list.map(q => (q.id === item.id ? item : q)) : [item, ...list] }; }),
  };
  return <StoreCtx.Provider value={ctx}>{children}</StoreCtx.Provider>;
}

export const useStore = () => useContext(StoreCtx)!;
