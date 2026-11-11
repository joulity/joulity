//! Joulity social savings on NEAR.
//!
//! Four products, all in one stablecoin (USDC on NEAR):
//! - Group pocket: friends put money towards one goal; each member owns what they put in and can take it back.
//! - Savings circle: every member pays a fixed amount each round; each round one member receives the whole pot,
//!   in join order. The contract holds the money and enforces the order, so nobody has to trust the organiser.
//! - Shared goal (`goal.rs`): one event, one objective; money in escrow, every exit is a vote
//!   (75% to release to the organiser, majority to refund or let one member leave).
//! - Reward circle (`reward.rs`): only the yield rotates, never the money; boosters take their yield early and
//!   pay a premium that becomes the savers' bonus.
//!
//! Money comes in with `ft_transfer_call` on the USDC contract
//! (msg = {"pocket": id}, {"circle": id}, {"reward": id}, or {"reward_yield": id} for yield sent in by the vault).
//! Every payout is an `ft_transfer` with a callback that puts the balance back if the transfer fails.

mod goal;
mod reward;

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, serde_json, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const MAX_MEMBERS: usize = 50;
const GAS_FT: Gas = Gas::from_tgas(15);
const GAS_CB: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const SEC: u64 = 1_000_000_000;

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Pockets,
    Circles,
    Rewards,
    Goals,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Member {
    pub account: AccountId,
    pub balance: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Pocket {
    pub name: String,
    pub creator: AccountId,
    /// goal in USDC units (6 decimals); 0 = no goal
    pub target: U128,
    /// unix seconds; 0 = none (informational: members can always take back what they put in)
    pub deadline: u64,
    pub total: U128,
    pub members: Vec<Member>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Circle {
    pub name: String,
    pub creator: AccountId,
    /// what every member pays each round (USDC units)
    pub amount: U128,
    /// seconds per round
    pub period: u64,
    /// payout order = join order
    pub members: Vec<AccountId>,
    pub max_members: u32,
    /// unix seconds; 0 = not started (members can still join)
    pub started_at: u64,
    /// current round, 0-based; == members.len() when finished
    pub round: u32,
    /// who paid in the current round
    pub paid: Vec<bool>,
    /// money collected in the current round
    pub pot: U128,
    /// missed payments per member, over all rounds
    pub missed: Vec<u32>,
}

impl Circle {
    fn finished(&self) -> bool {
        self.started_at > 0 && self.round as usize >= self.members.len()
    }
    /// unix seconds when the current round may be paid out even if someone has not paid
    pub fn round_end(&self) -> u64 {
        self.started_at + (self.round as u64 + 1) * self.period
    }
}

#[near(serializers = [json])]
struct DepositMsg {
    pocket: Option<u64>,
    circle: Option<u64>,
    reward: Option<u64>,
    reward_yield: Option<u64>,
    goal: Option<u64>,
    goal_yield: Option<u64>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    usdc: AccountId,
    next_id: u64,
    pockets: LookupMap<u64, Pocket>,
    circles: LookupMap<u64, Circle>,
    rewards: LookupMap<u64, reward::RewardCircle>,
    goals: LookupMap<u64, goal::Goal>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(usdc: AccountId) -> Self {
        Self { usdc, next_id: 1, pockets: LookupMap::new(Key::Pockets), circles: LookupMap::new(Key::Circles), rewards: LookupMap::new(Key::Rewards), goals: LookupMap::new(Key::Goals) }
    }

    // ---------- group pockets ----------

    pub fn create_pocket(&mut self, name: String, target: U128, deadline: u64) -> u64 {
        require!(!name.is_empty() && name.len() <= 64, "name: 1-64 characters");
        let id = self.take_id();
        let creator = env::predecessor_account_id();
        let members = vec![Member { account: creator.clone(), balance: U128(0) }];
        self.pockets.insert(id, Pocket { name, creator, target, deadline, total: U128(0), members });
        id
    }

    /// Take back up to what you put in. The balance comes back if the transfer fails.
    pub fn withdraw_pocket(&mut self, id: u64, amount: U128) -> Promise {
        let me = env::predecessor_account_id();
        let p = self.pockets.get_mut(&id).unwrap_or_else(|| env::panic_str("no such pocket"));
        let m = p.members.iter_mut().find(|m| m.account == me).unwrap_or_else(|| env::panic_str("not a member"));
        require!(amount.0 > 0 && amount.0 <= m.balance.0, "amount over your balance");
        m.balance = U128(m.balance.0 - amount.0);
        p.total = U128(p.total.0 - amount.0);
        self.send(me.clone(), amount).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_pocket_withdraw(id, me, amount))
    }

    #[private]
    pub fn on_pocket_withdraw(&mut self, #[callback_result] r: Result<(), PromiseError>, id: u64, account: AccountId, amount: U128) {
        if r.is_ok() {
            return;
        }
        let p = self.pockets.get_mut(&id).expect("pocket");
        if let Some(m) = p.members.iter_mut().find(|m| m.account == account) {
            m.balance = U128(m.balance.0 + amount.0);
        }
        p.total = U128(p.total.0 + amount.0);
    }

    // ---------- savings circles ----------

    pub fn create_circle(&mut self, name: String, amount: U128, period: u64, max_members: u32) -> u64 {
        require!(!name.is_empty() && name.len() <= 64, "name: 1-64 characters");
        require!(amount.0 > 0, "amount must be > 0");
        require!(period >= 60, "period: at least 60 seconds");
        require!((2..=MAX_MEMBERS as u32).contains(&max_members), "members: 2-50");
        let id = self.take_id();
        let creator = env::predecessor_account_id();
        self.circles.insert(
            id,
            Circle {
                name,
                creator: creator.clone(),
                amount,
                period,
                members: vec![creator],
                max_members,
                started_at: 0,
                round: 0,
                paid: vec![],
                pot: U128(0),
                missed: vec![],
            },
        );
        id
    }

    pub fn join_circle(&mut self, id: u64) {
        let me = env::predecessor_account_id();
        let c = self.circles.get_mut(&id).unwrap_or_else(|| env::panic_str("no such circle"));
        require!(c.started_at == 0, "circle already started");
        require!(!c.members.contains(&me), "already a member");
        require!(c.members.len() < c.max_members as usize, "circle is full");
        c.members.push(me);
    }

    /// The creator starts the circle; the payout order is fixed from here.
    pub fn start_circle(&mut self, id: u64) {
        let c = self.circles.get_mut(&id).unwrap_or_else(|| env::panic_str("no such circle"));
        require!(env::predecessor_account_id() == c.creator, "only the creator can start");
        require!(c.started_at == 0, "already started");
        require!(c.members.len() >= 2, "need at least 2 members");
        c.started_at = env::block_timestamp() / SEC;
        c.paid = vec![false; c.members.len()];
        c.missed = vec![0; c.members.len()];
    }

    /// Pays this round's pot to its recipient: once everyone has paid, or after the round ends.
    /// Anyone can call it. Members who did not pay get a missed payment on their record.
    pub fn payout(&mut self, id: u64) -> Promise {
        let now = env::block_timestamp() / SEC;
        let c = self.circles.get_mut(&id).unwrap_or_else(|| env::panic_str("no such circle"));
        require!(c.started_at > 0 && !c.finished(), "circle not running");
        let all_paid = c.paid.iter().all(|p| *p);
        require!(all_paid || now >= c.round_end(), "round still open");
        require!(c.pot.0 > 0, "nothing collected");
        let to = c.members[c.round as usize].clone();
        let pot = c.pot;
        let round = c.round;
        for (i, p) in c.paid.iter().enumerate() {
            if !p {
                c.missed[i] += 1;
            }
        }
        c.pot = U128(0);
        c.paid = vec![false; c.members.len()];
        c.round += 1;
        self.send(to, pot).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_payout(id, round, pot))
    }

    /// A failed payout keeps the money in the circle as a pot owed to that round's recipient.
    #[private]
    pub fn on_payout(&mut self, #[callback_result] r: Result<(), PromiseError>, id: u64, round: u32, pot: U128) {
        if r.is_ok() {
            return;
        }
        env::log_str(&format!("payout failed: circle {id} round {round}, {} kept in the contract", pot.0));
        let c = self.circles.get_mut(&id).expect("circle");
        c.round = round;
        c.pot = U128(c.pot.0 + pot.0);
        c.paid = vec![true; c.members.len()]; // the round is complete; payout can be retried
    }

    // ---------- money in ----------

    /// NEP-141 receiver. Returns the amount to refund.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "only USDC");
        let m: DepositMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("msg: {\"pocket\":id}, {\"circle\":id}, {\"reward\":id}, {\"goal\":id} …"));
        let n = [m.pocket, m.circle, m.reward, m.reward_yield, m.goal, m.goal_yield].iter().filter(|x| x.is_some()).count();
        require!(n == 1, "msg: exactly one of pocket, circle, reward, reward_yield, goal, goal_yield");
        let refund = if let Some(id) = m.pocket {
            self.deposit_pocket(id, sender_id, amount.0)
        } else if let Some(id) = m.circle {
            self.deposit_circle(id, sender_id, amount.0)
        } else if let Some(id) = m.reward {
            self.deposit_reward(id, sender_id, amount.0)
        } else if let Some(id) = m.reward_yield {
            self.deposit_reward_yield(id, amount.0)
        } else if let Some(id) = m.goal {
            self.deposit_goal(id, sender_id, amount.0)
        } else {
            self.deposit_goal_yield(m.goal_yield.unwrap(), amount.0)
        };
        PromiseOrValue::Value(U128(refund))
    }

    // ---------- views ----------

    pub fn get_pocket(&self, id: u64) -> Option<Pocket> {
        self.pockets.get(&id).cloned()
    }

    pub fn get_circle(&self, id: u64) -> Option<Circle> {
        self.circles.get(&id).cloned()
    }

    pub fn usdc(&self) -> AccountId {
        self.usdc.clone()
    }
}

