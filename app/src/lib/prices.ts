// Live prices of the reward assets, straight from the NEAR Intents token list (public, read-only).
import { useEffect, useState } from 'react';

export type Asset = 'usd' | 'btc' | 'gold';
export const ASSETS: { key: Asset; name: string; unit: string; icon: any; color: string; dim: string; id: string; risk: string }[] = [
  { key: 'usd', name: 'Dollars', unit: 'USDC', icon: 'dollar', color: '#0E8A63', dim: '#E3F1EA', id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', risk: 'Stable' },
  { key: 'btc', name: 'Bitcoin', unit: 'BTC', icon: 'btc', color: '#D9822B', dim: '#FBEFE2', id: 'nep141:nbtc.bridge.near', risk: 'Moves a lot' },
  { key: 'gold', name: 'Gold', unit: 'oz', icon: 'coins', color: '#B08D1E', dim: '#F6F0DC', id: 'nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near', risk: 'Moves a little' },
];

export type Prices = Record<Asset, number>;
let cache: { at: number; p: Prices } | null = null;

export async function prices(): Promise<Prices> {
  if (cache && Date.now() - cache.at < 60_000) return cache.p;
  const t: { assetId: string; price: number }[] = await (await fetch('https://1click.chaindefuser.com/v0/tokens')).json();
  const of = (id: string) => t.find(x => x.assetId === id)?.price ?? 0;
  const p = { usd: 1, btc: of(ASSETS[1].id), gold: of(ASSETS[2].id) };
  if (!p.btc || !p.gold) throw new Error('no price');
  cache = { at: Date.now(), p };
  return p;
}

export function usePrices() {
  const [p, setP] = useState<Prices | null>(cache?.p ?? null);
  useEffect(() => {
    let on = true;
    const load = () => prices().then(x => on && setP(x)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return p;
}
