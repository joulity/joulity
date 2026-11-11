//! Joulity vault on NEAR: put USDC in, get jUSD (a NEP-141 share token) whose value grows with the vault.
//!
//! - jUSD price = total assets / jUSD supply. Total assets = USDC held here (cash) + the value of each strategy.
//! - Pockets, goals and circles (the social contract) hold jUSD, so every saved dollar earns.
//! - The manager moves USDC to allow-listed strategies (lending, Taler, delta neutral, Pendle via NEAR Intents)
//!   within caps, and reports their value. A report can only move a strategy's value a little per day,
//!   and a cash floor always stays here so people can take money out at once.
//! - Hackathon safety: a cap on total deposits and a cap per account.
//! - Cash is counted internally: tokens sent without a message do not change the price (no donation attack).

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{
    env, ext_contract, near, require, serde_json, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

const BPS: u128 = 10_000;
const DAY: u64 = 86_400;
const SEC: u64 = 1_000_000_000;
const GAS_FT: Gas = Gas::from_tgas(15);
const GAS_CB: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// a report may always move a value by this much (1 USDC), so tiny strategies can be updated
const REPORT_SLACK: u128 = 1_000_000;

#[ext_contract(ext_usdc)]
#[allow(dead_code)]
trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Token,
    Strategies,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Strategy {
    /// where the USDC goes (a keeper or bridge account the owner approved)
    pub receiver: AccountId,
    /// max share of total assets in this strategy
    pub cap_bps: u16,
    /// value in USDC units, as last reported
    pub value: U128,
    pub reported_at: u64,
    pub note: String,
}

#[near(serializers = [json])]
pub struct Info {
    pub total_assets: U128,
    pub cash: U128,
    pub supply: U128,
    /// USDC units for 1 jUSD (1_000_000 = $1.000000)
    pub price: U128,
    pub floor_bps: u16,
    pub cap_total: U128,
    pub cap_account: U128,
    pub paused: bool,
}

#[near(serializers = [json])]
struct Msg {
    /// a strategy sends USDC back (principal and profit)
    #[serde(rename = "return")]
    ret: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    token: FungibleToken,
    usdc: AccountId,
    owner: AccountId,
    manager: AccountId,
    cash: u128,
    strategies: IterableMap<String, Strategy>,
    floor_bps: u16,
    max_move_bps_day: u16,
    cap_total: u128,
    cap_account: u128,
    paused: bool,
}

#[near]
impl Vault {
    #[init]
    pub fn new(usdc: AccountId, owner: AccountId, manager: AccountId, cap_total: U128, cap_account: U128) -> Self {
        let mut v = Self {
            token: FungibleToken::new(Key::Token),
            usdc,
            owner,
            manager,
            cash: 0,
            strategies: IterableMap::new(Key::Strategies),
            floor_bps: 2_000,
            max_move_bps_day: 50,
            cap_total: cap_total.0,
            cap_account: cap_account.0,
            paused: false,
        };
        let me = env::current_account_id();
        v.token.internal_register_account(&me);
        v
    }

    // ---------- people ----------

    /// Burn jUSD, get USDC back from the cash here. Fails if the cash is not enough right now.
    pub fn redeem(&mut self, shares: U128) -> Promise {
        let me = env::predecessor_account_id();
        require!(shares.0 > 0, "nothing to redeem");
        let amount = self.to_assets(shares.0);
        require!(amount > 0, "too small");
        require!(amount <= self.cash, "not enough cash right now, try a smaller amount");
        self.token.internal_withdraw(&me, shares.0);
        self.cash -= amount;
        ext_usdc::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT)
            .ft_transfer(me.clone(), U128(amount), Some("Joulity vault redeem".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_redeem(me, shares, U128(amount)))
    }

    #[private]
    pub fn on_redeem(&mut self, #[callback_result] r: Result<(), PromiseError>, account: AccountId, shares: U128, amount: U128) {
        if r.is_ok() {
            return;
        }
        // the transfer failed: give the jUSD back
        self.token.internal_deposit(&account, shares.0);
        self.cash += amount.0;
    }

    // ---------- manager ----------

    /// Send USDC to a strategy, keeping the cash floor and the strategy cap.
    pub fn deploy(&mut self, name: String, amount: U128) -> Promise {
        self.only_manager();
        let total = self.total_assets();
        let mut s = self.strategies.get(&name).cloned().unwrap_or_else(|| env::panic_str("no such strategy"));
        require!(amount.0 > 0 && amount.0 <= self.cash, "amount over cash");
        require!((self.cash - amount.0) * BPS >= total * self.floor_bps as u128, "would break the cash floor");
        require!((s.value.0 + amount.0) * BPS <= total * s.cap_bps as u128, "over the strategy cap");
        self.cash -= amount.0;
        s.value = U128(s.value.0 + amount.0);
        let to = s.receiver.clone();
        self.strategies.insert(name.clone(), s);
        ext_usdc::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT)
            .ft_transfer(to, amount, Some(format!("Joulity vault -> {name}")))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_deploy(name, amount))
    }

    #[private]
    pub fn on_deploy(&mut self, #[callback_result] r: Result<(), PromiseError>, name: String, amount: U128) {
        if r.is_ok() {
            return;
        }
        self.cash += amount.0;
        if let Some(s) = self.strategies.get_mut(&name) {
            s.value = U128(s.value.0.saturating_sub(amount.0));
        }
    }

    /// Update a strategy's value. It can move at most `max_move_bps_day` per day since the last report (+1 USDC).
    pub fn report(&mut self, name: String, value: U128) {
        self.only_manager();
        let now = env::block_timestamp() / SEC;
        let max_move = self.max_move_bps_day as u128;
        let s = self.strategies.get_mut(&name).unwrap_or_else(|| env::panic_str("no such strategy"));
        let elapsed = (now.saturating_sub(s.reported_at)).min(30 * DAY) as u128;
        let allowed = REPORT_SLACK + s.value.0 * max_move * elapsed / (BPS * DAY as u128);
        let diff = s.value.0.abs_diff(value.0);
        require!(diff <= allowed, "value moved too much: the owner must confirm it");
        s.value = value;
        s.reported_at = now;
    }

    // ---------- owner ----------

    pub fn set_strategy(&mut self, name: String, receiver: AccountId, cap_bps: u16, note: String) {
        self.only_owner();
        require!(cap_bps as u128 <= BPS, "cap over 100%");
        let now = env::block_timestamp() / SEC;
        let value = self.strategies.get(&name).map(|s| s.value).unwrap_or(U128(0));
        self.strategies.insert(name, Strategy { receiver, cap_bps, value, reported_at: now, note });
    }

    /// Owner-confirmed value (a big gain or a loss). Logged on chain.
    pub fn confirm_value(&mut self, name: String, value: U128) {
        self.only_owner();
        let now = env::block_timestamp() / SEC;
        let s = self.strategies.get_mut(&name).unwrap_or_else(|| env::panic_str("no such strategy"));
        env::log_str(&format!("confirm_value {name}: {} -> {}", s.value.0, value.0));
        s.value = value;
        s.reported_at = now;
    }

    pub fn set_limits(&mut self, floor_bps: u16, max_move_bps_day: u16, cap_total: U128, cap_account: U128) {
        self.only_owner();
        require!(floor_bps as u128 <= BPS, "floor over 100%");
        self.floor_bps = floor_bps;
        self.max_move_bps_day = max_move_bps_day;
        self.cap_total = cap_total.0;
        self.cap_account = cap_account.0;
    }

    pub fn set_manager(&mut self, manager: AccountId) {
        self.only_owner();
        self.manager = manager;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.only_owner();
        self.paused = paused;
    }

    // ---------- views ----------

    pub fn info(&self) -> Info {
        Info {
            total_assets: U128(self.total_assets()),
            cash: U128(self.cash),
            supply: U128(self.token.total_supply),
            price: U128(self.to_assets_or_one(1_000_000)),
            floor_bps: self.floor_bps,
            cap_total: U128(self.cap_total),
            cap_account: U128(self.cap_account),
            paused: self.paused,
        }
    }

    pub fn strategies(&self) -> Vec<(String, Strategy)> {
        self.strategies.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// USDC value of an account's jUSD
    pub fn value_of(&self, account_id: AccountId) -> U128 {
        U128(self.to_assets(self.token.accounts.get(&account_id).unwrap_or(0)))
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }
}

