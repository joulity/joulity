// Gasless calls: the user signs a NEAR "delegate action" (NEP-366) with their own Privy key,
// and the Joulity gas operator sends it and pays the gas. It can only reach Joulity contracts.
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { RPC, USDC } from './near';

export const VAULT = 'joulity-vault.near';
export const SOCIAL = 'joulity-social.near';
export const RELAY = 'https://app.api.joulity.com/relay';
const TGAS = 10n ** 12n;

class W {
  p: Uint8Array[] = [];
  u8(v: number) { this.p.push(Uint8Array.of(v)); return this; }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); this.p.push(b); return this; }
  u64(v: bigint) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); this.p.push(b); return this; }
  u128(v: bigint) { return this.u64(v & ((1n << 64n) - 1n)).u64(v >> 64n); }
  raw(b: Uint8Array) { this.p.push(b); return this; }
  str(s: string) { const b = new TextEncoder().encode(s); return this.u32(b.length).raw(b); }
  out() { const o = new Uint8Array(this.p.reduce((a, b) => a + b.length, 0)); let i = 0; for (const b of this.p) { o.set(b, i); i += b.length; } return o; }
}
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from((h.replace(/^0x/, '').match(/../g) ?? []).map(x => parseInt(x, 16)));
const b64 = (b: Uint8Array) => { let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s); };

export type Call = { method: string; args: object; gas?: number; deposit?: bigint };
export type Signer = (hash: `0x${string}`) => Promise<`0x${string}`>;   // Privy signRawHash
export type Result = { ok: boolean; hash?: string; value?: string | null; error?: string | null };

async function query(params: object) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { finality: 'final', ...params } }) });
  return r.json();
}

/** One gasless call from a Privy implicit account (address = hex public key). */
export async function gasless(sender: string, receiver: string, calls: Call[], sign: Signer): Promise<Result> {
  const pk = unhex(sender);
  if (pk.length !== 32) throw new Error('Only Joulity wallets can use free gas');
  const pub = `ed25519:${bs58.encode(pk)}`;
  const hasKey = (k: any) => k.result && !k.result.error && k.result.nonce !== undefined;
  let key = await query({ request_type: 'view_access_key', account_id: sender, public_key: pub });
  if (!hasKey(key)) {
    // first use: the gas operator opens the wallet on NEAR (needs >= 1 USDC in it)
    const o = await (await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open: sender }) })).json();
    if (!o.ok) throw new Error(o.error === 'needs at least 1 USDC' ? 'Add money first (at least $1).' : o.error || 'Could not open your account');
    for (let i = 0; i < 12 && !hasKey(key); i++) { await new Promise(res => setTimeout(res, 1500)); key = await query({ request_type: 'view_access_key', account_id: sender, public_key: pub }); }
    if (!hasKey(key)) throw new Error('NEAR is slow. Try again in a minute.');
  }
  const w = new W().str(sender).str(receiver).u32(calls.length);
  for (const c of calls) {
    const args = new TextEncoder().encode(JSON.stringify(c.args));
    w.u8(2).str(c.method).u32(args.length).raw(args).u64(BigInt(c.gas ?? 100) * TGAS).u128(c.deposit ?? 0n);
  }
  w.u64(BigInt(key.result.nonce) + 1n).u64(BigInt(key.result.block_height) + 200n).u8(0).raw(pk);
  const delegate = w.out();
  const hash = sha256(new W().u32(2 ** 30 + 366).raw(delegate).out());
  const sig = unhex(await sign(`0x${hex(hash)}`));
  if (sig.length !== 64) throw new Error('Signing failed');
  const signed = new W().raw(delegate).u8(0).raw(sig).out();
  const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signed: b64(signed) }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Could not send. Try again.');
  return j;
}

/** A normal NEAR transaction from the user's own account. The user pays the gas in NEAR (used to turn NEAR they hold into USDC). */
export async function direct(sender: string, receiver: string, calls: Call[], sign: Signer): Promise<Result> {
  const pk = unhex(sender);
  if (pk.length !== 32) throw new Error('Only Joulity wallets');
  const pub = `ed25519:${bs58.encode(pk)}`;
  const key = await query({ request_type: 'view_access_key', account_id: sender, public_key: pub });
  if (!key.result || key.result.error || key.result.nonce === undefined) throw new Error('Send NEAR to your account first.');
  const w = new W().str(sender).u8(0).raw(pk).u64(BigInt(key.result.nonce) + 1n).str(receiver).raw(bs58.decode(key.result.block_hash)).u32(calls.length);
  for (const c of calls) {
    const args = new TextEncoder().encode(JSON.stringify(c.args));
    w.u8(2).str(c.method).u32(args.length).raw(args).u64(BigInt(c.gas ?? 100) * TGAS).u128(c.deposit ?? 0n);
  }
  const tx = w.out();
  const sig = unhex(await sign(`0x${hex(sha256(tx))}`));
  if (sig.length !== 64) throw new Error('Signing failed');
  const signed = new W().raw(tx).u8(0).raw(sig).out();
  const j = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'send_tx', params: { signed_tx_base64: b64(signed), wait_until: 'EXECUTED_OPTIMISTIC' } }) })).json();
  if (j.error) { const d = JSON.stringify(j.error.data ?? j.error.cause ?? j.error); throw new Error("NEAR said: " + d.slice(0, 400)); }
  const fail = j.result.receipts_outcome.find((o: any) => o.outcome.status.Failure);
  return { ok: !fail, hash: j.result.transaction.hash, value: null, error: fail ? JSON.stringify(fail.outcome.status.Failure).slice(0, 300) : null };
}

