#!/bin/bash
# One-time skeleton setup on the server. Safe to re-run: it skips parts that exist.
set -e
cd /home/ubuntu/joulity
[ -d .git ] || { git init -q -b main; git remote add origin https://github.com/joulity/joulity.git; }

# mobile-first app (Expo, router template)
if [ ! -f app/package.json ]; then
  rm -rf app && npx --yes create-expo-app@latest app --template default --no-install > /tmp/jn_app.log 2>&1
  (cd app && npm install --no-audit --no-fund >> /tmp/jn_app.log 2>&1)
fi

# public dashboard (Next.js, App Router, TypeScript, Tailwind)
if [ ! -f dashboard/package.json ]; then
  rm -rf dashboard && npx --yes create-next-app@latest dashboard --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes > /tmp/jn_dash.log 2>&1
fi

# contracts: unit tests + wasm build in a throwaway Rust container (nothing installed on the host)
docker run --rm -v /home/ubuntu/joulity/contracts:/c -v jn_cargo:/usr/local/cargo/registry -w /c rust:1.86 \
  bash -c "rustup target add wasm32-unknown-unknown >/dev/null 2>&1 && cargo test --quiet 2>&1 | tail -15 && cargo build --release --target wasm32-unknown-unknown --quiet && ls -la target/wasm32-unknown-unknown/release/*.wasm" > /tmp/jn_contracts.log 2>&1 || true

echo "app:       $(test -f app/package.json && echo ok || echo FAIL)"
echo "dashboard: $(test -f dashboard/package.json && echo ok || echo FAIL)"
echo "--- contracts ---"; cat /tmp/jn_contracts.log
