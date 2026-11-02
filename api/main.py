"""Joulity NEAR backend.

Reads NEAR mainnet state for the app and the public dashboard, and (later) runs the gas relayer and the
Intents keeper. It never holds user keys. Secrets come from the environment only (see .env.example).
"""
import os
import time

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

NEAR_RPC = os.getenv("NEAR_RPC", "https://rpc.mainnet.near.org")
SOCIAL_CONTRACT = os.getenv("SOCIAL_CONTRACT", "")      # e.g. social.joulity.near, empty until deployed
ONECLICK = "https://1click.chaindefuser.com/v0"

app = FastAPI(title="Joulity NEAR API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","), allow_methods=["GET", "POST"])


async def view(contract: str, method: str, args: dict) -> object:
    """Call a NEAR view method and decode its JSON result."""
    import base64, json
    body = {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "call_function", "finality": "final", "account_id": contract,
        "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode()}}
    async with httpx.AsyncClient(timeout=10) as c:
        r = (await c.post(NEAR_RPC, json=body)).json()
    if "error" in r or "result" not in r or "result" not in r["result"]:
        raise HTTPException(502, f"NEAR RPC: {r.get('error') or r.get('result', {}).get('error')}")
    return json.loads(bytes(r["result"]["result"]).decode() or "null")


@app.get("/health")
async def health():
    return {"ok": True, "time": int(time.time()), "social_contract": SOCIAL_CONTRACT or None}


@app.get("/v1/pocket/{pid}")
async def pocket(pid: int):
    if not SOCIAL_CONTRACT:
        raise HTTPException(503, "social contract not deployed yet")
    return await view(SOCIAL_CONTRACT, "get_pocket", {"id": pid})


@app.get("/v1/circle/{cid}")
async def circle(cid: int):
    if not SOCIAL_CONTRACT:
        raise HTTPException(503, "social contract not deployed yet")
    return await view(SOCIAL_CONTRACT, "get_circle", {"id": cid})


@app.get("/v1/tokens")
async def tokens():
    """Assets NEAR Intents can bring in (for "add money from any chain")."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{ONECLICK}/tokens")
    r.raise_for_status()
    return r.json()
