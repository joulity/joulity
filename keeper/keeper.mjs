// Joulity keeper: moves the vault's spare cash to Rhea and back, by itself.
// Its powers: vault manager (deploy to allow-listed strategies, bounded report) + keeper of joulity-lend.near
// (supply / withdraw on Rhea, return to the vault). It cannot send money to any other address.
// Checks every 10 minutes (read only, free). Sends a transaction only when there is something to do.
import fs from "node:fs";
import { createRequire } from "node:module";
import { pendleTick } from "./pendle.mjs";
const require = createRequire(import.meta.url);
const { connect, keyStores, KeyPair } = require("/home/ubuntu/joulity/dash/node_modules/near-api-js");

const ENV = Object.fromEntries(fs.readFileSync("/home/ubuntu/joulity/keeper/.env", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ME = ENV.KEEPER_ACCOUNT, PUB = ENV.KEEPER_PUBLIC_KEY;
const VAULT = "joulity-vault.near", LEND = "joulity-lend.near", BURROW = "contract.main.burrow.near", NAME = "rhea";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.lava.build"];
const STATUS = "/var/www/joulity-near/landing/dash/keeper/status.json";
const EVERY_MS = 10 * 60 * 1000;
const MIN = 1_000_000n;              // act only on 1 USDC or more
const REPORT_EVERY_S = 12 * 3600;    // report the Rhea value at least twice a day
const TG = (n) => BigInt(n) * 10n ** 12n;

let st = { account: ME, publicKey: PUB, everyMinutes: EVERY_MS / 60000, actions: [] };
try { const old = JSON.parse(fs.readFileSync(STATUS, "utf8")); st.actions = old.actions || []; if (old.pendle) st.pendle = old.pendle; if (old.lastDrop) st.lastDrop = old.lastDrop; } catch {}
const save = () => { fs.mkdirSync(STATUS.replace(/\/[^/]+$/, ""), { recursive: true }); fs.writeFileSync(STATUS + ".tmp", JSON.stringify(st, null, 1)); fs.renameSync(STATUS + ".tmp", STATUS); };
const note = (text, hash) => { st.actions.unshift({ t: new Date().toISOString(), text, hash }); st.actions = st.actions.slice(0, 30); console.log(text, hash || ""); save(); };

async function rpc(method, params) {
  let last;
  for (const u of RPCS) {
    try {
      const j = await (await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) })).json();
      if (j.result || j.error?.cause?.name === "UNKNOWN_ACCOUNT") return j;
      last = JSON.stringify(j.error).slice(0, 160);
    } catch (e) { last = e.message; }
  }
  throw new Error("RPC: " + last);
}
const q = (p) => rpc("query", { finality: "final", ...p });
async function view(id, m, a = {}) { const j = await q({ request_type: "call_function", account_id: id, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") }); return j.result ? JSON.parse(Buffer.from(j.result.result).toString()) : null; }
async function exists(id) { return !!(await q({ request_type: "view_account", account_id: id })).result; }
async function vaultManager() {
  const j = await q({ request_type: "view_state", account_id: VAULT, prefix_base64: Buffer.from("STATE").toString("base64") });
  const v = j.result.values.find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
  const b = Buffer.from(v.value, "base64"); let o = 0;
  const u32 = () => { const r = b.readUInt32LE(o); o += 4; return r; }, str = () => { const n = u32(); const s = b.slice(o, o + n).toString(); o += n; return s; };
  const pl = u32(); o += pl + 24; str(); str(); return str();   // token (prefix, supply, storage) -> usdc, owner, manager
}

let acc = null;
async function account() {
  if (acc) return acc;
  const ks = new keyStores.InMemoryKeyStore(); await ks.setKey("mainnet", ME, KeyPair.fromString(ENV.KEEPER_SECRET));
  acc = await (await connect({ networkId: "mainnet", nodeUrl: RPCS[0], keyStore: ks })).account(ME);
  return acc;
}
async function call(contractId, methodName, args, gasT, label) {
  const a = await account();
  try {
    const r = await a.functionCall({ contractId, methodName, args, gas: TG(gasT), attachedDeposit: 0n });
    const fail = JSON.stringify(r.receipts_outcome || []).match(/"Failure":\{.{0,200}/);
    note((fail ? "FAILED " : "") + label + (fail ? " " + fail[0] : ""), r.transaction.hash);
    return !fail;
  } catch (e) { note("FAILED " + label + ": " + String(e.message || e).slice(0, 200)); return false; }
}
const usd = (u) => (Number(u) / 1e6).toFixed(2);

async function tick() {
  st.lastCheck = new Date().toISOString(); st.error = null;
  // 1. is the keeper set up?
  const [hasMe, hasLend] = await Promise.all([exists(ME), exists(LEND)]);
  const cfg = hasLend ? await view(LEND, "config").catch(() => null) : null;
  const mgr = await vaultManager().catch(() => null);
  const strats = (await view(VAULT, "strategies")) || [];
  const s = strats.find((x) => x[0] === NAME)?.[1];
  st.ready = { keeperAccount: hasMe, lendKeeper: cfg?.keeper === ME, vaultManager: mgr === ME, strategy: !!s };
  st.keeperNear = hasMe ? Number(BigInt((await q({ request_type: "view_account", account_id: ME })).result.amount) / 10n ** 18n) / 1e6 : 0;
  if (!Object.values(st.ready).every(Boolean)) { st.state = "waiting for setup"; return save(); }
  const info = await view(VAULT, "info");
  if (info.paused) { st.state = "vault paused: doing nothing"; return save(); }
  st.state = "running";

  const total = BigInt(info.total_assets), floorNeed = (total * BigInt(info.floor_bps) + 9999n) / 10000n;
  const cash = BigInt(info.cash);
  const held = async () => BigInt((await view(USDC, "ft_balance_of", { account_id: LEND })) || "0");
  const lent = async () => { const r = await view(BURROW, "get_account", { account_id: LEND }); const x = r?.supplied?.find((y) => y.token_id === USDC); return x ? BigInt(x.balance) / 10n ** 12n : 0n; };
  let H = await held(), L = await lent();
  let moved = false;

  if (cash + MIN / 2n < floorNeed && H + L > 0n) {
    // 2. vault short of cash (people took money out) -> bring money back from Rhea
    const need = floorNeed - cash + 10_000n;
    if (H < need && L > 0n) { const w = need - H < L ? need - H : L; await call(LEND, "withdraw", { amount: w.toString() }, 250, `Rhea → strategy ${usd(w)} USDC (vault cash low)`); H = await held(); }
    const back = H < need ? H : need;
    if (back > 0n && await call(LEND, "to_vault", { amount: back.toString() }, 100, `Strategy → vault ${usd(back)} USDC`)) moved = true;
  } else {
    // 3. spare cash above the floor -> Rhea (within the strategy cap)
    const byFloor = cash - floorNeed, byCap = (total * BigInt(s.cap_bps)) / 10000n - BigInt(s.value);
    let amt = byFloor < byCap ? byFloor : byCap; amt = (amt / 10_000n) * 10_000n;
    // Pendle first (owner choice 11-10): while the Pendle strategy still has room under its cap, Rhea waits; the Pendle module deploys.
    const pS = (await view(VAULT, "strategies") || []).find((x) => x[0] === "pendle")?.[1];
    const pRoom = pS ? (total * BigInt(pS.cap_bps)) / 10000n - BigInt(pS.value) : 0n;
    if (pRoom >= MIN && st.pendle?.ready && Object.values(st.pendle.ready).every(Boolean)) amt = 0n;
    if (amt >= MIN && await call(VAULT, "deploy", { name: NAME, amount: amt.toString() }, 100, `Vault → Rhea strategy ${usd(amt)} USDC`)) { moved = true; H = await held(); }
    // 4. USDC sitting in the strategy -> supplied on Rhea
    if (H >= MIN && await call(LEND, "supply", { amount: H.toString() }, 200, `Supply ${usd(H)} USDC on Rhea`)) moved = true;
  }

  // 5. report the value (held + lent) so jUSD shows the interest
  // Reads right after our own moves can lag (final view): wait, and never report a drop in the same check as a move.
  if (moved) await new Promise((r) => setTimeout(r, 8000));
  const s2 = ((await view(VAULT, "strategies")) || []).find((x) => x[0] === NAME)?.[1];
  const value = (await held()) + (await lent()), book = BigInt(s2.value);
  const age = Math.floor(Date.now() / 1000) - Number(s2.reported_at);
  // Lending on Rhea cannot lose money in normal times: a drop must be seen in 2 checks in a row before we report it.
  const drop = value < book;
  const dropOk = drop && !moved && st.lastDrop === book.toString();
  st.lastDrop = drop && !moved ? book.toString() : null;
  const stale = value > book && (value - book) * 1000n > book;   // book more than 0.1% below the real value
  if (value !== book && (!drop || dropOk) && (moved || stale || age >= REPORT_EVERY_S || dropOk)) {
    const allowed = 1_000_000n + (book * 50n * BigInt(Math.min(age, 30 * 86400))) / (10000n * 86400n) - 1n;
    let v = value;
    if (v > book + allowed) v = book + allowed;
    if (v + allowed < book) v = book - allowed;
    await call(VAULT, "report", { name: NAME, value: v.toString() }, 30, `Report Rhea value ${usd(book)} → ${usd(v)} USDC`);
  }
  // 6. Pendle on Ethereum (after Rhea took its share). Its errors never stop the Rhea part.
  try { await pendleTick({ view, account, note, st, me: ME, keeperNear: st.keeperNear }); }
  catch (e) { st.pendle = { ...(st.pendle || {}), state: "error: " + String(e.message || e).slice(0, 160) }; console.error(e); }
  const i2 = await view(VAULT, "info");
  st.snapshot = { vaultTotal: i2.total_assets, vaultCash: i2.cash, price: i2.price, held: (await held()).toString(), lent: (await lent()).toString() };
  save();
  await history(i2).catch((e) => console.error("history", e.message));
}

// ---------- history for the public dashboard (/vault): real numbers + a paper run at the same live rates ----------
const HIST = "/var/www/joulity-near/landing/dash/keeper/history.json";
const PENDLE_MARKET = "0xd44f2630260ff3805d7cb317d4f6740b0044c408";   // PT-siUSD on Ethereum (the allowed market)
const PAPER_START = 10_000;                                           // simulated dollars
async function rates() {
  let rhea = null, pendle = null;
  try { const a = await view(BURROW, "get_asset", { token_id: USDC }); rhea = Number(a.supply_apr); } catch {}
  try { const j = await (await fetch(`https://api-v2.pendle.finance/core/v1/1/markets/${PENDLE_MARKET}`, { signal: AbortSignal.timeout(15000) })).json(); pendle = Number(j.impliedApy ?? j.details?.impliedApy); } catch {}
  return { rhea: Number.isFinite(rhea) ? rhea : null, pendle: Number.isFinite(pendle) ? pendle : null };
}
async function history(info) {
  let h = { paper: null, points: [] };
  try { h = JSON.parse(fs.readFileSync(HIST, "utf8")); } catch {}
  const now = Date.now();
  const last = h.points[h.points.length - 1];
  if (last && now - last.t < 9 * 60e3) return;                       // one point per check
  const strats = Object.fromEntries(((await view(VAULT, "strategies")) || []).map(([k, v]) => [k, v.value]));
  const r = await rates();
  // paper: same rules as the real vault (20% cash, 60% Rhea, 20% Pendle), live rates, simulated money
  const yr = 365 * 86400e3;
  if (!h.paper) h.paper = { start: now, value: PAPER_START, cash: 0.2, rhea: 0.6, pendle: 0.2 };
  else if (last) {
    const dt = (now - last.t) / yr;
    const g = h.paper.rhea * (r.rhea ?? last.rheaApr ?? 0) + h.paper.pendle * (r.pendle ?? last.pendleApy ?? 0);
    h.paper.value *= 1 + g * dt;
  }
  h.points.push({ t: now, total: info.total_assets, cash: info.cash, supply: info.supply, price: info.price, rhea: strats.rhea ?? "0", pendle: strats.pendle ?? "0", rheaApr: r.rhea, pendleApy: r.pendle, paper: Math.round(h.paper.value * 100) / 100 });
  if (h.points.length > 6000) h.points = h.points.filter((p, i) => i % 2 === 0 || i > h.points.length - 1000);   // thin old points
  fs.writeFileSync(HIST + ".tmp", JSON.stringify(h)); fs.renameSync(HIST + ".tmp", HIST);
}

async function loop() {
  try { await tick(); } catch (e) { st.error = String(e.message || e).slice(0, 200); console.error(e); save(); }
  // fast mode: every minute while money is on the move (bridge / gas / buy), else every 10 min
  const p = st.pendle || {};
  const busy = !!(p.bridge || p.gas || p.road) || /ready|bridging|buying|waiting for ETH|approve/i.test(p.state || "");
  const next = busy ? 60 * 1000 : EVERY_MS;
  st.fast = busy;
  st.nextCheck = new Date(Date.now() + next).toISOString(); save();
  setTimeout(loop, next);
}
loop();
