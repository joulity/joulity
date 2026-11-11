// Swap NEAR -> USDC on Rhea (Ref Finance), the main DEX on NEAR. Best route from Rhea's smart router.
import { RPC, USDC } from './near';
export const REF = 'v2.ref-finance.near';
const ROUTER = 'https://smartrouter.ref.finance/findPath';
const SLIP = 0.01; // 1%: the swap happens in the same second, so the price cannot run away

export type DexQuote = { amountInRaw: string; amountOut: number; minOut: number; msg: string };
const yocto = (v: number) => { const [a, b = ''] = v.toFixed(6).split('.'); return (BigInt(a) * 10n ** 24n + BigInt(b.padEnd(24, '0'))).toString(); };

export async function dexQuote(near: number): Promise<DexQuote> {
  const raw = yocto(near);
  const j = await (await fetch(`${ROUTER}?amountIn=${raw}&tokenIn=wrap.near&tokenOut=${USDC}&pathDeep=2&slippage=${SLIP}`)).json();
  const d = j?.result_data;
  if (j?.result_code !== 0 || !d?.routes?.length) throw new Error('No price right now. Try again.');
  const actions: any[] = [];
  let min = 0n;
  for (const r of d.routes) r.pools.forEach((p: any, i: number) => {
    const last = i === r.pools.length - 1;
    actions.push({ pool_id: Number(p.pool_id), token_in: p.token_in, token_out: p.token_out, ...(i === 0 ? { amount_in: p.amount_in } : {}), min_amount_out: last ? p.min_amount_out : '0' });
    if (last) min += BigInt(p.min_amount_out);
  });
  if (min <= 0n) throw new Error('No price right now. Try again.');
  return { amountInRaw: raw, amountOut: Number(d.amount_out) / 1e6, minOut: Number(min) / 1e6, msg: JSON.stringify({ force: 0, actions }) };
}

export async function usdcRaw(account: string): Promise<bigint> {
  const args = btoa(JSON.stringify({ account_id: account }));
  const j = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'optimistic', account_id: USDC, method_name: 'ft_balance_of', args_base64: args } }) })).json();
  return BigInt(JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))));
}
