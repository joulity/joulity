// Joulity gas operator (NEP-366 meta transactions).
// The user signs a DelegateAction with their own key. We check it is a call to OUR contracts only,
// wrap it in a transaction signed by joulity-gas.near and pay the gas. We can't change what the user signed.
import http from "node:http";
import fs from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";

const ENV = Object.fromEntries(fs.readFileSync("/home/ubuntu/joulity/relayer/.env", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ME = ENV.RELAYER_ACCOUNT;
const SEED = bs58.decode(ENV.RELAYER_SECRET.replace("ed25519:", "")).slice(0, 32);
const MY_PK = ed25519.getPublicKey(SEED);
if (`ed25519:${bs58.encode(MY_PK)}` !== ENV.RELAYER_PUBLIC_KEY) throw new Error("key mismatch");

const PORT = 7520;
const RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.lava.build"];
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const VAULT = "joulity-vault.near";
const SOCIAL = "joulity-social.near";
const WNEAR = "wrap.near";
const STORAGE = 1_250_000_000_000_000_000_000n;          // 0.00125 NEAR
const isIntentsDeposit = (id) => /^[0-9a-f]{64}$/.test(String(id));
// deposit rule per method: how much NEAR (from the USER's own account) the action may attach
const isRefSwap = (m) => { try { const x = JSON.parse(m); return Array.isArray(x.actions) && x.actions.length > 0 && x.actions.length <= 8 && !x.swap_out_recipient && x.actions.every((y) => Number.isInteger(y.pool_id)); } catch { return false; } };
const DEPOSIT = {
  // NEP-366: NEAR attached inside a meta transaction is paid by US (the relayer), not the user. So: never more than 1 yocto.
  [WNEAR]: { ft_transfer: (d) => d <= 1n, ft_transfer_call: (d) => d <= 1n },
};
const ALLOW = {
  [WNEAR]: {
    storage_deposit: (a) => a.registration_only === true,
    near_deposit: () => true,
    ft_transfer: (a) => isIntentsDeposit(a.receiver_id),
    ft_transfer_call: (a) => a.receiver_id === "v2.ref-finance.near" && isRefSwap(a.msg),
  },
  [USDC]: { ft_transfer_call: (a) => a.receiver_id === VAULT && a.msg === "" },
  [VAULT]: { ft_transfer_call: (a) => a.receiver_id === SOCIAL, redeem: () => true },
  [SOCIAL]: Object.fromEntries("create_pocket withdraw_pocket create_circle join_circle start_circle payout create_goal propose vote claim_refund create_reward_circle boost claim_reward leave_reward_circle".split(" ").map((m) => [m, () => true])),
};
const MAX_GAS = 300n * 10n ** 12n;
const DUST = 10n ** 20n;          // 0.0001 NEAR once per account so it can attach the 1 yocto NEAR tokens require
const OPEN = 3n * 10n ** 21n;      // 0.003 NEAR: opens a new Joulity (implicit) account so it can sign; covers its storage
const OPEN_IP_DAY = 5;
const PER_ACCOUNT_DAY = 60, PER_IP_DAY = 200, ALL_DAY = 3000;

// ---------- borsh ----------
class R {
  constructor(b) { this.b = b; this.o = 0; }
  u8() { return this.b[this.o++]; }
  u32() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 4).getUint32(0, true); this.o += 4; return v; }
  u64() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.o, 8).getBigUint64(0, true); this.o += 8; return v; }
  u128() { const lo = this.u64(), hi = this.u64(); return (hi << 64n) | lo; }
  bytes(n) { const v = this.b.slice(this.o, this.o + n); this.o += n; return v; }
  str() { return new TextDecoder().decode(this.bytes(this.u32())); }
}
class W {
  constructor() { this.p = []; }
  u8(v) { this.p.push(Uint8Array.of(v)); return this; }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); this.p.push(b); return this; }
  u64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); this.p.push(b); return this; }
  u128(v) { v = BigInt(v); return this.u64(v & ((1n << 64n) - 1n)).u64(v >> 64n); }
  raw(b) { this.p.push(b); return this; }
  str(s) { const b = new TextEncoder().encode(s); return this.u32(b.length).raw(b); }
  out() { const n = this.p.reduce((a, b) => a + b.length, 0), o = new Uint8Array(n); let i = 0; for (const b of this.p) { o.set(b, i); i += b.length; } return o; }
}
function decodeSignedDelegate(buf) {
  const r = new R(buf);
  const start = r.o;
  const d = { sender: r.str(), receiver: r.str(), actions: [] };
  const n = r.u32();
  for (let i = 0; i < n; i++) {
    const tag = r.u8();
    if (tag !== 2) throw new Error("only function calls are allowed");
    const method = r.str(), args = r.bytes(r.u32()), gas = r.u64(), deposit = r.u128();
    d.actions.push({ method, args, gas, deposit });
  }
  d.nonce = r.u64(); d.maxHeight = r.u64();
  if (r.u8() !== 0) throw new Error("ed25519 keys only");
  d.pk = r.bytes(32);
  d.raw = buf.slice(start, r.o);
  if (r.u8() !== 0) throw new Error("ed25519 signature only");
  d.sig = r.bytes(64);
  if (r.o !== buf.length) throw new Error("extra bytes");
  return d;
}

