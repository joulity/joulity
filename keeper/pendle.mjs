// Joulity keeper, Pendle on Ethereum: vault -> joulity-pendle.near -> NEAR Intents -> Ethereum address (Chain Signatures) -> Pendle PT.
// The keeper can only: deploy from the vault to this strategy, bridge IN to a NEAR Intents deposit address,
// approve USDC to the Pendle router, buy PT for the strategy's own address, report a bounded value.
// The way back (sell PT, bridge to NEAR) stays with the owner.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keccak_256 } = require("/home/ubuntu/joulity/dash/node_modules/@noble/hashes/sha3");
const { secp256k1 } = require("/home/ubuntu/joulity/dash/node_modules/@noble/curves/secp256k1");
const { transactions } = require("/home/ubuntu/joulity/dash/node_modules/near-api-js");

// ETHEREUM version on the existing joulity-pendle.near. Its bridge_out is owner only.
// HACKATHON: the owner made the keeper the owner, so the keeper bridges itself (only to a NEAR Intents deposit address, by this code).
// Product later: a keeper ROLE in the contract that may bridge only to known addresses (no owner rights).
// Give ownership back: write the account in /home/ubuntu/joulity/keeper/pendle-owner-back (or "back" = the previous owner).
const PENDLE = "joulity-pendle.near", VAULT = "joulity-vault.near", NAME = "pendle", CHAIN = 1;
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const B_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", ROUTER = "0x888888888889758f76e7103c6cbf23abbf58f946";
const A_NUSDC = "nep141:" + USDC, A_BUSDC = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", A_BETH = "nep141:eth.omft.near";
const ERPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"];
const ONECLICK = "https://1click.chaindefuser.com/v0", PAPI = "https://api-v2.pendle.finance/core";
const MIN = 1_000_000n;                     // buy PT with 1 USDC or more once it is on Ethereum
const BATCH = 1_000_000n;                   // demo: move any $1+ (the bridge to Ethereum costs ~$0.30, accepted for the demo)
const OWNER_BACK = "/home/ubuntu/joulity/keeper/pendle-owner-back";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
const MIN_ETH = 80_000_000_000_000n;       // 0.0001 ETH: enough for approve + a few PT buys at today's ~0.06 gwei (test size)
const GAS_NEAR = 250_000_000_000_000_000_000_000n; // 0.25 NEAR (~$0.90, ~$0.30 goes to the bridge) of the keeper's own NEAR -> ETH on Ethereum
const KEEPER_NEAR_MIN = 0.6;                 // 0.25 for ETH gas + ~0.33 held while a 300 TGas sign_eth runs (refunded)
const REPORT_EVERY_S = 12 * 3600;
const MAX_GWEI = 3;                         // owner 11-10: do not wait for cheap gas for the demo, skip only spikes above 3 gwei
const MAXU = "f".repeat(64);
const TG = (n) => BigInt(n) * 10n ** 12n;
const hexb = (b) => Buffer.from(b).toString("hex");
const unhex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const word = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const usd = (u) => (Number(u) / 1e6).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Ethereum reads ----------
async function eth(method, params = []) {
  let last;
  for (const u of ERPCS) {
    try {
      const j = await (await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) })).json();
      if ("result" in j) return j.result;
      last = new Error(j.error?.message || "base rpc");
      if (method === "eth_sendRawTransaction" || method === "eth_estimateGas") throw last;
    } catch (e) { last = e; if (method === "eth_sendRawTransaction" || method === "eth_estimateGas") throw e; }
  }
  throw last;
}
const erc20 = async (token, data) => BigInt(await eth("eth_call", [{ to: token, data }, "latest"]));
const balOf = (token, who) => erc20(token, "0x70a08231" + word(who));
const allowance = (token, owner, spender) => erc20(token, "0xdd62ed3e" + word(owner) + word(spender));

