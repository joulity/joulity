// Read-only NEAR mainnet calls. Balances come straight from the chain.
export const RPC = 'https://rpc.mainnet.fastnear.com';
export const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'; // native USDC on NEAR
export const EXPLORER = 'https://nearblocks.io/address/';

async function rpc(method: string, params: object) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'j', method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error?.cause?.name || j.error?.message || 'rpc error');
  return j.result;
}

// big integer string with `dec` decimals -> number (fine for display)
const units = (raw: string, dec: number) => {
  const s = raw.padStart(dec + 1, '0');
  return Number(`${s.slice(0, -dec)}.${s.slice(-dec)}`);
};

export type Chain = { exists: boolean; near: number; usdc: number; jusd: number; jusdRaw: string; price: number };

export async function balances(account: string): Promise<Chain> {
  let near = 0;
  let exists = true;
  try {
    const a = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: account });
    near = units(a.amount, 24);
  } catch (e) {
    // a new implicit account is not on chain until it receives its first deposit
    if (String((e as Error).message).includes('UNKNOWN_ACCOUNT')) exists = false;
    else throw e;
  }
  // USDC can arrive before the account exists (the sender pays the token storage)
  const args = btoa(JSON.stringify({ account_id: account }));
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: USDC, method_name: 'ft_balance_of', args_base64: args });
  const usdc = units(JSON.parse(String.fromCharCode(...r.result)), 6);
  let jusdRaw = '0', price = 1;
  try {
    const v = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: 'joulity-vault.near', method_name: 'ft_balance_of', args_base64: args });
    jusdRaw = JSON.parse(String.fromCharCode(...v.result));
    const i = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: 'joulity-vault.near', method_name: 'info', args_base64: btoa('{}') });
    price = Number(JSON.parse(String.fromCharCode(...i.result)).price) / 1e6;
  } catch {}
  return { exists, near, usdc, jusd: units(jusdRaw, 6), jusdRaw, price };
}

export const short = (a: string) => (a.length > 24 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