// ---------- rpc ----------
async function rpc(method, params) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(method === "send_tx" ? 60000 : 10000) });
      const j = await r.json();
      if (j.result || j.error?.cause?.name === "UNKNOWN_ACCOUNT" || j.error?.cause?.name === "UNKNOWN_ACCESS_KEY") return j;
      if (j.error && method === "send_tx") return j;
      last = JSON.stringify(j.error).slice(0, 200);
    } catch (e) { last = e.message; }
  }
  throw new Error("RPC: " + last);
}
const view = async (account, m, args) => {
  const j = await rpc("query", { request_type: "call_function", finality: "final", account_id: account, method_name: m, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(j.result.result).toString());
};

let myNonce = null;
let queue = Promise.resolve();
async function send(receiver, actionsBytes) {        // actionsBytes: array of already-encoded Action
  const run = async () => {
    const k = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: ME, public_key: ENV.RELAYER_PUBLIC_KEY });
    myNonce = BigInt(Math.max(Number(k.result.nonce), Number(myNonce ?? 0))) + 1n;
    const w = new W().str(ME).u8(0).raw(MY_PK).u64(myNonce).str(receiver).raw(bs58.decode(k.result.block_hash)).u32(actionsBytes.length);
    for (const a of actionsBytes) w.raw(a);
    const tx = w.out();
    const sig = ed25519.sign(sha256(tx), SEED);
    const signed = new W().raw(tx).u8(0).raw(sig).out();
    return rpc("send_tx", { signed_tx_base64: Buffer.from(signed).toString("base64"), wait_until: "EXECUTED_OPTIMISTIC" });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---------- limits ----------
const STATE = "/home/ubuntu/joulity/relayer/state.json";
let st = { day: "", acct: {}, ip: {}, all: 0, dusted: {}, opened: {}, openIp: {} };
try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
st.opened ??= {}; st.openIp ??= {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(st));
function count(acct, ip) {
  const day = new Date().toISOString().slice(0, 10);
  if (st.day !== day) { st.day = day; st.acct = {}; st.ip = {}; st.all = 0; st.openIp = {}; }
  if ((st.acct[acct] ?? 0) >= PER_ACCOUNT_DAY) throw new Error("daily limit for this account");
  if ((st.ip[ip] ?? 0) >= PER_IP_DAY) throw new Error("daily limit");
  if (st.all >= ALL_DAY) throw new Error("gas budget for today is used up");
  st.acct[acct] = (st.acct[acct] ?? 0) + 1; st.ip[ip] = (st.ip[ip] ?? 0) + 1; st.all++; save();
}

// ---------- the relay ----------
async function relay(b64, ip) {
  const buf = new Uint8Array(Buffer.from(b64, "base64"));
  if (buf.length > 4000) throw new Error("too big");
  const d = decodeSignedDelegate(buf);
  // 1. only our contracts, only allowed methods, at most 1 yocto attached
  const rules = ALLOW[d.receiver];
  if (!rules) throw new Error("not a Joulity contract");
  let gas = 0n;
  for (const a of d.actions) {
    const ok = rules[a.method];
    let args; try { args = JSON.parse(new TextDecoder().decode(a.args)); } catch { throw new Error("bad args"); }
    if (!ok || !ok(args)) throw new Error(`not allowed: ${a.method}`);
    const dr = DEPOSIT[d.receiver]?.[a.method];
    if (dr ? !dr(a.deposit) : a.deposit > 1n) throw new Error("no NEAR deposits");
    gas += a.gas;
  }
  if (!d.actions.length || gas > MAX_GAS) throw new Error("bad gas");
  // 2. the signature is the user's own
  const msg = new W().u32(2 ** 30 + 366).raw(d.raw).out();
  if (!ed25519.verify(d.sig, sha256(msg), d.pk)) throw new Error("bad signature");
  const pk = `ed25519:${bs58.encode(d.pk)}`;
  const key = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: d.sender, public_key: pk });
  if (!key.result || key.result.error || key.result.nonce === undefined) throw new Error("this key is not on the account (deposit first)");
  if (d.nonce <= BigInt(key.result.nonce)) throw new Error("old nonce, try again");
  if (d.maxHeight <= BigInt(key.result.block_height)) throw new Error("expired, try again");
  // 3. only people who have money in Joulity (stops spam)
  const [u, j] = await Promise.all([view(USDC, "ft_balance_of", { account_id: d.sender }), view(VAULT, "ft_balance_of", { account_id: d.sender }).catch(() => "0")]);
  if (BigInt(u) + BigInt(j) < 1_000_000n && !(d.receiver === SOCIAL)) throw new Error("needs at least 1 USDC");
  count(d.sender, ip);
  // 4. tiny NEAR once, so the account can attach the 1 yocto token transfers need
  const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: d.sender });
  if (acc.result && BigInt(acc.result.amount) < 1000n && d.actions.some((a) => a.deposit > 0n) && !st.dusted[d.sender]) {
    const t = await send(d.sender, [new W().u8(3).u128(DUST).out()]);
    if (t.error) throw new Error("could not prepare the account");
    st.dusted[d.sender] = Date.now(); save();
  }
  // 5. send it, we pay the gas
  const r = await send(d.sender, [new W().u8(8).raw(buf).out()]);
  if (r.error) { const d = JSON.stringify(r.error.data ?? r.error.cause ?? r.error); console.error("relay error", d.slice(0, 800)); throw new Error((r.error.cause?.name || "send failed") + ": " + d.slice(0, 300)); }
  const res = r.result;
  const outs = res.receipts_outcome.filter((o) => o.outcome.executor_id === d.receiver);
  const fail = res.receipts_outcome.find((o) => o.outcome.status.Failure);
  const val = outs.map((o) => o.outcome.status.SuccessValue).find((v) => v);
  return { ok: !fail, hash: res.transaction.hash, value: val ? Buffer.from(val, "base64").toString() : null, error: fail ? JSON.stringify(fail.outcome.status.Failure).slice(0, 300) : null };
}

