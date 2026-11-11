# Joulity on NEAR mainnet: deploy (you sign every step)

Tool: near-cli-rs (`npm i -g near-cli-rs` or the installer from github.com/near/near-cli-rs).
Files in this folder: `joulity_vault.wasm`, `joulity_social.wasm` (MVP wasm, tests: vault 6/6, social 19/19).
Cost: about 10 NEAR in total (contract storage ~3 NEAR each + gas + a small user-gas fund).

USDC on NEAR = `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`

## 1. Accounts
`joulity.near` must exist and hold ~10 NEAR (create it in a wallet such as Meteor or MyNearWallet).
Import it into near-cli-rs (`near account import-account`), then:

```
near account create-account fund-myself vault.joulity.near '3.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as joulity.near network-config mainnet sign-with-keychain send
near account create-account fund-myself social.joulity.near '3.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as joulity.near network-config mainnet sign-with-keychain send
near account create-account fund-myself keeper.joulity.near '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as joulity.near network-config mainnet sign-with-keychain send
```

## 2. Register the vault and the keeper in USDC (token storage)
```
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit json-args '{"account_id":"vault.joulity.near","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as joulity.near network-config mainnet sign-with-keychain send
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit json-args '{"account_id":"keeper.joulity.near","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as joulity.near network-config mainnet sign-with-keychain send
```

## 3. Deploy the vault (jUSD)
Hackathon safety caps: $5,000 in total, $200 per account (change later with `set_limits`).
```
near contract deploy vault.joulity.near use-file joulity_vault.wasm with-init-call new json-args '{"usdc":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","owner":"joulity.near","manager":"keeper.joulity.near","cap_total":"5000000000","cap_account":"200000000"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

## 4. Deploy the social contract on jUSD
Pockets, goals and circles hold jUSD, so all their money earns in the vault.
```
near contract deploy social.joulity.near use-file joulity_social.wasm with-init-call new json-args '{"usdc":"vault.joulity.near"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

## 5. Check (read-only, no signing)
```
near contract call-function as-read-only vault.joulity.near info json-args '{}' network-config mainnet now
near contract call-function as-read-only vault.joulity.near ft_metadata json-args '{}' network-config mainnet now
near contract call-function as-read-only social.joulity.near usdc json-args '{}' network-config mainnet now
```

## Later (owner, when strategies are ready)
```
near contract call-function as-transaction vault.joulity.near set_strategy json-args '{"name":"taler","receiver":"keeper.joulity.near","cap_bps":2000,"note":"Taler TLO via NEAR Intents"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as joulity.near network-config mainnet sign-with-keychain send
```

Keys stay in your keychain. Never paste a private key in chat.