// ---------- RLP / EIP-1559 (same as the contract) ----------
const be = (n) => { n = BigInt(n); if (n === 0n) return new Uint8Array(); let h = n.toString(16); if (h.length % 2) h = "0" + h; return unhex(h); };
const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
const rlen = (len, short) => (len <= 55 ? Uint8Array.of(short + len) : cat(Uint8Array.of(short + 55 + be(len).length), be(len)));
const rb = (b) => (b.length === 1 && b[0] < 0x80 ? b : cat(rlen(b.length, 0x80), b));
const rl = (items) => { const p = cat(...items); return cat(rlen(p.length, 0xc0), p); };
const fields = (t) => [rb(be(CHAIN)), rb(be(t.nonce)), rb(be(t.max_priority_fee)), rb(be(t.max_fee)), rb(be(t.gas)), rb(unhex(t.to)), rb(be(0)), rb(unhex(t.data)), rl([])];
const unsigned = (t) => cat(Uint8Array.of(2), rl(fields(t)));
const signedRaw = (t, y, r, s) => "0x02" + hexb(rl([...fields(t), rb(be(y)), rb(be("0x" + r)), rb(be("0x" + s))]));

// ---------- 1Click ----------
async function quote(o) {
  // slippage: NEAR price moves and solvers skip tiny orders at 1%, so: 3% when NEAR is sold, 2% for stable -> stable (cents on demo sizes)
  const slip = o.originAsset === "nep141:wrap.near" ? 300 : 200;
  const body = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: slip, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", deadline: new Date(Date.now() + 3600e3).toISOString(), referral: "joulity", quoteWaitingTimeMs: 3000, ...o };
  const j = await (await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  if (!j.quote?.depositAddress) throw new Error("1Click: " + (j.message || "no quote"));
  return j.quote;
}
const submit = (txHash, depositAddress) => fetch(`${ONECLICK}/deposit/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash, depositAddress }) }).catch(() => {});
const bridgeStatus = async (dep) => (await (await fetch(`${ONECLICK}/status?depositAddress=${dep}`)).json()).status;

// ---------- Pendle ----------
async function convert(me, tokenIn, amountIn, tokenOut) {
  const u = `${PAPI}/v2/sdk/${CHAIN}/convert?receiver=${me}&slippage=0.005&enableAggregator=true&tokensIn=${tokenIn}&amountsIn=${amountIn}&tokensOut=${tokenOut}`;
  const j = await (await fetch(u)).json();
  const r = j.routes?.[0];
  if (!r?.tx) throw new Error("Pendle: " + (j.message || "no route"));
  return { tx: r.tx, out: BigInt(r.outputs[0].amount) };
}
async function marketOf(cfg) {
  const j = await (await fetch(`${PAPI}/v1/${CHAIN}/markets/active`)).json();
  const ms = (j.markets || []).map((m) => ({ name: m.name, market: m.address.toLowerCase(), pt: m.pt.split("-")[1].toLowerCase(), expiry: m.expiry }));
  return ms.find((m) => cfg.markets.includes(m.market) && cfg.tokens.includes(m.pt)) || null;
}

/**
 * One Pendle check. ctx = { view, account, note, st, info } from keeper.mjs.
 * Returns true if something moved.
 */
export async function pendleTick(ctx) {
  const { view, note } = ctx;
  const P = (ctx.st.pendle ??= {});
  const save = (state, last) => { P.state = state; if (last) P.lastAction = last; };
  const acc = await ctx.account();
  const call = async (contractId, methodName, args, gasT, deposit, label) => {
    try {
      const r = await acc.functionCall({ contractId, methodName, args, gas: TG(gasT), attachedDeposit: BigInt(deposit) });
      const fail = JSON.stringify(r.receipts_outcome || []).match(/"Failure":\{.{0,200}/);
      note((fail ? "FAILED " : "") + label + (fail ? " " + fail[0] : ""), r.transaction.hash);
      P.lastAction = label;
      return fail ? null : r;
    } catch (e) { note("FAILED " + label + ": " + String(e.message || e).slice(0, 200)); return null; }
  };

  // 1. set up?
  const cfg = await view(PENDLE, "config").catch(() => null);
  const strat = ((await view(VAULT, "strategies")) || []).find((x) => x[0] === NAME)?.[1];
  const iOwn = cfg?.owner === ctx.me;
  if (cfg && !iOwn) P.humanOwner = cfg.owner;
  // give ownership back on request (file written by the admin on the server)
  if (iOwn && existsSync(OWNER_BACK)) {
    let to = readFileSync(OWNER_BACK, "utf8").trim(); if (!to || to === "back") to = P.humanOwner;
    if (to && to !== ctx.me && await call(PENDLE, "set_owner", { owner: to }, 20, 0, `Ownership of Pendle → ${to}`)) { try { unlinkSync(OWNER_BACK); } catch {} return save("ownership given back"), true; }
  }
  const OWNER_BRIDGE = !iOwn; // owner is a person: they tap Bridge; owner is the keeper: it bridges itself
  P.bridgeBy = iOwn ? "keeper (automatic)" : "owner (one tap)";
  P.ready = { contract: !!cfg, keeper: cfg?.keeper === ctx.me || iOwn, strategy: !!strat, baseAddress: !!cfg?.eth_address, market: !!cfg?.markets?.length };
  if (!Object.values(P.ready).every(Boolean)) return save("waiting for setup"), false;
  const me = cfg.eth_address;
  const m = await marketOf(cfg);
  if (!m) return save("no allowed market is active (matured?) - owner picks a new one"), false;
  P.market = `${m.name} until ${m.expiry.slice(0, 10)}`;

  // 2. bridges in flight: wait for them, never report while money is on the road
  for (const k of ["bridge", "gas"]) {
    if (!P[k]) continue;
    const s = await bridgeStatus(P[k].dep).catch(() => "?");
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(s)) { note(`Bridge ${k}: ${s}`); P[k] = null; }
    else if (Date.now() - P[k].t > 6 * 3600e3) { note(`Bridge ${k} still ${s} after 6h - check it (dep ${P[k].dep})`); P[k].t = Date.now(); }
  }
  if (P.bridge) return save(`bridging ${usd(P.bridge.amount)} USDC to Ethereum`), false;

  let moved = false;
  const nUsdc = () => view(USDC, "ft_balance_of", { account_id: PENDLE }).then((x) => BigInt(x || "0"));
  let [N, E, ethBal, pt] = await Promise.all([nUsdc(), balOf(B_USDC, me), eth("eth_getBalance", [me, "latest"]).then(BigInt), balOf(m.pt, me)]);

  // 3. vault cash above the floor (after Rhea took its share) -> this strategy, within its cap
  const info = await view(VAULT, "info");
  if (!info.paused) {
    const total = BigInt(info.total_assets), floorNeed = (total * BigInt(info.floor_bps) + 9999n) / 10000n, cash = BigInt(info.cash);
    const byFloor = cash - floorNeed, byCap = (total * BigInt(strat.cap_bps)) / 10000n - BigInt(strat.value);
    let amt = byFloor < byCap ? byFloor : byCap; amt = (amt / 10_000n) * 10_000n;
    if (amt >= BATCH && N < MIN && await call(VAULT, "deploy", { name: NAME, amount: amt.toString() }, 100, 0, `Vault → Pendle strategy ${usd(amt)} USDC`)) { moved = true; await sleep(6000); N = await nUsdc(); }
  }

  // 4. USDC on NEAR -> Ethereum (NEAR Intents)
  // the owner bridged since the last check: money is on the road, do not report until it lands (max 2h)
  // the fast path (inside NEAR Intents) in progress: resume it step by step, never report while money is in it
  if (P.ib) {
    const done = await intentsResume(ctx, call, P, E);
    if (!done) return save(`moving ${usd(P.ib.amount)} USDC to Ethereum via NEAR Intents (${P.ib.stage})`), true;
  }
  if (OWNER_BRIDGE && P.ownerBridge && N < MIN) P.road = { amount: P.ownerBridge, base: "0", t: Date.now() };
  if (P.road && ((E - BigInt(P.road.base || "0")) * 100n >= BigInt(P.road.amount) * 90n || Date.now() - P.road.t > 2 * 3600e3)) P.road = null;
  if (P.road) { P.ownerBridge = null; return save(`bridging ${usd(P.road.amount)} USDC to Ethereum`), moved; }
  if (N >= MIN && !OWNER_BRIDGE && FAST_PATH) {
    P.ib = { stage: "to keeper", amount: N.toString(), baseE: E.toString(), t: Date.now() };
    await intentsResume(ctx, call, P, E);
    return save(`moving ${usd(N)} USDC to Ethereum via NEAR Intents (${P.ib?.stage || "withdrawn"})`), true;
  }
  if (N >= MIN && OWNER_BRIDGE) {
    P.ownerBridge = N.toString();
    if (E < MIN) return save(`${usd(N)} USDC ready: owner taps "Bridge" on the Pendle dashboard (one tap)`), moved;
  } else P.ownerBridge = null;
  if (N >= MIN && !OWNER_BRIDGE) {
    const qt = await quote({ originAsset: A_NUSDC, destinationAsset: A_BUSDC, amount: N.toString(), refundTo: PENDLE, recipient: me }).catch((e) => (note("Bridge quote: " + e.message), null));
    if (qt && !/^[0-9a-f]{64}$/.test(qt.depositAddress)) { note("Bridge: deposit address is not a NEAR Intents address, skipped"); }
    else if (qt) {
      const r = await call(PENDLE, "bridge_out", { deposit: qt.depositAddress, amount: N.toString() }, 100, "1250000000000000000000", `Bridge ${usd(N)} USDC NEAR → Ethereum (Intents, ~${qt.timeEstimate}s)`);
      if (r) { submit(r.transaction.hash, qt.depositAddress); P.bridge = { dep: qt.depositAddress, amount: N.toString(), t: Date.now() }; return save(`bridging ${usd(N)} USDC to Ethereum`), true; }
    }
  }

  // 5. ETH for gas on Ethereum, paid with the keeper's own NEAR
  if (ethBal < MIN_ETH && !P.gas) {
    if (ctx.keeperNear < KEEPER_NEAR_MIN) return save(`needs ETH gas on Ethereum: send NEAR to ${ctx.me} (has ${ctx.keeperNear})`), moved;
    const qt = await quote({ originAsset: "nep141:wrap.near", destinationAsset: A_BETH, amount: GAS_NEAR.toString(), refundTo: ctx.me, recipient: me }).catch((e) => (note("Gas quote: " + e.message), null));
    if (qt) {
      try {
        const r = await acc.signAndSendTransaction({ receiverId: "wrap.near", actions: [
          fc("storage_deposit", { account_id: qt.depositAddress, registration_only: true }, 20, 1_250_000_000_000_000_000_000n),
          fc("storage_deposit", { account_id: ctx.me, registration_only: true }, 20, 1_250_000_000_000_000_000_000n), // the keeper itself must be registered on wrap.near (else near_deposit keeps a storage fee)
          fc("near_deposit", {}, 20, GAS_NEAR),
          fc("ft_transfer", { receiver_id: qt.depositAddress, amount: GAS_NEAR.toString(), memo: "ETH gas for the Joulity Pendle strategy" }, 30, 1n),
        ] });
        note(`Gas: ${Number(GAS_NEAR) / 1e24} NEAR → ${qt.amountOutFormatted} ETH on Ethereum`, r.transaction.hash);
        submit(r.transaction.hash, qt.depositAddress); P.gas = { dep: qt.depositAddress, t: Date.now() };
      } catch (e) { note("FAILED gas: " + String(e.message || e).slice(0, 200)); }
    }
    return save("buying ETH gas on Ethereum"), moved;
  }
  if (P.gas && ethBal < MIN_ETH) return save("waiting for ETH gas on Ethereum"), moved;

  // 6. USDC on Ethereum -> PT (approve the router once). Only when Ethereum gas is cheap: a $1 demo buy must not cost $3 of gas.
  const baseGwei = Number(BigInt((await eth("eth_getBlockByNumber", ["latest", false])).baseFeePerGas)) / 1e9;
  P.gasGwei = Math.round(baseGwei * 1000) / 1000;
  if (E >= MIN && baseGwei > MAX_GWEI) return save(`waiting for cheaper Ethereum gas (now ${baseGwei.toFixed(2)} gwei, buys under ${MAX_GWEI})`), moved;
  if (E >= MIN) {
    if ((await allowance(B_USDC, me, ROUTER)) < E) {
      if (!(await signEth(ctx, call, cfg, B_USDC, "0x095ea7b3" + word(ROUTER) + MAXU, "Approve USDC → Pendle router (Ethereum)"))) return save("approve failed"), moved;
    }
    const c = await convert(me, B_USDC, E.toString(), m.pt).catch((e) => (note("Pendle quote: " + e.message), null));
    if (c && await signEth(ctx, call, cfg, c.tx.to, c.tx.data, `Buy PT-${m.name} with ${usd(E)} USDC (Ethereum)`)) { moved = true; await sleep(4000); [E, pt] = await Promise.all([balOf(B_USDC, me), balOf(m.pt, me)]); }
  }

  // 7. report: USDC on NEAR + USDC on Ethereum + PT at its exit price (bounded by the vault)
  const s2 = ((await view(VAULT, "strategies")) || []).find((x) => x[0] === NAME)?.[1];
  const ptValue = pt > 0n ? (await convert(me, m.pt, pt.toString(), B_USDC).catch(() => null))?.out : 0n;
  if (ptValue === null || ptValue === undefined) return save("running (PT price unavailable, no report)"), moved;
  const value = (await nUsdc()) + E + ptValue, book = BigInt(s2.value);
  P.snapshot = { nearUsdc: N.toString(), baseUsdc: E.toString(), pt: pt.toString(), ptValue: ptValue.toString(), ethGas: ethBal.toString(), book: book.toString(), baseAddress: me };
  const age = Math.floor(Date.now() / 1000) - Number(s2.reported_at);
  const drop = value < book, dropOk = drop && !moved && P.lastDrop === book.toString();
  P.lastDrop = drop && !moved ? book.toString() : null;
  if (value !== book && (!drop || dropOk) && (moved || age >= REPORT_EVERY_S || dropOk)) {
    const allowed = 1_000_000n + (book * 50n * BigInt(Math.min(age, 30 * 86400))) / (10000n * 86400n) - 1n;
    let v = value;
    if (v > book + allowed) v = book + allowed;
    if (v + allowed < book) v = book - allowed;
    await call(VAULT, "report", { name: NAME, value: v.toString() }, 30, 0, `Report Pendle value ${usd(book)} → ${usd(v)} USDC`);
  }
  save("running");
  return moved;
}

const fc = (methodName, args, gasT, deposit) => transactions.functionCall(methodName, args, TG(gasT), BigInt(deposit));

// ---------- fast path: inside NEAR Intents (tested 11-10: swap settled in ~2 s) ----------
// strategy -> keeper (keeper is owner for the hackathon) -> keeper's NEAR Intents account -> swap NEAR USDC to Ethereum USDC
// (solver quote + NEP-413 signed intent) -> withdraw exactly that amount to the strategy's Ethereum address.
// Each step is remembered in P.ib, so a restart or a failure resumes where it stopped. Exact amounts only: the keeper's
// own small balances inside NEAR Intents are never mixed in.
const FAST_PATH = true, INTENTS = "intents.near", RELAY = "https://solver-relay-v2.chaindefuser.com/rpc", A_EUSDC_ID = "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) { let n = BigInt("0x" + Buffer.from(buf).toString("hex")), s = ""; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = "1" + s; else break; } return s; }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const bstr = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u32(b.length), b]); };
async function sign413(ctx, message) {
  const crypto = await import("node:crypto");
  const acc = await ctx.account(), kp = await acc.connection.signer.keyStore.getKey("mainnet", ctx.me);
  const nonce = crypto.randomBytes(32);
  const hash = crypto.createHash("sha256").update(Buffer.concat([u32(2147484061), bstr(message), nonce, bstr(INTENTS), Buffer.from([0])])).digest();
  return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient: INTENTS }, public_key: kp.getPublicKey().toString(), signature: "ed25519:" + b58(kp.sign(hash).signature) };
}
const relay = async (method, params) => (await (await fetch(RELAY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params: [params] }) })).json());

async function intentsResume(ctx, call, P, E) {
  const ib = P.ib, amt = BigInt(ib.amount), me = ctx.me;
  const mt = async (token) => BigInt(await ctx.view(INTENTS, "mt_balance_of", { account_id: me, token_id: token }).catch(() => "0"));
  if (ib.stage === "to keeper") {
    const r = await call(PENDLE, "bridge_out", { deposit: me, amount: ib.amount }, 100, "1250000000000000000000", `Strategy → keeper ${usd(amt)} USDC (fast path via NEAR Intents)`);
    if (!r) { P.ib = null; return true; }            // nothing moved: forget it, the normal flow retries
    ib.stage = "deposit"; await sleep(3000);
  }
  if (ib.stage === "deposit") {
    const r = await call(USDC, "ft_transfer_call", { receiver_id: INTENTS, amount: ib.amount, msg: "" }, 100, 1, `Deposit ${usd(amt)} USDC into NEAR Intents`);
    if (!r) return false;
    ib.stage = "swap"; await sleep(2000);
  }
  if (ib.stage === "swap") {
    const q = await relay("quote", { defuse_asset_identifier_in: A_NUSDC, defuse_asset_identifier_out: A_BUSDC, exact_amount_in: ib.amount, min_deadline_ms: 60000 }).catch(() => null);
    const best = (q?.result || []).sort((a, b) => (BigInt(b.amount_out) > BigInt(a.amount_out) ? 1 : -1))[0];
    if (!best) { ctx.note("NEAR Intents: no solver quote yet, retry next check"); return false; }
    if (BigInt(best.amount_out) * 100n < amt * 97n) { ctx.note(`NEAR Intents: quote too low (${usd(BigInt(best.amount_out))} for ${usd(amt)}), retry`); return false; }
    const before = await mt(A_BUSDC);
    const msg = JSON.stringify({ signer_id: me, deadline: new Date(Date.now() + 120e3).toISOString(), intents: [{ intent: "token_diff", diff: { [A_NUSDC]: "-" + ib.amount, [A_BUSDC]: best.amount_out } }] });
    const pub = await relay("publish_intent", { quote_hashes: [best.quote_hash], signed_data: await sign413(ctx, msg) }).catch(() => null);
    const ih = pub?.result?.intent_hash;
    if (!ih) { ctx.note("NEAR Intents: publish failed " + JSON.stringify(pub?.result || pub?.error || "").slice(0, 120)); return false; }
    let st = "";
    for (let i = 0; i < 30 && st !== "SETTLED" && st !== "NOT_FOUND_OR_NOT_VALID"; i++) { await sleep(2000); st = (await relay("get_status", { intent_hash: ih }).catch(() => null))?.result?.status || ""; }
    const got = (await mt(A_BUSDC)) - before;
    if (st !== "SETTLED" || got <= 0n) { ctx.note(`NEAR Intents swap ${st || "unknown"}, retry`); return false; }
    ctx.note(`Swap ${usd(amt)} USDC NEAR → ${usd(got)} USDC Ethereum inside NEAR Intents (settled)`);
    ib.out = got.toString(); ib.stage = "withdraw";
  }
  if (ib.stage === "withdraw") {
    const msg = JSON.stringify({ signer_id: me, deadline: new Date(Date.now() + 120e3).toISOString(), intents: [{ intent: "ft_withdraw", token: A_EUSDC_ID, receiver_id: A_EUSDC_ID, amount: ib.out, memo: "WITHDRAW_TO:" + (await ctx.view(PENDLE, "config")).eth_address }] });
    const r = await call(INTENTS, "execute_intents", { signed: [await sign413(ctx, msg)] }, 300, 0, `Withdraw ${usd(BigInt(ib.out))} USDC to the strategy's Ethereum address`);
    if (!r) return false;
    P.road = { amount: ib.out, base: ib.baseE, t: Date.now() };
    P.ib = null;
  }
  return !P.ib;
}