impl Vault {
    fn total_assets(&self) -> u128 {
        self.cash + self.strategies.values().map(|s| s.value.0).sum::<u128>()
    }
    fn to_assets(&self, shares: u128) -> u128 {
        let supply = self.token.total_supply;
        if supply == 0 {
            return 0;
        }
        shares * self.total_assets() / supply
    }
    fn to_assets_or_one(&self, shares: u128) -> u128 {
        if self.token.total_supply == 0 { shares } else { self.to_assets(shares) }
    }
    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
    fn only_manager(&self) {
        let p = env::predecessor_account_id();
        require!(p == self.manager || p == self.owner, "manager only");
    }
    fn ensure_registered(&mut self, a: &AccountId) {
        if !self.token.accounts.contains_key(a) {
            self.token.internal_register_account(a);
        }
    }
    /// USDC in -> jUSD out. Returns what is refunded.
    fn mint(&mut self, sender: AccountId, amount: u128) -> u128 {
        if self.paused || amount < 1_000_000 {
            return amount;
        }
        let total = self.total_assets();
        if total + amount > self.cap_total {
            return amount;
        }
        let supply = self.token.total_supply;
        let shares = if supply == 0 || total == 0 { amount } else { amount * supply / total };
        if shares == 0 {
            return amount;
        }
        let have = self.to_assets(self.token.accounts.get(&sender).unwrap_or(0));
        if have + amount > self.cap_account {
            return amount;
        }
        self.ensure_registered(&sender);
        self.token.internal_deposit(&sender, shares);
        self.cash += amount;
        near_contract_standards::fungible_token::events::FtMint { owner_id: &sender, amount: U128(shares), memo: Some("deposit") }.emit();
        0
    }
}

