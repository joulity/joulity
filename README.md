# Joulity on NEAR

**The social savings neobank.** Save with friends, from any chain, with an email login. NEAR runs everything underneath.

Built for the NEAR Hackathon (November 2026). Tracks: Social Money, Real-World Money, Unstoppable DeFi, Privacy & Private AI.

## What is in this repo

| Folder | What | Stack |
|---|---|---|
| `contracts/social` | Group pockets and savings circles in USDC on NEAR | Rust, near-sdk 5 |
| `api` | Backend: reads NEAR state, gas relayer and Intents keeper (coming) | Python, FastAPI |
| `app` | The mobile-first savings app | Expo (React Native + web) |
| `dashboard` | Public vault dashboard, Paper and Real modes | Next.js |

## Try it

_Coming: "do X, see Y" steps for each feature, on NEAR mainnet with tiny amounts._

```bash
# contracts: build and run the unit tests
cd contracts && cargo test

# backend
cp .env.example .env && docker compose up -d api
curl http://127.0.0.1:7510/health
```

## Disclosure (hackathon rules)

- Everything in this repository was written during the hackathon (from November 2, 2026).
- The Joulity team also runs a Base product (savings app at joulity.com/app and a jUSD vault on Base, built October 2026).
  Some UI ideas and patterns come from that app; the NEAR code here is new. Only the NEAR integration should be judged.
- Libraries: near-sdk, FastAPI, Expo, Next.js and their dependencies. AI coding assistants were used.

## License

MIT, see `LICENSE`.
