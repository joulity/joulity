// Negative tests with a random throwaway key (no funds, nothing can succeed on chain).
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
class W { p=[]; u8(v){this.p.push(Uint8Array.of(v));return this} u32(v){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,v,true);this.p.push(b);return this} u64(v){const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,BigInt(v),true);this.p.push(b);return this} u128(v){v=BigInt(v);return this.u64(v&((1n<<64n)-1n)).u64(v>>64n)} raw(b){this.p.push(b);return this} str(s){const b=new TextEncoder().encode(s);return this.u32(b.length).raw(b)} out(){const o=new Uint8Array(this.p.reduce((a,b)=>a+b.length,0));let i=0;for(const b of this.p){o.set(b,i);i+=b.length}return o} }
const seed = ed25519.utils.randomPrivateKey(), pk = ed25519.getPublicKey(seed), me = Buffer.from(pk).toString("hex");
const mk = (receiver, method, args, tamper) => {
  const a = new TextEncoder().encode(JSON.stringify(args));
  const d = new W().str(me).str(receiver).u32(1).u8(2).str(method).u32(a.length).raw(a).u64(100n*10n**12n).u128(0).u64(1).u64(999999999).u8(0).raw(pk).out();
  let sig = ed25519.sign(sha256(new W().u32(2**30+366).raw(d).out()), seed); if (tamper) { sig = sig.slice(); sig[0] ^= 1; }
  return Buffer.from(new W().raw(d).u8(0).raw(sig).out()).toString("base64");
};
const post = async (s) => (await fetch("https://app.api.joulity.com/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed: s }) })).json();
console.log("good sig, new account   ->", (await post(mk("joulity-social.near", "create_pocket", { name: "t", target: "1", deadline: 0 }))).error);
console.log("tampered signature      ->", (await post(mk("joulity-social.near", "create_pocket", { name: "t", target: "1", deadline: 0 }, true))).error);
console.log("other contract          ->", (await post(mk("wrap.near", "near_withdraw", { amount: "1" }))).error);
console.log("USDC to someone else    ->", (await post(mk("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "ft_transfer_call", { receiver_id: "evil.near", amount: "1", msg: "" }))).error);
console.log("vault method not listed ->", (await post(mk("joulity-vault.near", "set_paused", { paused: true }))).error);
