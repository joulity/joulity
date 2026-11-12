# Joulity on NEAR

**The group pot, rebuilt on NEAR.**
Personal or shared pockets in dollars (USDC). Money comes in from any chain. It earns on its own, in a vault that runs on NEAR.
Login with email or Google: no seed phrase, no gas to pay.

Built at the NEAR Hackathon (November 2026). Tracks: Social Money, Real-World Money, Unstoppable DeFi.

## Why

People save together for one goal all over the world: stokvels in South Africa, family funds in Saudi Arabia, vaquitas in Mexico, cagnottes in France. Everywhere it has the same three problems:

| Today | With Joulity |
|---|---|
| One person holds the cash | The money sits in escrow on NEAR. Nobody can withdraw alone |
| It earns nothing | Savings are held as jUSD in the Joulity vault and earn while they wait |
| It can't cross borders (bank fees, IBANs, 3-5 day transfers) | Deposit from any chain and any country with NEAR Intents, in about a minute |

## The group rules

A shared goal has rules set once, when it is created. Members join by invite link on those rules, and the contract `joulity-social.near` enforces them:

| Rule | What the code does |
|---|---|
| Goal | A target amount and a date |
| Money | Held by the contract, never by a member |
| Release | Paid out only when members holding 75% of the money vote yes |
| Leaving | One member leaving needs more than 50% of the money |
| Plans change | A refund vote, or 30 days past the date with no release: everyone takes back their part plus its yield |
| While it waits | The pot holds jUSD, so it earns the vault yield |

## Live

| What | Link |
|---|---|
| Demo video (2:15, on X) | https://x.com/AzaiezH/status/2120969376367329509 |
| Landing (2D and 3D story) | https://app.joulity.com |
| The app (mobile first, works on desktop) | https://app.joulity.com/bank |
| Admin pages (owner signs with his wallet) | https://app.joulity.com/dash |
| Keeper status (JSON) | https://app.joulity.com/dash/keeper/status.json |

## On NEAR mainnet

| Account | Role |
|---|---|
| `joulity-vault.near` | Vault. USDC in, jUSD shares out. 20% cash floor, cap per strategy, bounded value reports |
| `joulity-social.near` | Pockets (personal or collective), shared goals with votes, savings circles. Holds jUSD, so every pocket earns |
| `joulity-lend.near` | Strategy: lends USDC on Rhea (Burrow) |
| `joulity-pendle.near` | Strategy: fixed-rate Pendle PT on Ethereum, signed from NEAR with Chain Signatures, bridged with NEAR Intents |
| `joulity-keeper.near` | Vault manager. Moves spare cash to strategies, refills the cash floor, reports value |
| `joulity-gas.near` | Gas operator (NEP-366 meta transactions): users never pay gas for app actions |

USDC on NEAR: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`

## How it works

```
 any chain (Base, Solana, Ethereum, Arbitrum, Tron, BNB, NEAR...)
        |  NEAR Intents (1Click): one-time deposit address, ~30 s
        v
 user's NEAR account (Privy email login, implicit account)
        |  meta tx paid by joulity-gas.near
        v
 joulity-vault.near  -- USDC -> jUSD (shares, price only goes up with real profit)
        |                        |
        |                        +--> joulity-social.near: pockets, goals, circles hold jUSD
        v
 keeper: cash floor 20% ---> joulity-lend.near (Rhea)  ---> back to vault {"return":"rhea"}
                       \--> joulity-pendle.near --(Intents)--> Ethereum PT (Chain Signatures) --> back {"return":"pendle"}
```

## Try it (do X, see Y)

1. **Open the app**: go to https://app.joulity.com/bank and press *Try the demo*. You see a home with a balance, pockets and shared goals (demo data, stored only in your browser).
2. **Create a pocket**: tap *Pocket*, choose *Just me* (personal) or *Together · free* / *Together · locked goal* (collective). The new pocket appears on Home. Collective pockets show *Invite*; personal pockets do not.
3. **Shared goal with a vote**: open a goal (Goals tab). You see the progress ring, the plan per person per month and the vote bar with the 75% mark. Releasing the money needs 75% of the money in the goal; one member leaving needs more than 50%.
4. **Add money from any chain** (real account, *Continue with email*): tap *Add*, choose a coin and a network, type an amount. You get a quote from NEAR Intents, then a one-time deposit address. Send from any wallet; the status updates every 5 s and the USDC lands on your NEAR account in about 30 s.
5. **Earn**: in a real pocket, *Save* sends USDC to `joulity-vault.near` (you get jUSD) and puts the jUSD in your pocket on `joulity-social.near`. Two signatures, no gas (meta transactions).
6. **Check the vault on chain**: `near view joulity-vault.near info '{}'` (or any NEAR explorer) shows total, cash and strategies. The keeper status JSON above shows its last actions.
7. **Contracts tests**:
   ```bash
   cd contracts
   cargo test            # social 19, vault 6, lend 5, pendle 11
   ```

## Repository

| Folder | What | Stack |
|---|---|---|
| `contracts/social` | Pockets, shared goals (escrow + money-weighted votes), savings circles, reward circles | Rust, near-sdk 5.28 |
| `contracts/vault` | jUSD vault: shares, cash floor, strategy caps, bounded reports | Rust |
| `contracts/lend` | Rhea lending strategy | Rust |
| `contracts/pendle` | Pendle PT strategy on an EVM chain via Chain Signatures + NEAR Intents | Rust |
| `app` | The savings app (Expo, React Native + web). Privy login, NEAR Intents deposits, meta tx | TypeScript |
| `relayer` | Gas operator: NEP-366 relayer with an allow-list of methods and per-account limits | Node |
| `keeper` | Vault keeper: cash floor, Rhea, Pendle, value reports | Node |
| `dash` | Owner pages: deploy, strategies, bridge. The owner signs every step in his own wallet | JS + wallet-selector |
| `dashboard`, `api` | Public dashboard and API skeletons | Next.js, FastAPI |
| `landing` | Landing page and the 3D story (three.js) | HTML/JS |

Build notes: contracts are built as MVP wasm (`target-cpu=mvp`) and pinned to near-sdk 5.28.3 for the current mainnet protocol. See `contracts/DEPLOY.md`.
The 3D characters and animations (Mixamo) are not in this repository; they are served from the live site only.

## Safety

- No private key is stored in this repository. Server keys live in `.env` files (not in git), see `.env.example`.
- The relayer only pays for allow-listed calls (USDC to the vault, jUSD to the social contract, redeem, social methods), with limits per account, per IP and in total.
- Vault: cash floor 20%, cap per strategy, value reports bounded to 0.5% per day (bigger moves need the owner).
- Hackathon caps: small totals on mainnet. Rhea had an exploit in April 2026: the lending strategy is capped.

## Disclosure (hackathon rules)

- Everything in this repository was written during the hackathon (tag `pre-hackathon` = empty baseline).
- The Joulity team also runs a separate product on Base (joulity.com, October 2026). UI ideas come from it; the NEAR code here is new. Only the NEAR work should be judged.
- Libraries: near-sdk, near-api-js, wallet-selector, Privy, Expo, three.js and their dependencies. AI coding assistants were used.

## License

MIT, see `LICENSE`.
