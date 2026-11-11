// Joulity admin: vault -> Pendle on Ethereum, through NEAR Intents (bridge) + NEAR Chain Signatures (the Ethereum key).
// You sign every NEAR transaction in your own wallet. No key is stored here or on the server.
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMeteorWalletApp } from "@near-wallet-selector/meteor-wallet-app";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupNearMobileWallet } from "@near-wallet-selector/near-mobile-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { KeyPair, connect, keyStores, transactions, utils } from "near-api-js";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import bs58mod from "bs58";
const bs58 = bs58mod.default || bs58mod;

// ---------- constants ----------
const KEEPER = "joulity-keeper.near";
const PENDLE = "joulity-pendle.near", VAULT = "joulity-vault.near", SIGNER = "v1.signer", NAME = "pendle";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ETH_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", ROUTER = "0x888888888889758F76e7103c6CbF23ABbF58F946";
const A_NUSDC = "nep141:" + USDC, A_EUSDC = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", A_EETH = "nep141:eth.omft.near";
const RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
const ERPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"];
const ONECLICK = "https://1click.chaindefuser.com/v0", PAPI = "https://api-v2.pendle.finance/core";
const MAXU = "f".repeat(64);
const TGAS = (n) => String(BigInt(n) * 10n ** 12n);
const NEAR = (s) => { const [a, b = ""] = String(s).split("."); return (BigInt(a) * 10n ** 24n + BigInt((b + "0".repeat(24)).slice(0, 24))).toString(); };
const $ = (id) => document.getElementById(id);
const log = (m, href) => { const d = document.createElement("div"); d.textContent = new Date().toLocaleTimeString() + "  " + m + " "; if (href) { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.textContent = "open ↗"; d.append(a); } $("log").prepend(d); };
const six = (v) => BigInt(Math.round(Number(v) * 1e6));
const fmt = (u, d = 6) => (Number(u) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d > 6 ? 6 : 2 });
const hexb = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) || []).map((x) => parseInt(x, 16)));
const word = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");

let selector, modal, account = null, S = {};

