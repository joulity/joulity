// Joulity admin: vault -> Rhea lending (USDC on NEAR). You sign every step in your own wallet.
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMeteorWalletApp } from "@near-wallet-selector/meteor-wallet-app";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupNearMobileWallet } from "@near-wallet-selector/near-mobile-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { KeyPair, connect, keyStores, transactions, utils } from "near-api-js";

const KEEPER = "joulity-keeper.near";
const LEND = "joulity-lend.near", VAULT = "joulity-vault.near", BURROW = "contract.main.burrow.near", NAME = "rhea";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
const TGAS = (n) => String(BigInt(n) * 10n ** 12n);
const NEAR = (s) => { const [a, b = ""] = String(s).split("."); return (BigInt(a) * 10n ** 24n + BigInt((b + "0".repeat(24)).slice(0, 24))).toString(); };
const $ = (id) => document.getElementById(id);
const log = (m, href) => { const d = document.createElement("div"); d.textContent = new Date().toLocaleTimeString() + "  " + m + " "; if (href) { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.textContent = "open ↗"; d.append(a); } $("log").prepend(d); };
const six = (v) => String(BigInt(Math.round(Number(v) * 1e6)));
const fmt = (u) => (Number(u) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });
const fc = (methodName, args, gas = 100, deposit = "0") => ({ type: "FunctionCall", params: { methodName, args, gas: TGAS(gas), deposit } });

let selector, modal, account = null, S = {};

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

async function send(receiverId, actions, label) {
  const w = await selector.wallet();
  log(`${label}: open your wallet to sign…`);
  const res = await w.signAndSendTransaction({ receiverId, actions });
  const h = res?.transaction?.hash || res?.transaction_outcome?.id || "";
  const fail = res?.status && res.status.Failure;
  log(`${label}: ${fail ? "FAILED" : "sent"}`, h ? `https://nearblocks.io/txns/${h}` : undefined);
  if (fail) throw new Error(JSON.stringify(fail).slice(0, 200));
}

/** Rhea supply rate for USDC, from its own contract numbers (rates are per millisecond). */
function supplyApr(a) {
  const sup = Number(a.supplied.balance), bor = Number(a.borrowed.balance), res = Number(a.reserved);
  const c = a.config, util = bor / (sup + res), t = c.target_utilization / 1e4;
  const tr = Number(c.target_utilization_rate) / 1e27 - 1, mr = Number(c.max_utilization_rate) / 1e27 - 1;
  const r = util <= t ? tr * (util / t) : tr + (mr - tr) * ((util - t) / (1 - t));
  const borrowApr = r * 365 * 24 * 3600 * 1000;
  return { util, borrowApr, supplyApr: borrowApr * (bor / sup) * (1 - c.reserve_ratio / 1e4), size: sup / 1e18 };
}

