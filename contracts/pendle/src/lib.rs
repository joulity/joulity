//! Joulity vault strategy: Pendle fixed yield on an EVM chain (Ethereum, Base...), run from NEAR.
//! v2: chain chosen at init; the keeper may bridge in (only to a NEAR Intents deposit address); the way back stays owner only.
//!
//! - The vault sends USDC here (`vault.deploy("pendle", amount)`).
//! - `bridge_out` sends USDC to a NEAR Intents (1Click) deposit address; it arrives as USDC on Ethereum
//!   at this contract's own Ethereum address.
//! - That Ethereum address belongs to this contract through NEAR Chain Signatures (MPC, `v1.signer`):
//!   no person holds its key. `sign_eth` signs an Ethereum transaction only if it passes the policy:
//!     * USDC / PT / YT `approve` -> only to the Pendle router
//!     * Pendle router calls -> receiver must be our own address and the market must be allow-listed
//!     * USDC `transfer` (the way back through Intents) -> owner only, never the keeper
//! - The way back: USDC on Ethereum -> Intents -> USDC here -> `to_vault` (anyone can call it; money only goes to the vault).

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000); // 0.00125 NEAR
const GAS_FT: Gas = Gas::from_tgas(15);
const GAS_FT_CALL: Gas = Gas::from_tgas(60);
const GAS_SIGN: Gas = Gas::from_tgas(50);
const MAX_GAS_LIMIT: u64 = 3_000_000;
const MAX_FEE_WEI: u128 = 100_000_000_000; // 100 gwei

const APPROVE: [u8; 4] = [0x09, 0x5e, 0xa7, 0xb3];
const TRANSFER: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];

#[ext_contract(ext_signer)]
#[allow(dead_code)]
trait MpcSigner {
    fn sign(&mut self, request: SignRequest);
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[near(serializers = [json])]
pub struct SignRequest {
    pub payload: [u8; 32],
    pub path: String,
    pub key_version: u32,
}

/// An Ethereum EIP-1559 transaction (value is always 0). Addresses and data are 0x-hex.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct EthTx {
    pub nonce: U64,
    pub gas: U64,
    pub max_fee: U128,
    pub max_priority_fee: U128,
    pub to: String,
    pub data: String,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub keeper: Option<AccountId>,
    pub vault: AccountId,
    pub usdc: AccountId,
    pub signer: AccountId,
    pub path: String,
    pub strategy: String,
    pub chain_id: U64,
    pub eth_address: Option<String>,
    pub eth_usdc: String,
    pub router: String,
    pub markets: Vec<String>,
    pub tokens: Vec<String>,
    pub signed: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pendle {
    owner: AccountId,
    keeper: Option<AccountId>,
    vault: AccountId,
    usdc: AccountId,
    signer: AccountId,
    path: String,
    strategy: String,
    chain_id: u64,
    eth_address: Option<[u8; 20]>,
    eth_usdc: [u8; 20],
    router: [u8; 20],
    markets: Vec<[u8; 20]>,
    tokens: Vec<[u8; 20]>,
    signed: u64,
}

#[near]
impl Pendle {
    #[init]
    pub fn new(owner: AccountId, vault: AccountId, usdc: AccountId, signer: AccountId, eth_usdc: String, router: String, chain_id: Option<U64>, strategy: Option<String>) -> Self {
        let chain_id = chain_id.map(|c| c.0).unwrap_or(1);
        Self {
            owner,
            keeper: None,
            vault,
            usdc,
            signer,
            path: format!("evm-{chain_id}"),
            strategy: strategy.unwrap_or_else(|| "pendle".into()),
            chain_id,
            eth_address: None,
            eth_usdc: addr(&eth_usdc),
            router: addr(&router),
            markets: vec![],
            tokens: vec![],
            signed: 0,
        }
    }

    // ---------- Ethereum, through Chain Signatures ----------

