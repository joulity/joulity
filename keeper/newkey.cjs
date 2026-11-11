// Makes the keeper key ON THE SERVER. Prints only the public key. Never overwrites.
const fs = require("fs");
const { KeyPair } = require("/home/ubuntu/joulity/dash/node_modules/near-api-js");
const file = "/home/ubuntu/joulity/keeper/.env";
const account = "joulity-keeper.near";
if (fs.existsSync(file)) {
  const pub = (fs.readFileSync(file, "utf8").match(/KEEPER_PUBLIC_KEY=(.*)/) || [])[1];
  console.log("Key already exists, not changed. Public key: " + pub); process.exit(0);
}
const kp = KeyPair.fromRandom("ed25519");
fs.writeFileSync(file, `KEEPER_ACCOUNT=${account}\nKEEPER_PUBLIC_KEY=${kp.getPublicKey().toString()}\nKEEPER_SECRET=${kp.toString()}\n`, { mode: 0o600 });
console.log("Keeper: " + account + "  public key (safe to share): " + kp.getPublicKey().toString());