impl Contract {
    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn send(&self, to: AccountId, amount: U128) -> Promise {
        ext_ft::ext(self.usdc.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(GAS_FT).ft_transfer(to, amount, None)
    }

    /// Anyone may put money in a group pocket; a first deposit makes them a member.
    fn deposit_pocket(&mut self, id: u64, sender: AccountId, amount: u128) -> u128 {
        let Some(p) = self.pockets.get_mut(&id) else { return amount };
        match p.members.iter_mut().find(|m| m.account == sender) {
            Some(m) => m.balance = U128(m.balance.0 + amount),
            None => {
                if p.members.len() >= MAX_MEMBERS {
                    return amount;
                }
                p.members.push(Member { account: sender, balance: U128(amount) });
            }
        }
        p.total = U128(p.total.0 + amount);
        0
    }

    /// Exactly the round amount, once per round, members only; anything else is refunded.
    fn deposit_circle(&mut self, id: u64, sender: AccountId, amount: u128) -> u128 {
        let Some(c) = self.circles.get_mut(&id) else { return amount };
        if c.started_at == 0 || c.finished() {
            return amount;
        }
        let Some(i) = c.members.iter().position(|m| *m == sender) else { return amount };
        if c.paid[i] || amount < c.amount.0 {
            return amount;
        }
        c.paid[i] = true;
        c.pot = U128(c.pot.0 + c.amount.0);
        amount - c.amount.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(pred: &str, secs: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("social.joulity.near"))
            .predecessor_account_id(acc(pred))
            .block_timestamp(secs * SEC)
            .build());
    }
    fn pay(c: &mut Contract, from: &str, amount: u128, msg: &str) -> u128 {
        ctx("usdc.near", 1_000);
        match c.ft_on_transfer(acc(from), U128(amount), msg.to_string()) {
            PromiseOrValue::Value(v) => v.0,
            _ => panic!("expected a value"),
        }
    }