const tmpKey = () => { try { const v = localStorage.getItem("jdeploy:" + LEND); return v ? KeyPair.fromString(v) : null; } catch { return null; } };
const A = {
  async create() {
    let kp = tmpKey();
    if (!kp) { kp = KeyPair.fromRandom("ed25519"); localStorage.setItem("jdeploy:" + LEND, kp.toString()); }
    await send("near", [fc("create_account", { new_account_id: LEND, new_public_key: kp.getPublicKey().toString() }, 30, NEAR($("fund").value))], "Create joulity-lend.near");
  },
  async code() {
    const kp = tmpKey(); if (!kp) throw new Error("The one-time key is not in this browser. Use the browser where you created the account.");
    const code = new Uint8Array(await (await fetch("./joulity_lend.wasm", { cache: "no-store" })).arrayBuffer());
    const ks = new keyStores.InMemoryKeyStore(); await ks.setKey("mainnet", LEND, kp);
    const a = await (await connect({ networkId: "mainnet", nodeUrl: RPCS[0], keyStore: ks })).account(LEND);
    log("Putting the code (no wallet needed)…");
    const r = await a.signAndSendTransaction({ receiverId: LEND, actions: [
      transactions.deployContract(code),
      transactions.functionCall("new", { owner: account, vault: VAULT, usdc: USDC, burrow: BURROW }, 100n * 10n ** 12n, 0n),
      transactions.deleteKey(utils.PublicKey.from(kp.getPublicKey().toString())),
    ] });
    const ok = r?.status && "SuccessValue" in r.status;
    log(ok ? "Code + init done ✓ (the one-time key is deleted: the contract has no key)" : "FAILED", "https://nearblocks.io/txns/" + r.transaction.hash);
    if (ok) localStorage.removeItem("jdeploy:" + LEND);
  },
  async register() { await send(LEND, [fc("register", {}, 50, NEAR("0.1"))], "Open the Rhea account"); },
  async usdcReg() { await send(USDC, [fc("storage_deposit", { account_id: LEND, registration_only: true }, 30, NEAR("0.00125"))], "USDC registration"); },
  async keeper() {
    const k = await (await fetch("../keeper/status.json", { cache: "no-store" })).json();
    if (!k.publicKey?.startsWith("ed25519:")) throw new Error("Keeper key not ready on the server");
    await send("near", [fc("create_account", { new_account_id: KEEPER, new_public_key: k.publicKey }, 30, NEAR($("kfund").value))], "Create joulity-keeper.near");
  },
  async rightVault() { await send(VAULT, [fc("set_manager", { manager: KEEPER }, 30)], "Vault: keeper becomes manager"); },
  async rightLend() { await send(LEND, [fc("set_keeper", { keeper: KEEPER }, 30)], "Rhea strategy: set keeper"); },
  async stopLend() { await send(LEND, [fc("set_keeper", { keeper: null }, 30)], "Rhea strategy: remove keeper"); },
  async stopVault() { await send(VAULT, [fc("set_manager", { manager: account }, 30)], "Vault: manager back to you"); },
  async strategy() { await send(VAULT, [fc("set_strategy", { name: NAME, receiver: LEND, cap_bps: Number($("cap").value) * 100, note: "USDC lending on Rhea (NEAR)" }, 30)], "Vault: add strategy"); },
  async deploy() { await send(VAULT, [fc("deploy", { name: NAME, amount: six($("amt").value) }, 100)], "Vault → Rhea strategy"); },
  async supply() { if (BigInt(S.held) <= 0n) throw new Error("No USDC in the strategy yet"); await send(LEND, [fc("supply", { amount: S.held }, 200)], `Supply ${fmt(S.held)} USDC on Rhea`); },
  async report() { const v = BigInt(S.held) + BigInt(S.lent); await send(VAULT, [fc("report", { name: NAME, value: v.toString() }, 30)], `Report ${fmt(v)} USDC`); },
  async withdraw() { const v = $("wAmt").value.trim(); await send(LEND, [fc("withdraw", v ? { amount: six(v) } : {}, 250)], `Withdraw ${v || "all"} from Rhea`); },
  async home() { if (BigInt(S.held) <= 0n) throw new Error("No USDC in the strategy"); await send(LEND, [fc("to_vault", { amount: S.held }, 100)], `Return ${fmt(S.held)} USDC to the vault`); },
};