    /// Sign an Ethereum transaction for this contract's own address, if the policy allows it.
    /// The result of the transaction is the MPC signature (big_r, s, recovery_id).
    #[payable]
    pub fn sign_eth(&mut self, tx: EthTx) -> Promise {
        let owner = env::predecessor_account_id() == self.owner;
        require!(owner || Some(env::predecessor_account_id()) == self.keeper, "owner or keeper only");
        require!(env::attached_deposit() >= ONE_YOCTO, "attach 1 yoctoNEAR");
        let me = self.eth_address.unwrap_or_else(|| env::panic_str("set the Ethereum address first"));
        require!(tx.gas.0 > 0 && tx.gas.0 <= MAX_GAS_LIMIT, "gas limit out of range");
        require!(tx.max_fee.0 <= MAX_FEE_WEI && tx.max_priority_fee.0 <= tx.max_fee.0, "gas price out of range");
        let to = addr(&tx.to);
        let data = unhex(&tx.data);
        let what = self.check(&to, &data, &me, owner);

        let hash = env::keccak256_array(&eip1559(self.chain_id, &tx, &to, &data));
        self.signed += 1;
        env::log_str(&format!(
            "sign_eth #{} {what}: to 0x{} nonce {} hash 0x{}",
            self.signed,
            hex(&to),
            tx.nonce.0,
            hex(&hash)
        ));
        ext_signer::ext(self.signer.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_SIGN)
            .sign(SignRequest { payload: hash, path: self.path.clone(), key_version: 0 })
    }

    /// What an Ethereum call is allowed to do. Returns a short label for the log.
    fn check(&self, to: &[u8; 20], data: &[u8], me: &[u8; 20], owner: bool) -> &'static str {
        require!(data.len() >= 4, "no method");
        let sel: [u8; 4] = data[..4].try_into().unwrap();
        let word = |i: usize| -> [u8; 20] {
            require!(data.len() >= 4 + 32 * (i + 1), "short calldata");
            let w = &data[4 + 32 * i..4 + 32 * (i + 1)];
            require!(w[..12].iter().all(|b| *b == 0), "bad address word");
            w[12..].try_into().unwrap()
        };
        if *to == self.router {
            require!(word(0) == *me, "Pendle: the receiver must be the vault's own address");
            require!(self.markets.contains(&word(1)), "Pendle: market not allowed");
            return "pendle";
        }
        if *to == self.eth_usdc || self.tokens.contains(to) {
            if sel == APPROVE {
                require!(word(0) == self.router, "approve: only the Pendle router");
                return "approve";
            }
            if sel == TRANSFER && *to == self.eth_usdc {
                require!(owner, "transfer: owner only (the way back through Intents)");
                return "bridge-back";
            }
        }
        env::panic_str("not allowed by the policy")
    }

    // ---------- NEAR side ----------

    /// Send USDC to a NEAR Intents (1Click) deposit address. Owner, or the keeper (only to a 64-hex deposit address). Attach 0.00125 NEAR (storage).
    #[payable]
    pub fn bridge_out(&mut self, deposit: AccountId, amount: U128) -> Promise {
        let me = env::predecessor_account_id();
        if me != self.owner {
            require!(Some(me) == self.keeper, "owner or keeper only");
            let d = deposit.as_str();
            require!(d.len() == 64 && d.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)), "keeper: only a NEAR Intents deposit address");
        }
        require!(env::attached_deposit() >= STORAGE, "attach 0.00125 NEAR");
        require!(amount.0 > 0, "amount");
        env::log_str(&format!("bridge_out {} to {deposit}", amount.0));
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(STORAGE)
            .with_static_gas(GAS_FT)
            .storage_deposit(Some(deposit.clone()), Some(true))
            .then(
                ext_ft::ext(self.usdc.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT)
                    .ft_transfer(deposit, amount, Some("Joulity vault -> Pendle (NEAR Intents)".into())),
            )
    }

    /// USDC held here goes back to the vault. Anyone can call it: the money can only go to the vault.
    pub fn to_vault(&mut self, amount: U128) -> Promise {
        require!(amount.0 > 0, "amount");
        env::log_str(&format!("to_vault {}", amount.0));
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_CALL)
            .ft_transfer_call(self.vault.clone(), amount, None, format!("{{\"return\":\"{}\"}}", self.strategy))
    }

    // ---------- owner ----------

    /// Set once: the address `v1.signer` derives for (this account, path). Anyone can check it with
    /// `v1.signer.derived_public_key({path, predecessor, domain_id: 0})`.
    pub fn set_eth_address(&mut self, address: String) {
        self.only_owner();
        require!(self.eth_address.is_none() || self.signed == 0, "already in use");
        self.eth_address = Some(addr(&address));
    }

    /// kind: "market" (Pendle market or YT, checked in router calls) or "token" (PT/YT that may be approved to the router)
    pub fn allow(&mut self, kind: String, address: String, on: bool) {
        self.only_owner();
        let a = addr(&address);
        let list = match kind.as_str() {
            "market" => &mut self.markets,
            "token" => &mut self.tokens,
            _ => env::panic_str("kind: market or token"),
        };
        list.retain(|x| *x != a);
        if on {
            list.push(a);
        }
    }

    pub fn set_keeper(&mut self, keeper: Option<AccountId>) {
        self.only_owner();
        self.keeper = keeper;
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.only_owner();
        self.owner = owner;
    }

    pub fn config(&self) -> Config {
        let h = |a: &[u8; 20]| format!("0x{}", hex(a));
        Config {
            owner: self.owner.clone(),
            keeper: self.keeper.clone(),
            vault: self.vault.clone(),
            usdc: self.usdc.clone(),
            signer: self.signer.clone(),
            path: self.path.clone(),
            strategy: self.strategy.clone(),
            chain_id: U64(self.chain_id),
            eth_address: self.eth_address.as_ref().map(h),
            eth_usdc: h(&self.eth_usdc),
            router: h(&self.router),
            markets: self.markets.iter().map(h).collect(),
            tokens: self.tokens.iter().map(h).collect(),
            signed: U64(self.signed),
        }
    }

    /// The exact hash `sign_eth` would sign (for checking off chain).
    pub fn tx_hash(&self, tx: EthTx) -> String {
        let to = addr(&tx.to);
        format!("0x{}", hex(&env::keccak256_array(&eip1559(self.chain_id, &tx, &to, &unhex(&tx.data)))))
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
}