    #[test]
    fn pocket_deposit_withdraw_and_restore() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_pocket("Trip".into(), U128(1_000_000_000), 0);
        assert_eq!(pay(&mut c, "alice.near", 50_000_000, &format!("{{\"pocket\":{id}}}")), 0);
        assert_eq!(pay(&mut c, "bob.near", 30_000_000, &format!("{{\"pocket\":{id}}}")), 0);
        let p = c.get_pocket(id).unwrap();
        assert_eq!(p.total.0, 80_000_000);
        assert_eq!(p.members.len(), 2);

        ctx("bob.near", 1_000);
        let _ = c.withdraw_pocket(id, U128(10_000_000));
        assert_eq!(c.get_pocket(id).unwrap().total.0, 70_000_000);
        // the transfer failed: bob's money comes back
        ctx("social.joulity.near", 1_000);
        c.on_pocket_withdraw(Err(PromiseError::Failed), id, acc("bob.near"), U128(10_000_000));
        let p = c.get_pocket(id).unwrap();
        assert_eq!(p.total.0, 80_000_000);
        assert_eq!(p.members[1].balance.0, 30_000_000);
    }

    #[test]
    #[should_panic(expected = "amount over your balance")]
    fn cannot_take_more_than_you_put_in() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_pocket("Trip".into(), U128(0), 0);
        pay(&mut c, "bob.near", 5, &format!("{{\"pocket\":{id}}}"));
        ctx("alice.near", 1_000);
        let _ = c.withdraw_pocket(id, U128(1));
    }

    #[test]
    fn circle_full_cycle() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_circle("Family".into(), U128(100_000_000), 86_400 * 30, 3);
        ctx("bob.near", 1_000);
        c.join_circle(id);
        ctx("carol.near", 1_000);
        c.join_circle(id);
        ctx("alice.near", 1_000);
        c.start_circle(id);
        let msg = format!("{{\"circle\":{id}}}");

        // wrong amount, outsider and double payment are refunded
        assert_eq!(pay(&mut c, "bob.near", 99_000_000, &msg), 99_000_000);
        assert_eq!(pay(&mut c, "dave.near", 100_000_000, &msg), 100_000_000);
        assert_eq!(pay(&mut c, "bob.near", 120_000_000, &msg), 20_000_000); // overpay: extra comes back
        assert_eq!(pay(&mut c, "bob.near", 100_000_000, &msg), 100_000_000);

        for who in ["alice.near", "carol.near"] {
            assert_eq!(pay(&mut c, who, 100_000_000, &msg), 0);
        }
        assert_eq!(c.get_circle(id).unwrap().pot.0, 300_000_000);

        ctx("anyone.near", 1_000);
        let _ = c.payout(id); // round 0 pays alice
        let s = c.get_circle(id).unwrap();
        assert_eq!((s.round, s.pot.0), (1, 0));

        // round 1: carol does not pay; after the round ends, bob gets what was collected and carol gets a missed payment
        pay(&mut c, "alice.near", 100_000_000, &msg);
        pay(&mut c, "bob.near", 100_000_000, &msg);
        ctx("anyone.near", 1_000 + 86_400 * 60);
        let _ = c.payout(id);
        let s = c.get_circle(id).unwrap();
        assert_eq!(s.round, 2);
        assert_eq!(s.missed, vec![0, 0, 1]);
    }

    #[test]
    #[should_panic(expected = "round still open")]
    fn no_early_payout_while_someone_has_not_paid() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_circle("Family".into(), U128(10), 3_600, 2);
        ctx("bob.near", 1_000);
        c.join_circle(id);
        ctx("alice.near", 1_000);
        c.start_circle(id);
        pay(&mut c, "alice.near", 10, &format!("{{\"circle\":{id}}}"));
        ctx("anyone.near", 1_100);
        let _ = c.payout(id);
    }

    #[test]
    fn failed_payout_keeps_the_money_for_a_retry() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_circle("Pair".into(), U128(10), 3_600, 2);
        ctx("bob.near", 1_000);
        c.join_circle(id);
        ctx("alice.near", 1_000);
        c.start_circle(id);
        let msg = format!("{{\"circle\":{id}}}");
        pay(&mut c, "alice.near", 10, &msg);
        pay(&mut c, "bob.near", 10, &msg);
        ctx("anyone.near", 1_000);
        let _ = c.payout(id);
        ctx("social.joulity.near", 1_000);
        c.on_payout(Err(PromiseError::Failed), id, 0, U128(20));
        let s = c.get_circle(id).unwrap();
        assert_eq!((s.round, s.pot.0), (0, 20));
        ctx("anyone.near", 1_000);
        let _ = c.payout(id); // retry works
        assert_eq!(c.get_circle(id).unwrap().round, 1);
    }

    #[test]
    #[should_panic(expected = "only USDC")]
    fn only_usdc_is_accepted() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        ctx("fake-token.near", 1_000);
        let _ = c.ft_on_transfer(acc("alice.near"), U128(1), "{\"pocket\":1}".into());
    }
}
