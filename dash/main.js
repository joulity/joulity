import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMeteorWalletApp } from "@near-wallet-selector/meteor-wallet-app";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupNearMobileWallet } from "@near-wallet-selector/near-mobile-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { KeyPair, connect, keyStores, transactions, utils } from "near-api-js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
const RPC = RPCS[0];
const TGAS = (n) => String(BigInt(n) * 10n ** 12n);
const NEAR = (s) => { const [a, b = ""] = String(s).split("."); return (BigInt(a) * 10n ** 24n + BigInt((b + "0".repeat(24)).slice(0, 24))).toString(); };
const $ = (id) => document.getElementById(id);
const log = (m) => { const d = document.createElement("div"); d.textContent = new Date().toLocaleTimeString() + "  " + m; $("log").prepend(d); };

let selector, modal, account = null;
const wasm = {};

async function rpc(params) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) });
      const j = await r.json();
      if (j.result || j.error?.cause?.name) return j;   // a real answer (even "account not found")
      last = new Error(JSON.stringify(j).slice(0, 120));
    } catch (e) { last = e; }
  }
  throw new Error("Could not reach NEAR: " + (last?.message || last));
}
async function view(id, method, args = {}) {
  const r = await rpc({ request_type: "call_function", account_id: id, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  if (!r.result) return null;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
}
async function acct(id) {
  const r = await rpc({ request_type: "view_account", account_id: id });
  if (r.result) return r.result;
  if (r.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
  throw new Error("NEAR said: " + (r.error?.cause?.name || "unknown error"));
}

async function loadWasm(name) {
  const buf = new Uint8Array(await (await fetch(`./${name}.wasm`, { cache: "no-store" })).arrayBuffer());
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
  wasm[name] = buf;
  $(`${name}-info`).textContent = `${buf.length.toLocaleString()} bytes · sha256 ${h.slice(0, 16)}…`;
}

const names = () => ({ vault: $("vaultId").value.trim(), social: $("socialId").value.trim(), gas: $("gasId").value.trim() });
// Meteor blocks AddKey/DeployContract, but allows a normal call to NEAR's account registrar (`near`).
const viaRegistrar = (id, pk, fund) => ({ receiverId: "near", actions: [{ type: "FunctionCall", params: { methodName: "create_account", args: { new_account_id: id, new_public_key: pk }, gas: TGAS(30), deposit: NEAR(fund) } }] });

function keyAction() {
  const pk = $("pk").value.trim();
  return pk ? [{ type: "AddKey", params: { publicKey: pk, accessKey: { permission: "FullAccess" } } }] : [];
}

async function send(tx, label) {
  try {
    const w = await selector.wallet();
    log(`${label}: open your wallet to sign…`);
    const res = await w.signAndSendTransaction(tx);
    const h = res?.transaction?.hash || res?.transaction_outcome?.id || "";
    log(`${label}: sent ${h ? "· " + h : ""}`);
    if (h) log(`https://nearblocks.io/txns/${h}`);
  } catch (e) { log(`${label}: ${e?.message || e}`); }
  refresh();
}

// Meteor blocks DeployContract from websites. So: (1) the wallet creates + funds the account and adds a
// one-time key made in THIS browser; (2) the page uses that key to deploy + init, then deletes it in the same tx.
const tmpKey = (id) => { try { const v = localStorage.getItem("jdeploy:" + id); return v ? KeyPair.fromString(v) : null; } catch { return null; } };
async function createAccount(id, fund, label) {
  let kp = tmpKey(id);
  if (!kp) { kp = KeyPair.fromRandom("ed25519"); try { localStorage.setItem("jdeploy:" + id, kp.toString()); } catch {} }
  await send(viaRegistrar(id, kp.getPublicKey().toString(), fund), label + " (create account)");
}
async function finish(id, code, args, label) {
  const kp = tmpKey(id);
  if (!kp) { log(label + ": the one-time key is not in this browser. Use the same browser as step 'create'."); return; }
  try {
    const ks = new keyStores.InMemoryKeyStore(); await ks.setKey("mainnet", id, kp);
    const near = await connect({ networkId: "mainnet", nodeUrl: RPC, keyStore: ks });
    const a = await near.account(id);
    log(label + ": deploying code (no wallet needed)…");
    const r = await a.signAndSendTransaction({ receiverId: id, actions: [
      transactions.deployContract(code),
      transactions.functionCall("new", args, 100n * 10n ** 12n, 0n),
      ...($("pk").value.trim() ? [transactions.addKey(utils.PublicKey.from($("pk").value.trim()), transactions.fullAccessKey())] : []),
      transactions.deleteKey(utils.PublicKey.from(kp.getPublicKey().toString())),
    ] });
    const ok = r?.status && "SuccessValue" in r.status;
    log(label + (ok ? ": done ✓ " : ": FAILED ") + "https://nearblocks.io/txns/" + r.transaction.hash);
    if (ok) try { localStorage.removeItem("jdeploy:" + id); } catch {}
  } catch (e) { log(label + ": " + (e?.message || e)); }
  refresh();
}
const vaultArgs = () => { const six = (v) => String(Math.round(Number(v) * 1e6)); return { usdc: USDC, owner: account, manager: $("manager").value.trim() || account, cap_total: six($("capTotal").value), cap_account: six($("capAcct").value) }; };
async function createRelay() {
  const pk = $("relayPk").value.trim();
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(pk)) { log("Gas account: paste the server public key (ed25519:…)"); return; }
  await send(viaRegistrar(names().gas, pk, $("fundRelay").value), "Gas account");
}
let vState = "create", sState = "create";
async function smart(id, fund, code, args, label) {
  let a;
  try { a = await acct(id); } catch (e) { log(label + ": " + e.message + ". Nothing was sent. Try again."); return; }
  if (a && a.code_hash !== "11111111111111111111111111111111") { log(label + ": already deployed ✓"); return refresh(); }
  if (a) return finish(id, code, args, label);           // account exists: only put the code, no payment
  return createAccount(id, fund, label);
}
async function deployVault() { const n = names(); smart(n.vault, $("fundVault").value, wasm.joulity_vault, vaultArgs(), "Vault"); }
async function registerUsdc() {
  await send({ receiverId: USDC, actions: [
    { type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: names().vault, registration_only: true }, gas: TGAS(30), deposit: NEAR("0.00125") } },
  ] }, "USDC registration");
}
async function deploySocial() { const n = names(); smart(n.social, $("fundSocial").value, wasm.joulity_social, { usdc: n.vault }, "Social"); }

