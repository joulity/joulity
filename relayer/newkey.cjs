// Makes the gas-relayer key ON THE SERVER. Prints only the public key. Never overwrites.
const fs = require("fs");
const { KeyPair } = require("/home/ubuntu/joulity/dash/node_modules/near-api-js");
const file = "/home/ubuntu/joulity/relayer/.env";
const account = process.argv[2];
if (!account || !/^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.near$/.test(account)) { console.log("usage: node newkey.cjs joulity-gas.near"); process.exit(1); }
if (fs.existsSync(file)) {
  const pub = (fs.readFileSync(file, "utf8").match(/RELAYER_PUBLIC_KEY=(.*)/) || [])[1];
  console.log("Key already exists, not changed. Public key: " + pub); process.exit(0);
}
const kp = KeyPair.fromRandom("ed25519");
fs.writeFileSync(file, `RELAYER_ACCOUNT=${account}\nRELAYER_PUBLIC_KEY=${kp.getPublicKey().toString()}\nRELAYER_SECRET=${kp.toString()}\n`, { mode: 0o600 });
console.log("Gas account: " + account);
console.log("Public key (safe to share): " + kp.getPublicKey().toString());
