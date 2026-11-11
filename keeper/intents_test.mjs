// TEST (keeper's own NEAR only): the "inside NEAR Intents" path, like the app.
// 1) register the keeper's key in intents.near  2) deposit 0.2 NEAR (as wNEAR) into the keeper's Intents account
// 3) ask solvers for a quote wNEAR -> ETH  4) sign a token_diff intent (NEP-413) and publish it  5) withdraw the ETH to the
// Pendle strategy's Ethereum address. Prints the time of each step. Never prints keys.
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { connect, keyStores, KeyPair, transactions } = require("/home/ubuntu/joulity/dash/node_modules/near-api-js");
const ENV = Object.fromEntries(fs.readFileSync("/home/ubuntu/joulity/keeper/.env", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ME = ENV.KEEPER_ACCOUNT, KP = KeyPair.fromString(ENV.KEEPER_SECRET), PK = KP.getPublicKey().toString();
const INTENTS = "intents.near", RELAY = "https://solver-relay-v2.chaindefuser.com/rpc";
const ETH_TO = "0x35cb6bc7c5b57ad5706713338d4b5747f0cdf6bc";
const AMT = 200_000_000_000_000_000_000_000n; // 0.2 NEAR
const T0 = Date.now(), log = (...a) => console.log(`[+${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const TG = (n) => BigInt(n) * 10n ** 12n;
const fc = (m, a, g, d) => transactions.functionCall(m, a, TG(g), BigInt(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) { let n = BigInt("0x" + Buffer.from(buf).toString("hex")), s = ""; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = "1" + s; else break; } return s; }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const bstr = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u32(b.length), b]); };
function sign413(message) {
  const nonce = crypto.randomBytes(32);
  const data = Buffer.concat([u32(2147484061), bstr(message), nonce, bstr(INTENTS), Buffer.from([0])]);
  const hash = crypto.createHash("sha256").update(data).digest();
  const sig = KP.sign(hash).signature;
  return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient: INTENTS }, public_key: PK, signature: "ed25519:" + b58(sig) };
}
const relay = async (method, params) => (await (await fetch(RELAY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params: [params] }) })).json());

const ks = new keyStores.InMemoryKeyStore(); await ks.setKey("mainnet", ME, KP);
const acc = await (await connect({ networkId: "mainnet", nodeUrl: "https://rpc.mainnet.fastnear.com", keyStore: ks })).account(ME);
const view = (c, m, a) => acc.viewFunction({ contractId: c, methodName: m, args: a });

// 1. key
const has = await view(INTENTS, "has_public_key", { account_id: ME, public_key: PK }).catch(() => false);
log("key registered in intents.near:", has);
if (!has) { const r = await acc.functionCall({ contractId: INTENTS, methodName: "add_public_key", args: { public_key: PK }, gas: TG(30), attachedDeposit: 1n }); log("add_public_key", r.transaction.hash); }

// 2. deposit 0.2 NEAR into the keeper's Intents account
const OUT = process.env.OUT || "nep141:eth.omft.near";
const have0 = BigInt(await view(INTENTS, "mt_balance_of", { account_id: ME, token_id: "nep141:wrap.near" }));
const r2 = have0 >= AMT ? { transaction: { hash: "(skipped, already inside)" } } : await acc.signAndSendTransaction({ receiverId: "wrap.near", actions: [
  fc("storage_deposit", { account_id: ME, registration_only: true }, 20, 1_250_000_000_000_000_000_000n),
  fc("near_deposit", {}, 20, AMT),
  fc("ft_transfer_call", { receiver_id: INTENTS, amount: AMT.toString(), msg: "" }, 100, 1n),
] });
log("deposit tx", r2.transaction.hash);
const bal = async (t) => BigInt(await view(INTENTS, "mt_balance_of", { account_id: ME, token_id: t }));
log("wNEAR inside Intents:", (await bal("nep141:wrap.near")).toString());

// 3. quote from solvers
const q = await relay("quote", { defuse_asset_identifier_in: "nep141:wrap.near", defuse_asset_identifier_out: OUT, exact_amount_in: AMT.toString(), min_deadline_ms: 60000 });
const quotes = (q.result || []).sort((a, b) => (BigInt(b.amount_out) > BigInt(a.amount_out) ? 1 : -1));
log("quotes:", quotes.length, quotes[0] ? "best " + quotes[0].amount_out + " wei ETH" : JSON.stringify(q).slice(0, 200));
if (!quotes[0]) process.exit(1);

// 4. sign + publish the swap
const dl = new Date(Date.now() + 120e3).toISOString();
const msg1 = JSON.stringify({ signer_id: ME, deadline: dl, intents: [{ intent: "token_diff", diff: { "nep141:wrap.near": "-" + AMT.toString(), [OUT]: quotes[0].amount_out } }] });
const pub = await relay("publish_intent", { quote_hashes: [quotes[0].quote_hash], signed_data: sign413(msg1) });
log("publish:", JSON.stringify(pub.result || pub.error).slice(0, 200));
const ih = pub.result?.intent_hash; if (!ih) process.exit(1);
for (let i = 0; i < 60; i++) { const s = await relay("get_status", { intent_hash: ih }); const st = s.result?.status; if (i % 3 === 0 || st === "SETTLED") log("swap status:", st, s.result?.data?.hash || ""); if (st === "SETTLED" || st === "NOT_FOUND_OR_NOT_VALID") break; await sleep(2000); }
const eth = await bal(OUT); log("after swap, inside Intents:", OUT, eth.toString());
if (eth === 0n || process.env.NO_WITHDRAW) process.exit(0);

// 5. withdraw the ETH to the Pendle Ethereum address (signed by the keeper, executed on chain by the keeper)
const msg2 = JSON.stringify({ signer_id: ME, deadline: new Date(Date.now() + 120e3).toISOString(), intents: [{ intent: "ft_withdraw", token: "eth.omft.near", receiver_id: "eth.omft.near", amount: eth.toString(), memo: "WITHDRAW_TO:" + ETH_TO }] });
const r5 = await acc.functionCall({ contractId: INTENTS, methodName: "execute_intents", args: { signed: [sign413(msg2)] }, gas: TG(300), attachedDeposit: 0n });
const fail = JSON.stringify(r5.receipts_outcome || []).match(/"Failure":\{.{0,200}/);
log("withdraw tx", r5.transaction.hash, fail ? "FAILED " + fail[0] : "ok");
for (let i = 0; i < 60; i++) {
  const j = await (await fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [ETH_TO, "latest"] }) })).json();
  const w = BigInt(j.result || "0x0"); if (w > 0n) { log("ETH on Ethereum:", (Number(w) / 1e18).toFixed(6)); break; }
  if (i % 6 === 0) log("waiting for ETH on Ethereum…"); await sleep(5000);
}