function step(id, done, text) { $(id).className = "st " + (done ? "ok" : "todo"); $(id).textContent = text; }

async function refresh() { try { await refresh2(); } catch (e) { log("Status check failed: " + (e?.message || e)); } }
async function refresh2() {
  $("who").textContent = account || "not connected";
  $("connect").textContent = account ? "Disconnect" : "Connect wallet";
  document.querySelectorAll(".need").forEach((b) => (b.disabled = !account));
  if (!account) return;
  const n = names();
  const me = await acct(account);
  $("bal").textContent = me ? (Number(BigInt(me.amount) / 10n ** 20n) / 1e4).toFixed(3) + " NEAR" : "account not found on mainnet";
  const v = await acct(n.vault), s = await acct(n.social);
  const vInfo = v ? await view(n.vault, "info") : null;
  const reg = v ? await view(USDC, "storage_balance_of", { account_id: n.vault }) : null;
  const sUsdc = s ? await view(n.social, "usdc").catch(() => null) : null;
  step("s1", !!vInfo, vInfo ? "Done ✓" : v ? "Account exists, no vault code" : "To do");
  step("s2", !!reg, reg ? "Done ✓" : "To do");
  step("s3", !!sUsdc, sUsdc ? `Done ✓ (holds ${sUsdc})` : s ? "Account exists, no code" : "To do");
  const rl = await acct(n.gas);
  step("s4", !!rl, rl ? "Done ✓ " + (Number(BigInt(rl.amount) / 10n ** 20n) / 1e4).toFixed(2) + " NEAR" : "To do");
  $("b4").disabled = !!rl;
  vState = v && !vInfo ? "finish" : "create"; sState = s && !sUsdc ? "finish" : "create";
  $("b1").textContent = vState === "finish" ? "Finish: put the code (no wallet)" : "1a. Create vault account";
  $("b3").textContent = sState === "finish" ? "Finish: put the code (no wallet)" : "Create social account";
  $("b1").disabled = !!vInfo || (vState === "finish" && !tmpKey(n.vault)); $("b2").disabled = !vInfo || !!reg; $("b3").disabled = !vInfo || !!sUsdc || (sState === "finish" && !tmpKey(n.social));
  $("infoOut").textContent = vInfo ? JSON.stringify(vInfo, null, 2) : "";
}

(async () => {
  await Promise.all([loadWasm("joulity_vault"), loadWasm("joulity_social")]).catch((e) => log("wasm load failed: " + e));
  selector = await setupWalletSelector({ network: "mainnet", modules: [setupMeteorWalletApp({ contractId: USDC }), setupMeteorWallet(), setupHereWallet(), setupNearMobileWallet({ dAppMetadata: { name: "Joulity", logoUrl: "https://app.joulity.com/favicon.ico" } }), setupMyNearWallet()] });
  modal = setupModal(selector, { contractId: "" });
  const sync = (st) => { account = st.accounts.find((a) => a.active)?.accountId || st.accounts[0]?.accountId || null; refresh(); };
  sync(selector.store.getState());
  selector.store.observable.subscribe(sync);
  $("connect").onclick = async () => { if (account) { await (await selector.wallet()).signOut(); account = null; refresh(); } else modal.show(); };
  $("b1").onclick = deployVault; $("b2").onclick = registerUsdc; $("b3").onclick = deploySocial; $("rf").onclick = refresh; $("b4").onclick = createRelay; ["vaultId", "socialId", "gasId"].forEach((i) => ($(i).onchange = refresh));
})();