/** Sign an Ethereum transaction with NEAR Chain Signatures (via the strategy contract's policy), then send it to Ethereum. */
async function signEth(ctx, call, cfg, to, data, label) {
  const me = cfg.eth_address;
  const [nonce, block, prio] = await Promise.all([eth("eth_getTransactionCount", [me, "pending"]), eth("eth_getBlockByNumber", ["latest", false]), eth("eth_maxPriorityFeePerGas").catch(() => "0x0")]);
  let gas;
  try { gas = Math.ceil(Number(BigInt(await eth("eth_estimateGas", [{ from: me, to, data }]))) * 1.3); }
  catch (e) { ctx.note(`${label}: would fail on Ethereum (${String(e.message).slice(0, 120)}), skipped`); return null; }
  const p = BigInt(prio) > 1_000_000n ? BigInt(prio) : 1_000_000n;
  const maxFee = (BigInt(block.baseFeePerGas) * 5n) / 4n + p; // 1.25x base: the full reserve must be in the wallet
  const t = { nonce: String(BigInt(nonce)), gas: String(gas), max_fee: String(maxFee), max_priority_fee: String(p), to, data };
  const local = "0x" + hexb(keccak_256(unsigned(t)));
  const onchain = await ctx.view(PENDLE, "tx_hash", { tx: t });
  if (local !== onchain) { ctx.note(`${label}: hash mismatch, skipped`); return null; }
  const r = await call(PENDLE, "sign_eth", { tx: t }, 300, 1, label + " (Chain Signatures)");
  if (!r) return null;
  const sv = r.status?.SuccessValue;
  if (!sv) { ctx.note(`${label}: no signature returned`); return null; }
  const sig = JSON.parse(Buffer.from(sv, "base64").toString());
  const R = (sig.big_r?.affine_point || sig.big_r || "").replace(/^0x/, "");
  const rr = R.slice(-64), s = (sig.s?.scalar || sig.s || "").replace(/^0x/, "").padStart(64, "0");
  const y = Number(sig.recovery_id ?? sig.v ?? 0) & 1;
  const pub = secp256k1.Signature.fromCompact(rr + s).addRecoveryBit(y).recoverPublicKey(keccak_256(unsigned(t))).toRawBytes(false);
  const from = "0x" + hexb(keccak_256(pub.slice(1))).slice(-40);
  if (from.toLowerCase() !== me.toLowerCase()) { ctx.note(`${label}: signature recovers ${from}, not ${me}`); return null; }
  const raw = signedRaw(t, y, rr, s);
  const eh = await eth("eth_sendRawTransaction", [raw]).catch((e) => (/already known|nonce too low/i.test(e.message) ? "0x" + hexb(keccak_256(unhex(raw))) : (ctx.note(`${label}: Ethereum refused: ${e.message.slice(0, 150)}`), null)));
  if (!eh) return null;
  for (let i = 0; i < 30; i++) {
    const rc = await eth("eth_getTransactionReceipt", [eh]).catch(() => null);
    if (rc) { ctx.note(`${label}: ${rc.status === "0x1" ? "confirmed on Ethereum" : "REVERTED on Ethereum"}`, "eth:" + eh); return rc.status === "0x1" ? eh : null; }
    await sleep(2000);
  }
  ctx.note(`${label}: sent on Ethereum, not confirmed yet`, "eth:" + eh);
  return eh;
}