// ---------- helpers: hex, RLP, EIP-1559 ----------

fn unhex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    require!(s.len() % 2 == 0, "hex length");
    let v = |c: u8| -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            _ => env::panic_str("bad hex"),
        }
    };
    s.as_bytes().chunks(2).map(|p| (v(p[0]) << 4) | v(p[1])).collect()
}

fn hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

fn addr(s: &str) -> [u8; 20] {
    let b = unhex(s);
    require!(b.len() == 20, "address must be 20 bytes");
    b.try_into().unwrap()
}

fn rlp_len(len: usize, short: u8, out: &mut Vec<u8>) {
    if len <= 55 {
        out.push(short + len as u8);
    } else {
        let be = len.to_be_bytes();
        let i = be.iter().position(|x| *x != 0).unwrap();
        out.push(short + 55 + (be.len() - i) as u8);
        out.extend_from_slice(&be[i..]);
    }
}

fn rlp_bytes(b: &[u8], out: &mut Vec<u8>) {
    if b.len() == 1 && b[0] < 0x80 {
        out.push(b[0]);
    } else {
        rlp_len(b.len(), 0x80, out);
        out.extend_from_slice(b);
    }
}

fn rlp_uint(v: u128, out: &mut Vec<u8>) {
    let be = v.to_be_bytes();
    let i = be.iter().position(|x| *x != 0).unwrap_or(be.len());
    rlp_bytes(&be[i..], out);
}

