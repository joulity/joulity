//! Joulity vault strategy: lend USDC on Rhea (Burrow) on NEAR. No bridge, no other chain.
//!
//! - The vault sends USDC here (`vault.deploy("rhea", amount)`).
//! - `supply` puts it on Rhea (supplied, not collateral: nothing here can borrow or be liquidated).
//! - `withdraw` takes it back from Rhea to this contract.
//! - `to_vault` sends USDC back to the vault (anyone can call it; the money can only go to the vault).
//! - The contract has no key; only the owner (or a keeper) can call supply / withdraw.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_FT_CALL: Gas = Gas::from_tgas(120);
const GAS_EXEC: Gas = Gas::from_tgas(150);
const GAS_STORAGE: Gas = Gas::from_tgas(20);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait Ft {
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String);
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub keeper: Option<AccountId>,
    pub vault: AccountId,
    pub usdc: AccountId,
    pub burrow: AccountId,
    pub strategy: String,
    pub extra_decimals: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Lend {
    owner: AccountId,
    keeper: Option<AccountId>,
    vault: AccountId,
    usdc: AccountId,
    burrow: AccountId,
    strategy: String,
    extra_decimals: u8,
}

#[near]
impl Lend {
    #[init]
    pub fn new(owner: AccountId, vault: AccountId, usdc: AccountId, burrow: AccountId) -> Self {
        Self { owner, keeper: None, vault, usdc, burrow, strategy: "rhea".into(), extra_decimals: 12 }
    }

    /// Open the account on Rhea (storage). Owner attaches the NEAR Rhea asks for (0.1 is enough).
    #[payable]
    pub fn register(&mut self) -> Promise {
        self.only_owner();
        Promise::new(self.burrow.clone()).function_call(
            "storage_deposit".to_string(),
            json!({ "account_id": env::current_account_id(), "registration_only": false }).to_string().into_bytes(),
            env::attached_deposit(),
            GAS_STORAGE,
        )
    }

    /// USDC held here -> supplied on Rhea (earns the supply rate).
    pub fn supply(&mut self, amount: U128) -> Promise {
        self.only_operator();
        require!(amount.0 > 0, "amount");
        env::log_str(&format!("supply {}", amount.0));
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_CALL)
            .ft_transfer_call(self.burrow.clone(), amount, None, String::new())
    }

    /// Rhea -> USDC back here. `amount` in USDC units (6 decimals); None = everything.
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        self.only_operator();
        let scale = 10u128.pow(self.extra_decimals as u32);
        let max = amount.map(|a| U128(a.0 * scale));
        env::log_str(&format!("withdraw {:?}", amount.map(|a| a.0)));
        let action = match max {
            Some(m) => json!({ "Withdraw": { "token_id": self.usdc, "max_amount": m } }),
            None => json!({ "Withdraw": { "token_id": self.usdc } }),
        };
        Promise::new(self.burrow.clone()).function_call(
            "execute".to_string(),
            json!({ "actions": [action] }).to_string().into_bytes(),
            ONE_YOCTO,
            GAS_EXEC,
        )
    }

    /// USDC held here goes back to the vault. Anyone can call it: the money can only go to the vault.
    pub fn to_vault(&mut self, amount: U128) -> Promise {
        require!(amount.0 > 0, "amount");
        env::log_str(&format!("to_vault {}", amount.0));
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(Gas::from_tgas(60))
            .ft_transfer_call(self.vault.clone(), amount, None, format!("{{\"return\":\"{}\"}}", self.strategy))
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
        Config {
            owner: self.owner.clone(),
            keeper: self.keeper.clone(),
            vault: self.vault.clone(),
            usdc: self.usdc.clone(),
            burrow: self.burrow.clone(),
            strategy: self.strategy.clone(),
            extra_decimals: self.extra_decimals,
        }
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
    fn only_operator(&self) {
        let p = env::predecessor_account_id();
        require!(p == self.owner || Some(p) == self.keeper, "owner or keeper only");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).build());
    }
    fn setup() -> Lend {
        ctx("owner.near");
        Lend::new("owner.near".parse().unwrap(), "vault.near".parse().unwrap(), "usdc.near".parse().unwrap(), "burrow.near".parse().unwrap())
    }

    #[test]
    fn owner_can_supply_and_withdraw() {
        let mut c = setup();
        let _ = c.supply(U128(5_000_000));
        let _ = c.withdraw(Some(U128(1_000_000)));
        let _ = c.withdraw(None);
    }

    #[test]
    fn keeper_can_operate() {
        let mut c = setup();
        c.set_keeper(Some("keeper.near".parse().unwrap()));
        ctx("keeper.near");
        let _ = c.supply(U128(1));
    }

    #[test]
    #[should_panic(expected = "owner or keeper only")]
    fn stranger_cannot_withdraw() {
        let mut c = setup();
        ctx("bob.near");
        let _ = c.withdraw(None);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn keeper_cannot_change_owner() {
        let mut c = setup();
        c.set_keeper(Some("keeper.near".parse().unwrap()));
        ctx("keeper.near");
        c.set_owner("keeper.near".parse().unwrap());
    }

    #[test]
    fn anyone_can_return_to_vault() {
        let mut c = setup();
        ctx("bob.near");
        let _ = c.to_vault(U128(1));
    }
}
