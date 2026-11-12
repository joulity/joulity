// Add money from any chain with NEAR Intents (1Click API). No wallet connection needed:
// 1Click gives a one-time deposit address on the chosen chain; whatever lands there is swapped
// and sent as native USDC to the user's NEAR account. Nothing here signs or moves funds.
import { USDC } from './near';

const API = 'https://1click.chaindefuser.com/v0';
const TO = `nep141:${USDC}`;

export type Source = { key: string; chain: string; token: string; asset: string; decimals: number; color: string; price?: number };

// Joulity fee on each deposit, paid inside NEAR Intents to the Joulity account (bps: 10 = 0.1%)
export const FEE_TO = 'hatemaz2026.near';
export const STABLES = ['USDC', 'USDT', 'USDC.E', 'DAI', 'USD1', 'USDT0'];
export const feeBps = (src: Source) => (STABLES.includes(src.token.toUpperCase()) ? 10 : 30);
export const isStable = (src: Source) => STABLES.includes(src.token.toUpperCase());
// 1% for stablecoins; 3% for coins whose price moves, so a small dip does not freeze the swap for 3 days
export const slippageBps = (src: Source) => (isStable(src) ? 100 : 300);
/** 'Nov 13, 22:19' in the user's time */
export const when = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
export const usdValue = (src: Source, n: number) => n * (src.price ?? (STABLES.includes(src.token.toUpperCase()) ? 1 : 0));

const CHAIN: Record<string, string> = { eth: 'Ethereum', base: 'Base', sol: 'Solana', arb: 'Arbitrum', btc: 'Bitcoin', bsc: 'BNB Chain', pol: 'Polygon', op: 'Optimism', avax: 'Avalanche', tron: 'Tron', ton: 'TON', sui: 'Sui', xrp: 'XRP', doge: 'Dogecoin', ltc: 'Litecoin', bch: 'Bitcoin Cash', zec: 'Zcash', gnosis: 'Gnosis', bera: 'Berachain', aptos: 'Aptos', cardano: 'Cardano', stellar: 'Stellar', starknet: 'Starknet', monad: 'Monad', scroll: 'Scroll', plasma: 'Plasma', xlayer: 'X Layer', dash: 'Dash', hypercore: 'Hyperliquid' };
export const chainName = (c: string) => CHAIN[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

export const NEAR_KEY = 'near-native';
let all: Source[] | null = null;
/** Every coin NEAR Intents accepts, on every chain except NEAR itself. */
export async function allSources(): Promise<Source[]> {
  if (all) return all;
  const t: any[] = await (await fetch(`${API}/tokens`)).json();
  const w = t.find(x => x.assetId === 'nep141:wrap.near');
  const near: Source[] = w ? [{ key: NEAR_KEY, chain: 'NEAR', token: 'NEAR', asset: w.assetId, decimals: 24, color: '#00C08B', price: Number(w.price) }] : [];
  all = near.concat(t.filter(x => x.blockchain !== 'near' && x.price > 0).map(x => ({
    key: x.assetId, chain: chainName(x.blockchain), token: x.symbol, asset: x.assetId, decimals: x.decimals, color: '#2C5BD6', price: Number(x.price),
  })));
  return all;
}

export const SOURCES: Source[] = [
  { key: 'base', chain: 'Base', token: 'USDC', asset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6, color: '#2C5BD6' },
  { key: 'sol', chain: 'Solana', token: 'USDC', asset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', decimals: 6, color: '#6B5BD2' },
  { key: 'eth', chain: 'Ethereum', token: 'USDC', asset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', decimals: 6, color: '#111113' },
  { key: 'arb', chain: 'Arbitrum', token: 'USDC', asset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', decimals: 6, color: '#2F78BC' },
  { key: 'tron', chain: 'Tron', token: 'USDT', asset: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', decimals: 6, color: '#C8414B' },
  { key: 'pol', chain: 'Polygon', token: 'USDC', asset: 'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L', decimals: 6, color: '#7B4FD6' },
  { key: 'bsc', chain: 'BNB Chain', token: 'USDT', asset: 'nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g', decimals: 18, color: '#B7741A' },
  { key: 'op', chain: 'Optimism', token: 'USDC', asset: 'nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ', decimals: 6, color: '#C8414B' },
];

const toUnits = (v: number, d: number) => {
  const [a, b = ''] = v.toFixed(Math.min(d, 6)).split('.');
  return (a + b.padEnd(d, '0').slice(0, d)).replace(/^0+(?=\d)/, '');
};

export type Quote = { depositAddress: string; amountInRaw: string; amountIn: string; amountOut: number; minOut: number; seconds: number; expires: string };

/** dry = price only; otherwise 1Click opens a deposit address. Refunds go to the user's NEAR account inside NEAR Intents. */
export async function quote(src: Source, amount: number, recipient: string, dry: boolean): Promise<Quote> {
  const r = await fetch(`${API}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dry, swapType: dry ? 'EXACT_INPUT' : 'FLEX_INPUT', slippageTolerance: slippageBps(src),
      originAsset: src.asset, depositType: 'ORIGIN_CHAIN',
      destinationAsset: TO, amount: toUnits(dry ? amount : amount * 0.85, src.decimals),
      refundTo: recipient, refundType: 'INTENTS',
      recipient, recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 24 * 3600e3).toISOString(),
      referral: 'joulity', quoteWaitingTimeMs: 3000,
      appFees: [{ recipient: FEE_TO, fee: feeBps(src) }],
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.quote) throw new Error(j.message || 'No quote right now. Try another amount.');
  const q = j.quote;
  return {
    depositAddress: q.depositAddress ?? '', amountInRaw: q.amountIn, amountIn: dry ? q.amountInFormatted : String(amount),
    amountOut: Number(q.amountOutFormatted), minOut: Number(q.minAmountOut) / 1e6,
    seconds: q.timeEstimate ?? 60, expires: q.deadline ?? '',
  };
}

export type Status = 'PENDING_DEPOSIT' | 'KNOWN_DEPOSIT_TX' | 'PROCESSING' | 'SUCCESS' | 'INCOMPLETE_DEPOSIT' | 'REFUNDED' | 'FAILED';

export async function status(depositAddress: string): Promise<{ status: Status; out?: number; reason?: string }> {
  const r = await fetch(`${API}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  const j = await r.json();
  return { status: j.status, out: j.swapDetails?.amountOutFormatted ? Number(j.swapDetails.amountOutFormatted) : undefined, reason: j.swapDetails?.refundReason ?? undefined };
}