// ---------- NEAR reads ----------
async function rpc(method, params) {
  let last;
  for (const u of RPCS) {
    try {
      const j = await (await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
      if (j.result || j.error?.cause?.name) return j;
      last = new Error(JSON.stringify(j.error || j).slice(0, 160));
    } catch (e) { last = e; }
  }
  throw last;
}
const q = (p) => rpc("query", { finality: "final", ...p });
async function view(id, method, args = {}) {
  const r = await q({ request_type: "call_function", account_id: id, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  if (!r.result) return null;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
}
async function acct(id) { const r = await q({ request_type: "view_account", account_id: id }); return r.result || null; }

// ---------- Ethereum reads ----------
async function eth(method, params = []) {
  let last;
  for (const u of ERPCS) {
    try {
      const j = await (await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
      if ("result" in j) return j.result;
      last = new Error(j.error?.message || "eth rpc");
      if (method === "eth_sendRawTransaction" || method === "eth_estimateGas") throw last;
    } catch (e) { last = e; if (method === "eth_sendRawTransaction" || method === "eth_estimateGas") throw e; }
  }
  throw last;
}
const erc20bal = async (token, who) => BigInt(await eth("eth_call", [{ to: token, data: "0x70a08231" + word(who) }, "latest"]));

// ---------- Chain Signatures address ----------
async function derivedAddress() {
  const pk = await view(SIGNER, "derived_public_key", { path: "eth-1", predecessor: PENDLE, domain_id: 0 });
  const raw = bs58.decode(pk.split(":")[1]);   // 64 bytes x||y
  return "0x" + hexb(keccak_256(raw)).slice(-40);
}

// ---------- RLP + EIP-1559 (same encoding as the contract, checked against it before signing) ----------
const be = (n) => { n = BigInt(n); if (n === 0n) return new Uint8Array(); let h = n.toString(16); if (h.length % 2) h = "0" + h; return unhex(h); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const rlen = (len, short) => len <= 55 ? Uint8Array.of(short + len) : cat(Uint8Array.of(short + 55 + be(len).length), be(len));
const rb = (b) => (b.length === 1 && b[0] < 0x80 ? b : cat(rlen(b.length, 0x80), b));
const rl = (items) => { const p = cat(...items); return cat(rlen(p.length, 0xc0), p); };
function fields(t) { return [rb(be(1)), rb(be(t.nonce)), rb(be(t.max_priority_fee)), rb(be(t.max_fee)), rb(be(t.gas)), rb(unhex(t.to)), rb(be(0)), rb(unhex(t.data)), rl([])]; }
const unsigned = (t) => cat(Uint8Array.of(2), rl(fields(t)));
const signedRaw = (t, y, r, s) => "0x02" + hexb(rl([...fields(t), rb(be(y)), rb(be("0x" + r)), rb(be("0x" + s))]));

// ---------- wallet ----------
async function send(receiverId, actions, label) {
  const w = await selector.wallet();
  log(`${label}: open your wallet to sign…`);
  const res = await w.signAndSendTransaction({ receiverId, actions });
  const h = res?.transaction?.hash || res?.transaction_outcome?.id || "";
  const fail = res?.status && res.status.Failure;
  log(`${label}: ${fail ? "FAILED" : "sent"}`, h ? `https://nearblocks.io/txns/${h}` : undefined);
  if (fail) throw new Error(JSON.stringify(fail).slice(0, 200));
  return h;
}
const fc = (methodName, args, gas = 100, deposit = "0") => ({ type: "FunctionCall", params: { methodName, args, gas: TGAS(gas), deposit } });
async function finalValue(hash) {
  for (let i = 0; i < 40; i++) {
    const r = await rpc("tx", { tx_hash: hash, sender_account_id: account, wait_until: "FINAL" }).catch(() => null);
    const st = r?.result?.status;
    if (st?.Failure) throw new Error("NEAR tx failed: " + JSON.stringify(st.Failure).slice(0, 300));
    if (st && "SuccessValue" in st && st.SuccessValue) return JSON.parse(atob(st.SuccessValue));
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("No signature yet. Paste the NEAR tx hash in 'Finish' later.");
}

// ---------- 1Click ----------
async function quote(o) {
  const body = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 50, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", deadline: new Date(Date.now() + 24 * 3600e3).toISOString(), referral: "joulity", quoteWaitingTimeMs: 3000, ...o };
  const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.quote?.depositAddress) throw new Error("1Click: " + (j.message || "no quote"));
  log(`1Click quote: ${j.quote.amountInFormatted} in → ${j.quote.amountOutFormatted} out, ~${j.quote.timeEstimate}s · deposit ${j.quote.depositAddress}`);
  return j.quote;
}
const submitDeposit = (txHash, depositAddress) => fetch(`${ONECLICK}/deposit/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash, depositAddress }) }).catch(() => {});
async function watch(dep) {
  for (let i = 0; i < 80; i++) {
    const j = await (await fetch(`${ONECLICK}/status?depositAddress=${dep}`)).json().catch(() => ({}));
    $("bridge").textContent = `Bridge ${dep.slice(0, 10)}…: ${j.status || "?"}`;
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(j.status)) { log(`Bridge: ${j.status}`); refresh(); return; }
    await new Promise((r) => setTimeout(r, 6000));
  }
}

// ---------- the core: sign an Ethereum tx with Chain Signatures, then broadcast ----------
async function signEth(to, data, label, gasFallback = 400000) {
  const me = S.cfg.eth_address;
  const [nonce, block, prio] = await Promise.all([eth("eth_getTransactionCount", [me, "pending"]), eth("eth_getBlockByNumber", ["latest", false]), eth("eth_maxPriorityFeePerGas").catch(() => "0x0")]);
  let gas;
  try { gas = Math.ceil(Number(BigInt(await eth("eth_estimateGas", [{ from: me, to, data }]))) * 1.3); }
  catch (e) { log(`${label}: gas estimate failed (${e.message.slice(0, 120)}). Stopping: this call would fail on Ethereum.`); throw e; }
  const p = BigInt(prio) > 10_000_000n ? BigInt(prio) : 10_000_000n;   // >= 0.01 gwei
  const maxFee = BigInt(block.baseFeePerGas) * 3n + p;
  const t = { nonce: String(BigInt(nonce)), gas: String(gas), max_fee: String(maxFee), max_priority_fee: String(p), to, data };
  const ethCost = Number(BigInt(gas) * maxFee) / 1e18;
  log(`${label}: nonce ${t.nonce}, gas ${gas}, max ${ethCost.toFixed(6)} ETH`);
  const local = "0x" + hexb(keccak_256(unsigned(t)));
  const onchain = await view(PENDLE, "tx_hash", { tx: t });
  if (local !== onchain) throw new Error(`hash mismatch ${local} vs ${onchain}`);
  localStorage.setItem("jpendle:pending", JSON.stringify({ t, label }));
  const h = await send(PENDLE, [fc("sign_eth", { tx: t }, 300, "1")], label + " (Chain Signatures)");
  return finish(h);
}
async function finish(hash) {
  const p = JSON.parse(localStorage.getItem("jpendle:pending") || "null");
  if (!p) throw new Error("Nothing pending");
  log(`${p.label}: waiting for the NEAR MPC signature…`);
  const sig = await finalValue(hash);
  const R = (sig.big_r?.affine_point || sig.big_r || "").replace(/^0x/, "");
  const r = R.slice(-64), s = (sig.s?.scalar || sig.s || "").replace(/^0x/, "").padStart(64, "0");
  const y = Number(sig.recovery_id ?? sig.v ?? 0) & 1;
  const msg = keccak_256(unsigned(p.t));
  const pub = secp256k1.Signature.fromCompact(r + s).addRecoveryBit(y).recoverPublicKey(msg).toRawBytes(false);
  const from = "0x" + hexb(keccak_256(pub.slice(1))).slice(-40);
  if (from.toLowerCase() !== S.cfg.eth_address.toLowerCase()) throw new Error(`signature recovers ${from}, not ${S.cfg.eth_address}`);
  log(`${p.label}: signed by NEAR MPC for ${from} ✓`);
  const raw = signedRaw(p.t, y, r, s);
  const eh = await eth("eth_sendRawTransaction", [raw]).catch((e) => { if (/already known|nonce too low/i.test(e.message)) return "0x" + hexb(keccak_256(unhex(raw))); throw e; });
  localStorage.removeItem("jpendle:pending");
  log(`${p.label}: sent on Ethereum`, `https://etherscan.io/tx/${eh}`);
  for (let i = 0; i < 40; i++) {
    const rc = await eth("eth_getTransactionReceipt", [eh]).catch(() => null);
    if (rc) { log(`${p.label}: ${rc.status === "0x1" ? "confirmed ✓" : "REVERTED"} on Ethereum`, `https://etherscan.io/tx/${eh}`); break; }
    await new Promise((res) => setTimeout(res, 4000));
  }
  refresh();
  return eh;
}

// ---------- Pendle ----------
async function pendleMarkets() {
  const j = await (await fetch(`${PAPI}/v1/1/markets/active`)).json();
  return (j.markets || []).filter((m) => /usd/i.test(m.name) && (m.details?.liquidity || 0) > 1e6)
    .map((m) => ({ name: m.name, market: m.address, pt: m.pt.split("-")[1], yt: m.yt.split("-")[1], expiry: m.expiry.slice(0, 10), apy: (m.details.impliedApy * 100).toFixed(2), liq: m.details.liquidity }))
    .sort((a, b) => b.liq - a.liq);
}
async function convert(tokenIn, amountIn, tokenOut) {
  const u = `${PAPI}/v2/sdk/1/convert?receiver=${S.cfg.eth_address}&slippage=0.005&enableAggregator=true&tokensIn=${tokenIn}&amountsIn=${amountIn}&tokensOut=${tokenOut}`;
  const j = await (await fetch(u)).json();
  const r = j.routes?.[0];
  if (!r?.tx) throw new Error("Pendle: " + (j.message || "no route"));
  return { tx: r.tx, out: BigInt(r.outputs[0].amount), method: r.contractParamInfo?.method };
}
const market = () => S.markets?.find((m) => S.cfg?.markets.includes(m.market.toLowerCase())) || null;

// ---------- actions ----------
const tmpKey = () => { try { const v = localStorage.getItem("jdeploy:" + PENDLE); return v ? KeyPair.fromString(v) : null; } catch { return null; } };
const A = {
  async create() {
    let kp = tmpKey();
    if (!kp) { kp = KeyPair.fromRandom("ed25519"); localStorage.setItem("jdeploy:" + PENDLE, kp.toString()); }
    await send("near", [fc("create_account", { new_account_id: PENDLE, new_public_key: kp.getPublicKey().toString() }, 30, NEAR($("fund").value))], "Create joulity-pendle.near");
  },
  async code() {
    const kp = tmpKey(); if (!kp) throw new Error("The one-time key is not in this browser. Use the browser where you created the account.");
    const code = new Uint8Array(await (await fetch("./joulity_pendle.wasm", { cache: "no-store" })).arrayBuffer());
    const ks = new keyStores.InMemoryKeyStore(); await ks.setKey("mainnet", PENDLE, kp);
    const a = await (await connect({ networkId: "mainnet", nodeUrl: RPCS[0], keyStore: ks })).account(PENDLE);
    log("Putting the code (no wallet needed)…");
    const r = await a.signAndSendTransaction({ receiverId: PENDLE, actions: [
      transactions.deployContract(code),
      transactions.functionCall("new", { owner: account, vault: VAULT, usdc: USDC, signer: SIGNER, eth_usdc: ETH_USDC, router: ROUTER }, 100n * 10n ** 12n, 0n),
      transactions.deleteKey(utils.PublicKey.from(kp.getPublicKey().toString())),
    ] });
    const ok = r?.status && "SuccessValue" in r.status;
    log(ok ? "Code + init done ✓ (the one-time key is deleted: the contract has no key)" : "FAILED", "https://nearblocks.io/txns/" + r.transaction.hash);
    if (ok) localStorage.removeItem("jdeploy:" + PENDLE);
  },
  async setup() {
    const m = S.markets.find((x) => x.market === $("mkt").value); if (!m) throw new Error("Pick a market");
    const addr = await derivedAddress();
    await send(PENDLE, [
      ...(S.cfg.eth_address ? [] : [fc("set_eth_address", { address: addr }, 20)]),
      fc("allow", { kind: "market", address: m.market, on: true }, 20),
      fc("allow", { kind: "market", address: m.yt, on: true }, 20),   // redeem after maturity: word 1 is the YT
      fc("allow", { kind: "token", address: m.pt, on: true }, 20),
    ], "Allow " + m.name);
  },
  async usdcReg() { await send(USDC, [fc("storage_deposit", { account_id: PENDLE, registration_only: true }, 30, NEAR("0.00125"))], "USDC registration"); },
  async strategy() { await send(VAULT, [fc("set_strategy", { name: NAME, receiver: PENDLE, cap_bps: Number($("cap").value) * 100, note: "Pendle PT on Ethereum via NEAR Intents + Chain Signatures" }, 30)], "Vault: add strategy"); },
  async deploy() { await send(VAULT, [fc("deploy", { name: NAME, amount: String(six($("amt").value)) }, 100)], "Vault → strategy"); },
  async gas() {
    const amount = NEAR($("gasNear").value);
    const qt = await quote({ originAsset: "nep141:wrap.near", destinationAsset: A_EETH, amount, refundTo: account, recipient: S.cfg.eth_address });
    const h = await send("wrap.near", [fc("storage_deposit", { account_id: qt.depositAddress, registration_only: true }, 20, NEAR("0.00125")), fc("near_deposit", {}, 20, amount), fc("ft_transfer", { receiver_id: qt.depositAddress, amount, memo: "ETH gas for the Joulity Pendle strategy" }, 30, "1")], "Gas: your NEAR → ETH on Ethereum");
    if (h) submitDeposit(h, qt.depositAddress); watch(qt.depositAddress);
  },
  async out() {
    const amount = String($("outAmt").value ? six($("outAmt").value) : S.nUsdc);
    const qt = await quote({ originAsset: A_NUSDC, destinationAsset: A_EUSDC, amount, refundTo: PENDLE, recipient: S.cfg.eth_address });
    const h = await send(PENDLE, [fc("bridge_out", { deposit: qt.depositAddress, amount }, 100, NEAR("0.00125"))], "Bridge USDC NEAR → Ethereum (Intents)");
    if (h) submitDeposit(h, qt.depositAddress); watch(qt.depositAddress);
  },
  async approveUsdc() { await signEth(ETH_USDC, "0x095ea7b3" + word(ROUTER) + MAXU, "Approve USDC → Pendle router"); },
  async buy() {
    const m = market(); if (!m) throw new Error("No market allowed yet");
    if (S.eUsdc <= 0n) throw new Error("No USDC on Ethereum yet");
    const c = await convert(ETH_USDC, S.eUsdc.toString(), m.pt);
    log(`Pendle: ${fmt(S.eUsdc)} USDC → ${fmt(c.out, 18)} PT-${m.name} (${c.method})`);
    await signEth(c.tx.to, c.tx.data, "Buy PT-" + m.name, 900000);
  },
  async approvePt() { const m = market(); await signEth(m.pt, "0x095ea7b3" + word(ROUTER) + MAXU, "Approve PT → Pendle router"); },
  async sell() {
    const m = market(); if (S.pt <= 0n) throw new Error("No PT to sell");
    const c = await convert(m.pt, S.pt.toString(), ETH_USDC);
    log(`Pendle: ${fmt(S.pt, 18)} PT → ${fmt(c.out)} USDC (${c.method})`);
    await signEth(c.tx.to, c.tx.data, "Sell PT-" + m.name, 900000);
  },
  async back() {
    if (S.eUsdc <= 0n) throw new Error("No USDC on Ethereum");
    const amount = S.eUsdc.toString();
    const qt = await quote({ originAsset: A_EUSDC, destinationAsset: A_NUSDC, amount, refundTo: S.cfg.eth_address, recipient: PENDLE });
    const eh = await signEth(ETH_USDC, "0xa9059cbb" + word(qt.depositAddress) + BigInt(amount).toString(16).padStart(64, "0"), "Bridge USDC Ethereum → NEAR (Intents)", 80000);
    if (eh) submitDeposit(eh, qt.depositAddress); watch(qt.depositAddress);
  },
  async home() { await send(PENDLE, [fc("to_vault", { amount: String(S.nUsdc) }, 100)], "Strategy → vault"); },
  async report() {
    const v = await value();
    await send(VAULT, [fc("report", { name: NAME, value: String(v) }, 30)], `Report ${fmt(v)} USDC`);
  },
  async keeper() { await send(PENDLE, [fc("set_keeper", { keeper: KEEPER }, 20)], "Keeper → Pendle keeper"); },
  async keeperOwner() { await send(PENDLE, [fc("set_owner", { owner: KEEPER }, 20)], "Make the keeper the owner (it bridges itself)"); },
  async unkeeper() { await send(PENDLE, [fc("set_keeper", { keeper: null }, 20)], "Remove the keeper"); },
  async fin() { await finish($("hash").value.trim()); },
};

/** What the strategy holds, in USDC units: USDC on NEAR + USDC on Ethereum + PT at its exit price. */
async function value() {
  let v = BigInt(S.nUsdc) + S.eUsdc;
  if (S.pt > 0n) { const c = await convert(market().pt, S.pt.toString(), ETH_USDC); v += c.out; log(`PT worth ${fmt(c.out)} USDC now (exit price)`); }
  return v;
}

// ---------- status ----------
function step(id, done, text) { $(id).className = "st " + (done ? "ok" : "todo"); $(id).textContent = text; }
async function refresh() { try { await refresh2(); } catch (e) { log("Status: " + (e?.message || e)); } }
async function refresh2() {
  $("who").textContent = account || "not connected";
  $("connect").textContent = account ? "Disconnect" : "Connect wallet";
  const a = await acct(PENDLE);
  S.cfg = a && a.code_hash !== "11111111111111111111111111111111" ? await view(PENDLE, "config") : null;
  const reg = a ? await view(USDC, "storage_balance_of", { account_id: PENDLE }) : null;
  const strats = (await view(VAULT, "strategies")) || [];
  const st = strats.find((x) => x[0] === NAME)?.[1];
  const info = await view(VAULT, "info");
  S.addr = S.addr || (await derivedAddress());
  $("addr").innerHTML = `<a href="https://etherscan.io/address/${S.addr}" target="_blank">${S.addr}</a>`;
  step("s1", !!S.cfg, S.cfg ? "Done ✓" : a ? "Account exists, put the code" : "To do");
  step("s2", !!S.cfg?.markets.length, S.cfg?.markets.length ? `Done ✓ ${S.cfg.markets.length / 2} market` : "To do");
  step("s3", !!reg, reg ? "Done ✓" : "To do");
  step("s4", !!st, st ? `Done ✓ cap ${st.cap_bps / 100}%` : "To do");
  step("s6", S.cfg?.owner === KEEPER, S.cfg?.owner === KEEPER ? "Done ✓ bridge is automatic" : "To do");
  step("s5", S.cfg?.keeper === KEEPER || S.cfg?.owner === KEEPER, S.cfg?.keeper === KEEPER ? "Done ✓ automatic" : "To do");
  fetch("../keeper/status.json", { cache: "no-store" }).then((r) => r.json()).then((k) => { const p = k.pendle || {}; $("kp").textContent = `Keeper: ${p.state || "…"}${p.bridgeBy ? " · bridge by " + p.bridgeBy : ""}${p.lastAction ? " · last: " + p.lastAction : ""}`; }).catch(() => {});
  S.nUsdc = a ? (await view(USDC, "ft_balance_of", { account_id: PENDLE })) || "0" : "0";
  S.eUsdc = 0n; S.pt = 0n; let ethBal = 0n;
  if (S.cfg?.eth_address) {
    const m = market();
    [S.eUsdc, ethBal, S.pt] = await Promise.all([erc20bal(ETH_USDC, S.cfg.eth_address), eth("eth_getBalance", [S.cfg.eth_address, "latest"]).then(BigInt), m ? erc20bal(m.pt, S.cfg.eth_address) : 0n]);
  }
  const m = market();
  $("hold").innerHTML = [
    ["Vault total", fmt(info.total_assets) + " USDC · cash " + fmt(info.cash) + " · jUSD price " + (Number(info.price) / 1e6).toFixed(6)],
    ["Strategy value (vault books)", st ? fmt(st.value) + " USDC · reported " + new Date(st.reported_at * 1000).toLocaleString() : "—"],
    ["USDC on NEAR (strategy)", fmt(S.nUsdc)],
    ["USDC on Ethereum", fmt(S.eUsdc)],
    ["ETH for gas", (Number(ethBal) / 1e18).toFixed(6)],
    [m ? `PT-${m.name} (${m.expiry}, ${m.apy}%)` : "PT", fmt(S.pt, 18)],
  ].map(([k, v]) => `<div class="row"><span class="n">${k}</span><b class="mono">${v}</b></div>`).join("");
  const can = !!account && account === S.cfg?.owner;
  document.querySelectorAll(".own").forEach((b) => (b.disabled = !can));
  $("b1").disabled = !account || !!S.cfg; $("b1").textContent = a && !S.cfg ? "Put the code (no wallet)" : "Create account";
  $("b3").disabled = !account || !!reg || !a;
  $("b4").disabled = !account || !!st || !S.cfg;
  if (localStorage.getItem("jpendle:pending")) $("pend").style.display = "block";
}

(async () => {
  selector = await setupWalletSelector({ network: "mainnet", modules: [setupMeteorWalletApp({ contractId: USDC }), setupMeteorWallet(), setupHereWallet(), setupNearMobileWallet({ dAppMetadata: { name: "Joulity", logoUrl: "https://app.joulity.com/favicon.ico" } }), setupMyNearWallet()] });
  modal = setupModal(selector, { contractId: "" });
  const sync = (st) => { account = st.accounts.find((a) => a.active)?.accountId || st.accounts[0]?.accountId || null; refresh(); };
  sync(selector.store.getState());
  selector.store.observable.subscribe(sync);
  $("connect").onclick = async () => { if (account) { await (await selector.wallet()).signOut(); account = null; refresh(); } else modal.show(); };
  pendleMarkets().then((ms) => { S.markets = ms; $("mkt").innerHTML = ms.map((m) => `<option value="${m.market}">${m.name} · ${m.apy}% · until ${m.expiry} · $${(m.liq / 1e6).toFixed(1)}M</option>`).join(""); refresh(); }).catch((e) => log("Pendle markets: " + e.message));
  const run = (k) => async () => { try { await (k === "b1" ? (S.cfg === null && (await acct(PENDLE)) ? A.code() : A.create()) : A[k]()); } catch (e) { log("Error: " + (e?.message || e)); } refresh(); };
  $("b1").onclick = run("b1");
  for (const k of Object.keys(A)) { const el = document.querySelector(`[data-a="${k}"]`); if (el) el.onclick = run(k); }
  $("rf").onclick = refresh;
})();