/// 0x02 || rlp([chainId, nonce, maxPriorityFee, maxFee, gas, to, value=0, data, accessList=[]])
fn eip1559(chain_id: u64, tx: &EthTx, to: &[u8; 20], data: &[u8]) -> Vec<u8> {
    let mut p = Vec::new();
    rlp_uint(chain_id as u128, &mut p);
    rlp_uint(tx.nonce.0 as u128, &mut p);
    rlp_uint(tx.max_priority_fee.0, &mut p);
    rlp_uint(tx.max_fee.0, &mut p);
    rlp_uint(tx.gas.0 as u128, &mut p);
    rlp_bytes(to, &mut p);
    rlp_uint(0, &mut p);
    rlp_bytes(data, &mut p);
    p.push(0xc0);
    let mut out = vec![0x02];
    rlp_len(p.len(), 0xc0, &mut out);
    out.extend(p);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ME: &str = "0x1111111111111111111111111111111111111111";
    const ROUTER: &str = "0x888888888889758F76e7103c6CbF23ABbF58F946";
    const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const MARKET: &str = "0x9c560ebaf78e596cbcc27411d633a74d628dd7dc";

    fn ctx(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).attached_deposit(ONE_YOCTO).build());
    }
    fn setup() -> Pendle {
        ctx("owner.near");
        let mut c = Pendle::new("owner.near".parse().unwrap(), "vault.near".parse().unwrap(), "usdc.near".parse().unwrap(), "v1.signer".parse().unwrap(), USDC.into(), ROUTER.into(), None, None);
        c.set_eth_address(ME.into());
        c.allow("market".into(), MARKET.into(), true);
        c.set_keeper(Some("keeper.near".parse().unwrap()));
        c
    }
    fn w(a: &str) -> String {
        format!("{:0>64}", a.trim_start_matches("0x").to_lowercase())
    }
    fn tx(to: &str, data: String) -> EthTx {
        EthTx { nonce: U64(0), gas: U64(500_000), max_fee: U128(2_000_000_000), max_priority_fee: U128(1_000_000), to: to.into(), data }
    }

    #[test]
    fn rlp_matches_known_vector() {
        // the classic EIP-155 example values, as a type-2 tx (checked against ethers.js)
        let t = EthTx { nonce: U64(9), gas: U64(21000), max_fee: U128(20_000_000_000), max_priority_fee: U128(1_000_000_000), to: "0x3535353535353535353535353535353535353535".into(), data: "0x".into() };
        let raw = eip1559(1, &t, &addr(&t.to), &[]);
        assert_eq!(hex(&raw), "02e80109843b9aca008504a817c80082520894353535353535353535353535353535353535353580 80c0".replace(" ", ""));
    }

    #[test]
    fn pendle_buy_to_self_ok() {
        let c = setup();
        let d = format!("0xc81f847a{}{}{}", w(ME), w(MARKET), w("01"));
        assert_eq!(c.check(&addr(ROUTER), &unhex(&d), &addr(ME), false), "pendle");
    }

    #[test]
    #[should_panic(expected = "receiver must be the vault's own address")]
    fn pendle_buy_to_other_fails() {
        let c = setup();
        let d = format!("0xc81f847a{}{}", w("0x2222222222222222222222222222222222222222"), w(MARKET));
        c.check(&addr(ROUTER), &unhex(&d), &addr(ME), true);
    }

    #[test]
    #[should_panic(expected = "market not allowed")]
    fn unknown_market_fails() {
        let c = setup();
        let d = format!("0xc81f847a{}{}", w(ME), w("0x3333333333333333333333333333333333333333"));
        c.check(&addr(ROUTER), &unhex(&d), &addr(ME), true);
    }

    #[test]
    fn approve_router_ok_other_fails() {
        let c = setup();
        let ok = format!("0x095ea7b3{}{}", w(ROUTER), w("ff"));
        assert_eq!(c.check(&addr(USDC), &unhex(&ok), &addr(ME), false), "approve");
        let bad = format!("0x095ea7b3{}{}", w("0x4444444444444444444444444444444444444444"), w("ff"));
        let r = std::panic::catch_unwind(|| c.check(&addr(USDC), &unhex(&bad), &addr(ME), true));
        assert!(r.is_err());
    }

    #[test]
    fn transfer_owner_only() {
        let c = setup();
        let d = format!("0xa9059cbb{}{}", w("0x5555555555555555555555555555555555555555"), w("10"));
        assert_eq!(c.check(&addr(USDC), &unhex(&d), &addr(ME), true), "bridge-back");
        let r = std::panic::catch_unwind(|| c.check(&addr(USDC), &unhex(&d), &addr(ME), false));
        assert!(r.is_err());
    }

    #[test]
    #[should_panic(expected = "not allowed by the policy")]
    fn random_contract_fails() {
        let c = setup();
        let d = format!("0xa9059cbb{}{}", w(ME), w("10"));
        c.check(&addr("0x6666666666666666666666666666666666666666"), &unhex(&d), &addr(ME), true);
    }

    #[test]
    #[should_panic(expected = "owner or keeper only")]
    fn stranger_cannot_sign() {
        let mut c = setup();
        ctx("bob.near");
        c.sign_eth(tx(USDC, format!("0x095ea7b3{}{}", w(ROUTER), w("ff"))));
    }

    #[test]
    #[should_panic(expected = "keeper: only a NEAR Intents deposit address")]
    fn keeper_bridge_named_account_fails() {
        let mut c = setup();
        ctx("keeper.near");
        c.bridge_out("abc.near".parse().unwrap(), U128(1));
    }

    #[test]
    #[should_panic(expected = "owner or keeper only")]
    fn stranger_cannot_bridge_out() {
        let mut c = setup();
        ctx("bob.near");
        c.bridge_out("e418627fadfc96dba9814679d57c8b1673c29fddbebfab620d4195630e7edcfb".parse().unwrap(), U128(1));
    }

    #[test]
    fn base_chain_and_path() {
        let c = Pendle::new("o.near".parse().unwrap(), "v.near".parse().unwrap(), "u.near".parse().unwrap(), "v1.signer".parse().unwrap(), USDC.into(), ROUTER.into(), Some(U64(8453)), Some("pendle-base".into()));
        let k = c.config();
        assert_eq!(k.chain_id.0, 8453);
        assert_eq!(k.path, "evm-8453");
        assert_eq!(k.strategy, "pendle-base");
    }
}