function step(id, done, text) { $(id).className = "st " + (done ? "ok" : "todo"); $(id).textContent = text; }
async function refresh() { try { await refresh2(); } catch (e) { log("Status: " + (e?.message || e)); } }
async function refresh2() {
  $("who").textContent = account || "not connected";
  $("connect").textContent = account ? "Disconnect" : "Connect wallet";
  const a = await acct(LEND);
  S.cfg = a && a.code_hash !== "11111111111111111111111111111111" ? await view(LEND, "config") : null;
  const [reg, rhea, asset, strats, info] = await Promise.all([
    a ? view(USDC, "storage_balance_of", { account_id: LEND }) : null,
    a ? view(BURROW, "get_account", { account_id: LEND }) : null,
    view(BURROW, "get_asset", { token_id: USDC }),
    view(VAULT, "strategies"), view(VAULT, "info"),
  ]);
  const st = (strats || []).find((x) => x[0] === NAME)?.[1];
  const sup = rhea?.supplied?.find((x) => x.token_id === USDC);
  S.held = a ? (await view(USDC, "ft_balance_of", { account_id: LEND })) || "0" : "0";
  S.lent = sup ? (BigInt(sup.balance) / 10n ** 12n).toString() : "0";
  const r = supplyApr(asset);
  const K = await fetch("../keeper/status.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const kAcct = await acct(KEEPER);
  const rd = K?.ready || {};
  step("s4", !!kAcct, kAcct ? "Done ✓" : "To do");
  $("b4").disabled = !account || !!kAcct || !K?.publicKey;
  const ago = (t) => (t ? Math.round((Date.now() - Date.parse(t)) / 60000) + " min ago" : "—");
  $("kst").className = "st " + (K?.state === "running" ? "ok" : "todo");
  $("kst").textContent = K ? K.state || "starting" : "offline";
  $("kinfo").innerHTML = K ? [
    ["Last check", ago(K.lastCheck) + (K.error ? " · error: " + K.error : "")],
    ["Keeper gas left", kAcct ? (Number(BigInt(kAcct.amount) / 10n ** 18n) / 1e6).toFixed(3) + " NEAR" : "—"],
    ["Ready", ["keeperAccount", "vaultManager", "lendKeeper", "strategy"].map((x) => (rd[x] ? "✓ " : "✗ ") + x).join(" · ")],
  ].map(([k, v]) => `<div class="row"><span class="n">${k}</span><b class="mono">${v}</b></div>`).join("") : "";
  $("kact").innerHTML = (K?.actions || []).map((a) => `<div>${new Date(a.t).toLocaleString()} · ${a.text.replace(/</g, "&lt;")} ${a.hash ? `<a target="_blank" href="https://nearblocks.io/txns/${a.hash}">tx ↗</a>` : ""}</div>`).join("") || "No moves yet.";
  step("s1", !!S.cfg, S.cfg ? "Done ✓" : a ? "Account exists, put the code" : "To do");
  const rheaReg = a ? await view(BURROW, "storage_balance_of", { account_id: LEND }) : null;
  step("s2", !!rheaReg, rheaReg ? "Done ✓" : "To do");
  step("s2b", !!reg, reg ? "Done ✓" : "To do");
  step("s5", !!rd.vaultManager, rd.vaultManager ? "Done ✓" : "To do");
  step("s5b", !!rd.lendKeeper, rd.lendKeeper ? "Done ✓" : "To do");
  step("s3", !!st, st ? `Done ✓ cap ${st.cap_bps / 100}%` : "To do");
  $("hold").innerHTML = [
    ["Rhea USDC market", `$${(r.size / 1e6).toFixed(1)}M supplied · ${(r.util * 100).toFixed(0)}% borrowed`],
    ["Supply rate now", `≈ ${(r.supplyApr * 100).toFixed(2)}% a year${sup?.apr ? " · Rhea says " + (Number(sup.apr) * 100).toFixed(2) + "%" : ""}`],
    ["Vault total", `${fmt(info.total_assets)} USDC · cash ${fmt(info.cash)} · jUSD ${(Number(info.price) / 1e6).toFixed(6)}`],
    ["Strategy value (vault books)", st ? fmt(st.value) + " USDC" : "—"],
    ["USDC in the strategy (not lent)", fmt(S.held)],
    ["USDC lent on Rhea", fmt(S.lent)],
  ].map(([k, v]) => `<div class="row"><span class="n">${k}</span><b class="mono">${v}</b></div>`).join("");
  const own = !!account && account === S.cfg?.owner;
  document.querySelectorAll(".own").forEach((b) => (b.disabled = !own));
  $("b1").disabled = !account || !!S.cfg; $("b1").textContent = a && !S.cfg ? "Put the code (no wallet)" : "Create account";
  $("b3").disabled = !account || !S.cfg || !!st;
  $("b5").disabled = !own || !kAcct || !!rd.vaultManager;
  $("b5b").disabled = !own || !kAcct || !!rd.lendKeeper;
  $("b2").disabled = !own || !!rheaReg; $("b2b").disabled = !account || !S.cfg || !!reg;
}

(async () => {
  selector = await setupWalletSelector({ network: "mainnet", modules: [setupMeteorWalletApp({ contractId: USDC }), setupMeteorWallet(), setupHereWallet(), setupNearMobileWallet({ dAppMetadata: { name: "Joulity", logoUrl: "https://app.joulity.com/favicon.ico" } }), setupMyNearWallet()] });
  modal = setupModal(selector, { contractId: "" });
  const sync = (st) => { account = st.accounts.find((a) => a.active)?.accountId || st.accounts[0]?.accountId || null; refresh(); };
  sync(selector.store.getState());
  selector.store.observable.subscribe(sync);
  $("connect").onclick = async () => { if (account) { await (await selector.wallet()).signOut(); account = null; refresh(); } else modal.show(); };
  const run = (f) => async () => { try { await f(); } catch (e) { log("Error: " + (e?.message || e)); } refresh(); };
  $("b1").onclick = run(async () => (S.cfg === null && (await acct(LEND)) ? A.code() : A.create()));
  for (const k of Object.keys(A)) { const el = document.querySelector(`[data-a="${k}"]`); if (el) el.onclick = run(A[k]); }
  $("rf").onclick = refresh;
  $("b4").onclick = run(A.keeper);
  setInterval(refresh, 60000);
})();