const NEAR24 = (v: number) => { const [a, b = ''] = v.toFixed(6).split('.'); return BigInt(a) * 10n ** 24n + BigInt(b.padEnd(24, '0')); };
/** NEAR -> wNEAR -> the NEAR Intents deposit address (one signature). Keeps the storage registrations right. */
export const nearToIntents = (me: string, depositAddress: string, amount: string, sign: Signer) =>
  gasless(me, "wrap.near", [
    { method: 'storage_deposit', args: { account_id: me, registration_only: true }, gas: 15, deposit: NEAR24(0.00125) },
    { method: 'storage_deposit', args: { account_id: depositAddress, registration_only: true }, gas: 15, deposit: NEAR24(0.00125) },
    { method: 'near_deposit', args: {}, gas: 15, deposit: BigInt(amount) },
    { method: 'ft_transfer', args: { receiver_id: depositAddress, amount, memo: 'Joulity: NEAR to USDC' }, gas: 30, deposit: 1n },
  ], sign);

export type Target = { pocket?: number; goal?: number; circle?: number; reward?: number };
const ONE_YOCTO = 1n;
const units = (usd: number) => String(Math.round(usd * 1e6));

/** USDC in the wallet → vault. You get jUSD, which earns. */
export const toVault = (me: string, usd: number, sign: Signer) => toVaultUnits(me, units(usd), sign);
const toVaultUnits = (me: string, amount: string, sign: Signer) =>
  gasless(me, USDC, [{ method: 'ft_transfer_call', args: { receiver_id: VAULT, amount, msg: '' }, gas: 150, deposit: ONE_YOCTO }], sign);

/** jUSD → a pocket, goal or circle in the social contract. */
export const toSocial = (me: string, shares: string, target: Target, sign: Signer) =>
  gasless(me, VAULT, [{ method: 'ft_transfer_call', args: { receiver_id: SOCIAL, amount: shares, msg: JSON.stringify(target) }, gas: 150, deposit: ONE_YOCTO }], sign);

/** Any social method (create_pocket, create_goal, vote, withdraw_pocket…). */
export const social = (me: string, method: string, args: object, sign: Signer) =>
  gasless(me, SOCIAL, [{ method, args, gas: 100 }], sign);

/** jUSD → USDC back to the wallet. */
export const redeem = (me: string, shares: string, sign: Signer) =>
  gasless(me, VAULT, [{ method: 'redeem', args: { shares }, gas: 100 }], sign);