#[near]
impl FungibleTokenReceiver for Vault {
    /// USDC only. msg "" = deposit; {"return":"name"} = a strategy sends money back.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "only USDC");
        if msg.is_empty() {
            return PromiseOrValue::Value(U128(self.mint(sender_id, amount.0)));
        }
        let m: Msg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("msg: \"\" or {\"return\":\"name\"}"));
        let name = m.ret.unwrap_or_else(|| env::panic_str("msg: {\"return\":\"name\"}"));
        let s = self.strategies.get_mut(&name).unwrap_or_else(|| env::panic_str("no such strategy"));
        require!(sender_id == s.receiver, "only the strategy receiver");
        // more than the value = realised profit; it stays as cash and raises the jUSD price
        s.value = U128(s.value.0.saturating_sub(amount.0));
        self.cash += amount.0;
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl FungibleTokenCore for Vault {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.ensure_registered(&receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.ensure_registered(&receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Vault {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Vault {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, _force: Option<bool>) -> bool {
        env::panic_str("not supported: redeem your jUSD instead")
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Vault {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Joulity Dollar".to_string(),
            symbol: "jUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const USD: u128 = 1_000_000;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(pred: &str, secs: u64, yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("vault.joulity.near"))
            .predecessor_account_id(acc(pred))
            .block_timestamp(secs * SEC)
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }
    fn new() -> Vault {
        ctx("joulity.near", 1_000, 0);
        let mut v = Vault::new(acc("usdc.near"), acc("joulity.near"), acc("keeper.joulity.near"), U128(10_000 * USD), U128(1_000 * USD));
        v.set_strategy("taler".into(), acc("keeper.joulity.near"), 2_000, "Taler TLO".into());
        v
    }
    fn deposit(v: &mut Vault, who: &str, usd: u128) -> u128 {
        ctx("usdc.near", 1_000, 0);
        match v.ft_on_transfer(acc(who), U128(usd * USD), String::new()) {
            PromiseOrValue::Value(r) => r.0,
            _ => panic!(),
        }
    }

    #[test]
    fn deposit_report_and_price_rises() {
        let mut v = new();
        assert_eq!(deposit(&mut v, "alice.near", 600), 0);
        assert_eq!(deposit(&mut v, "bob.near", 400), 0);
        assert_eq!(v.info().price.0, USD);
        ctx("keeper.joulity.near", 1_000, 0);
        let _ = v.deploy("taler".into(), U128(200 * USD));
        assert_eq!(v.info().cash.0, 800 * USD);
        // 30 days later the strategy earned 1%: allowed (0.5%/day)
        ctx("keeper.joulity.near", 1_000 + 30 * DAY, 0);
        v.report("taler".into(), U128(202 * USD));
        assert_eq!(v.info().total_assets.0, 1_002 * USD);
        assert_eq!(v.value_of(acc("alice.near")).0, 601_200_000);
        // a newcomer pays the new price: same value in, same value out
        assert_eq!(deposit(&mut v, "carol.near", 100), 0);
        let c = v.value_of(acc("carol.near")).0;
        assert!(c <= 100 * USD && c >= 100 * USD - 1);
    }

    #[test]
    fn caps_floor_and_report_limit() {
        let mut v = new();
        assert_eq!(deposit(&mut v, "alice.near", 1_001), 1_001 * USD, "over the per-account cap is refunded");
        deposit(&mut v, "alice.near", 1_000);
        ctx("keeper.joulity.near", 1_000, 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = v.deploy("taler".into(), U128(300 * USD)); }));
        assert!(r.is_err(), "over the 20% strategy cap");
        let _ = v.deploy("taler".into(), U128(200 * USD));
        ctx("keeper.joulity.near", 1_000 + DAY, 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.report("taler".into(), U128(150 * USD))));
        assert!(r.is_err(), "a 25% drop in a day needs the owner");
    }

    #[test]
    #[should_panic(expected = "would break the cash floor")]
    fn floor_is_kept() {
        let mut v = new();
        deposit(&mut v, "alice.near", 1_000);
        ctx("joulity.near", 1_000, 0);
        v.set_strategy("pendle".into(), acc("keeper.joulity.near"), 9_000, "Pendle".into());
        ctx("keeper.joulity.near", 1_000, 0);
        let _ = v.deploy("pendle".into(), U128(850 * USD));
    }

    #[test]
    fn redeem_and_failed_transfer_restores() {
        let mut v = new();
        deposit(&mut v, "alice.near", 100);
        ctx("alice.near", 1_000, 0);
        let _ = v.redeem(U128(40 * USD));
        assert_eq!(v.info().cash.0, 60 * USD);
        ctx("vault.joulity.near", 1_000, 0);
        v.on_redeem(Err(PromiseError::Failed), acc("alice.near"), U128(40 * USD), U128(40 * USD));
        assert_eq!(v.ft_balance_of(acc("alice.near")).0, 100 * USD);
        assert_eq!(v.info().cash.0, 100 * USD);
    }

    #[test]
    fn strategy_returns_with_profit() {
        let mut v = new();
        deposit(&mut v, "alice.near", 1_000);
        ctx("keeper.joulity.near", 1_000, 0);
        let _ = v.deploy("taler".into(), U128(200 * USD));
        ctx("usdc.near", 1_000, 0);
        let _ = v.ft_on_transfer(acc("keeper.joulity.near"), U128(210 * USD), "{\"return\":\"taler\"}".into());
        let i = v.info();
        assert_eq!((i.cash.0, i.total_assets.0), (1_010 * USD, 1_010 * USD));
        assert_eq!(i.price.0, 1_010_000);
    }

    #[test]
    fn transfer_to_a_new_account_registers_it() {
        let mut v = new();
        deposit(&mut v, "alice.near", 50);
        ctx("alice.near", 1_000, 1);
        v.ft_transfer(acc("social.joulity.near"), U128(20 * USD), None);
        assert_eq!(v.ft_balance_of(acc("social.joulity.near")).0, 20 * USD);
    }
}