// A Joulity wallet is a NEAR "implicit" account (address = its public key). Money in USDC does not create it,
// so it cannot sign yet. We open it once with 0.003 NEAR, only if it already holds >= 1 USDC.
async function open(id, ip) {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("not a Joulity wallet");
  const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
  if (acc.result) return { ok: true, already: true };
  if (st.opened[id]) throw new Error("already opened, wait a few seconds");
  const u = await view(USDC, "ft_balance_of", { account_id: id });
  if (BigInt(u) < 1_000_000n) throw new Error("needs at least 1 USDC");
  count(id, ip);
  const day = new Date().toISOString().slice(0, 10);
  if ((st.openIp[ip] ?? 0) >= OPEN_IP_DAY) throw new Error("daily limit");
  st.openIp[ip] = (st.openIp[ip] ?? 0) + 1; st.opened[id] = Date.now(); save();
  const t = await send(id, [new W().u8(3).u128(OPEN).out()]);
  if (t.error) { delete st.opened[id]; save(); throw new Error("could not open the account"); }
  return { ok: true, hash: t.result.transaction.hash };
}

http.createServer(async (req, res) => {
  const ip = (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0];
  const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }); res.end(JSON.stringify(obj)); };
  if (req.method === "OPTIONS") return reply(204, {});
  if (req.method === "GET") {
    const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: ME }).catch(() => null);
    return reply(200, { relayer: ME, near: a?.result ? Number(BigInt(a.result.amount) / 10n ** 20n) / 1e4 : null, today: st.day === new Date().toISOString().slice(0, 10) ? st.all : 0 });
  }
  if (req.method !== "POST") return reply(405, { error: "POST" });
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 10000) req.destroy(); });
  req.on("end", async () => {
    try { const j = JSON.parse(body); reply(200, j.open ? await open(String(j.open), ip) : await relay(j.signed, ip)); }
    catch (e) { reply(400, { ok: false, error: e.message }); }
  });
}).listen(PORT, "127.0.0.1", () => console.log("gas operator on", PORT, "as", ME));