// ---------- pockets: the vault works behind them (the user never sees jUSD) ----------
export async function viewJson(account: string, method: string, args: object) {
  const r = await query({ request_type: 'call_function', account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  if (!r.result?.result) throw new Error('NEAR is slow, try again');
  return JSON.parse(String.fromCharCode(...r.result.result));
}
export const jusdOf = async (me: string) => BigInt(await viewJson(VAULT, 'ft_balance_of', { account_id: me }));
async function waitJusd(me: string, above: bigint) {
  for (let i = 0; i < 15; i++) { const b = await jusdOf(me); if (b > above) return b; await new Promise(r => setTimeout(r, 1500)); }
  throw new Error('The vault is slow. Your money is safe; try again in a minute.');
}

/** After a new sign-in: find this account's pockets on chain (pockets, goals and circles share one id counter). */
export async function findMyPockets(me: string) {
  const goals: { id: number; g: any }[] = [];
  const [info, out] = [await viewJson(VAULT, 'info', {}), [] as { chainId: number; name: string; target: number; deadline: number; mine: number; members: string[] }[]];
  const price = Number(info.price) / 1e6;
  for (let id = 1, miss = 0; miss < 8 && id < 500; id++) {
    const [p, g, c] = await Promise.all([viewJson(SOCIAL, 'get_pocket', { id }).catch(() => null), viewJson(SOCIAL, 'get_goal', { id }).catch(() => null), viewJson(SOCIAL, 'get_circle', { id }).catch(() => null)]);
    if (!p && !g && !c) { miss++; continue; } miss = 0;
    if (g && (g.organizer === me || (g.members ?? []).some((x: { account: string }) => x.account === me))) goals.push({ id, g });
    if (!p) continue;
    const members = (p.members ?? []) as { account: string; balance: string }[];
    const m = members.find((x) => x.account === me);
    if (!m && p.creator !== me) continue;
    out.push({ chainId: id, name: p.name, target: Number(p.target) / 1e6, deadline: Number(p.deadline) * 1000, mine: (Number(m?.balance ?? 0) / 1e6) * price, members: members.map((x) => x.account) });
  }
  return Object.assign(out, { goals, price });
}

/** New pocket on chain. Returns the pocket number. */
export async function newPocket(me: string, name: string, targetUsd: number, deadlineMs: number, sign: Signer) {
  const r = await social(me, 'create_pocket', { name, target: units(targetUsd), deadline: Math.floor(deadlineMs / 1000) }, sign);
  const id = Number(JSON.parse(r.value ?? 'null'));
  if (!Number.isFinite(id) || id <= 0) throw new Error('Pocket not created. Try again.');
  return id;
}

/** Save: USDC → vault (earns) → the pocket. Two signatures, no gas. */
export async function saveToPocket(me: string, pocket: number, usd: number, sign: Signer) {
  const before = await jusdOf(me);
  await toVault(me, usd, sign);
  const now = await waitJusd(me, before);
  await toSocial(me, (now - before).toString(), { pocket }, sign);
}

/** Take out: pocket → jUSD → USDC back in the wallet. */
export async function takeFromPocket(me: string, pocket: number, usd: number, sign: Signer) {
  const p = await viewJson(SOCIAL, 'get_pocket', { id: pocket });
  const mine = BigInt(p?.members?.find((m: { account: string }) => m.account === me)?.balance ?? '0');
  const info = await viewJson(VAULT, 'info', {});
  const price = BigInt(info.price);                                   // USDC per 1e6 jUSD
  let shares = (BigInt(Math.round(usd * 1e6)) * 1_000_000n) / price;
  if (shares > mine || mine - shares < 1000n) shares = mine;            // "take all" leaves no dust
  if (shares <= 0n) throw new Error('Nothing to take out');
  const before = await jusdOf(me);
  await social(me, 'withdraw_pocket', { id: pocket, amount: shares.toString() }, sign);
  const now = await waitJusd(me, before);
  await redeem(me, now.toString(), sign);
}

/** What I have in a pocket, in dollars (my jUSD × price). */
export async function pocketValue(me: string, pocket: number) {
  const [p, info] = await Promise.all([viewJson(SOCIAL, 'get_pocket', { id: pocket }), viewJson(VAULT, 'info', {})]);
  const mine = Number(p?.members?.find((m: { account: string }) => m.account === me)?.balance ?? '0');
  return (mine * Number(info.price)) / 1e12;
}

// ---------- circles, goals, reward circles (same path: USDC → vault → social) ----------
/** USDC per 1 jUSD, as a number (1.000000 at start, grows with the yield). */
export async function vaultPrice() { return Number((await viewJson(VAULT, 'info', {})).price) / 1e6; }
export const sharesFor = (usd: number, price: number) => BigInt(Math.round((usd * 1e6) / price));

/** Create something in the social contract; returns its number. */
export async function createSocial(me: string, method: string, args: object, sign: Signer) {
  const r = await social(me, method, args, sign);
  const id = Number(JSON.parse(r.value ?? 'null'));
  if (!Number.isFinite(id) || id <= 0) throw new Error('Not created. Try again.');
  return id;
}

/** Put dollars in (goal, reward circle): USDC → vault → target. */
export async function fundUsd(me: string, usd: number, target: Target, sign: Signer) {
  const before = await jusdOf(me);
  await toVault(me, usd, sign);
  const now = await waitJusd(me, before);
  await toSocial(me, (now - before).toString(), target, sign);
}

/** Pay an exact jUSD amount (a circle round): tops up from USDC only if needed. */
export async function payShares(me: string, shares: bigint, target: Target, sign: Signer) {
  const have = await jusdOf(me);
  if (have < shares) {
    const price = BigInt((await viewJson(VAULT, 'info', {})).price);
    const usdc = ((shares - have) * price + 999_999n) / 1_000_000n + 1n;   // round up, +1 unit
    await toVaultUnits(me, usdc.toString(), sign);
    await waitJusd(me, shares - 1n);
  }
  await toSocial(me, shares.toString(), target, sign);
}

export const getCircle = (id: number) => viewJson(SOCIAL, 'get_circle', { id });
export const getGoal = (id: number) => viewJson(SOCIAL, 'get_goal', { id });
export const getReward = (id: number) => viewJson(SOCIAL, 'get_reward_circle', { id });
export const getSaver = (id: number, account: string) => viewJson(SOCIAL, 'get_saver', { id, account });

/** NEAR -> wNEAR -> Rhea swap -> USDC back to the user. A normal transaction from the user's own account:
 *  NEAR attached inside a gasless (meta) transaction is paid by the gas operator, so here the user pays the gas (~0.003 NEAR). */
export const nearToUsdcDex = (me: string, amount: string, msg: string, sign: Signer) =>
  direct(me, 'wrap.near', [
    { method: 'storage_deposit', args: { account_id: me, registration_only: true }, gas: 5, deposit: NEAR24(0.00125) },
    { method: 'near_deposit', args: {}, gas: 5, deposit: BigInt(amount) },
    { method: 'ft_transfer_call', args: { receiver_id: 'v2.ref-finance.near', amount, msg }, gas: 150, deposit: 1n },
  ], sign);
