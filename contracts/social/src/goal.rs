//! Shared goal ("cha9a9a"): one event, one objective, run like a small DAO.
//!
//! - Friends put USDC towards one goal (a trip, a wedding, a gift). The money is locked in escrow here.
//! - Nobody can take money out alone. Every exit is a vote, weighted by the money each member put in
//!   (1 USDC = 1 vote, so tiny deposits cannot buy a say):
//!     * Release to the organiser:           75% yes.
//!     * Refund everyone before the date:    more than 50% yes.
//!     * Let one member leave with their part: more than 50% yes.
//! - If nothing is released within 30 days after the date, the goal opens for refunds by itself.
//! - Yield sent in by the vault ({"goal_yield": id}) grows the pot; refunds are pro rata, so members also get the yield.
//! - Gamification on chain: a monthly streak per member (paid this month and the month before).

use crate::*;

const MONTH: u64 = 30 * 86_400;
const GRACE: u64 = 30 * 86_400;
const VOTE_TIME: u64 = 7 * 86_400;
const MIN_VOTER: u128 = 1_000_000; // 1 USDC

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct GoalMember {
    pub account: AccountId,
    /// money put in (USDC units); 0 after a refund or a leave
    pub put: U128,
    /// months in a row with a deposit
    pub streak: u32,
    /// month index (from creation) of the last deposit, +1 so 0 = never
    pub last_month: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum Action {
    Release,
    RefundAll,
    Leave { account: AccountId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Proposal {
    pub action: Action,
    pub by: AccountId,
    pub ends: u64,
    pub yes: Vec<AccountId>,
    pub no: Vec<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum Status {
    Open,
    Released,
    Refunding,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Goal {
    pub name: String,
    pub organizer: AccountId,
    pub target: U128,
    /// unix seconds of the event
    pub date: u64,
    pub created: u64,
    pub members: Vec<GoalMember>,
    /// sum of `put`
    pub total: U128,
    /// USDC held (put + yield)
    pub cash: U128,
    pub status: Status,
    pub proposal: Option<Proposal>,
    /// refunds: the pot and the base they are shared from
    pub refund_cash: U128,
    pub refund_base: U128,
}

impl Goal {
    fn find(&self, who: &AccountId) -> Option<usize> {
        self.members.iter().position(|m| &m.account == who)
    }
    fn weight(&self, list: &[AccountId]) -> u128 {
        list.iter().filter_map(|a| self.find(a)).map(|i| self.members[i].put.0).sum()
    }
    fn passed(&self, p: &Proposal) -> bool {
        let yes = self.weight(&p.yes);
        let all = self.total.0;
        if all == 0 {
            return false;
        }
        match p.action {
            Action::Release => yes * 4 >= all * 3,
            _ => yes * 2 > all,
        }
    }
    fn failed(&self, p: &Proposal, now: u64) -> bool {
        let no = self.weight(&p.no);
        let all = self.total.0;
        let blocked = match p.action {
            Action::Release => no * 4 > all,
            _ => no * 2 >= all,
        };
        blocked || now >= p.ends
    }
    /// past the date and the grace: refunds open by themselves
    fn expired(&self, now: u64) -> bool {
        self.status == Status::Open && now >= self.date + GRACE
    }
    fn start_refund(&mut self) {
        self.status = Status::Refunding;
        self.refund_cash = self.cash;
        self.refund_base = self.total;
        self.proposal = None;
    }
    fn part(&self, i: usize) -> u128 {
        if self.total.0 == 0 {
            return 0;
        }
        self.cash.0 * self.members[i].put.0 / self.total.0
    }
}

#[near]
impl Contract {
    pub fn create_goal(&mut self, name: String, target: U128, date: u64) -> u64 {
        require!(!name.is_empty() && name.len() <= 64, "name: 1-64 characters");
        require!(target.0 > 0, "target must be > 0");
        let now = env::block_timestamp() / SEC;
        require!(date > now, "date must be in the future");
        let id = self.take_id();
        let organizer = env::predecessor_account_id();
        let members = vec![GoalMember { account: organizer.clone(), put: U128(0), streak: 0, last_month: 0 }];
        self.goals.insert(
            id,
            Goal {
                name,
                organizer,
                target,
                date,
                created: now,
                members,
                total: U128(0),
                cash: U128(0),
                status: Status::Open,
                proposal: None,
                refund_cash: U128(0),
                refund_base: U128(0),
            },
        );
        id
    }

    /// Any member with at least 1 USDC in may open a vote; one vote at a time, 7 days long.
    pub fn propose(&mut self, id: u64, action: Action) {
        let me = env::predecessor_account_id();
        let now = env::block_timestamp() / SEC;
        let g = self.goals.get_mut(&id).unwrap_or_else(|| env::panic_str("no such goal"));
        require!(g.status == Status::Open, "goal is closed");
        let i = g.find(&me).unwrap_or_else(|| env::panic_str("not a member"));
        require!(g.members[i].put.0 >= MIN_VOTER, "put at least 1 USDC to vote");
        if let Some(p) = &g.proposal {
            require!(g.failed(p, now), "a vote is already open");
        }
        if let Action::Leave { account } = &action {
            let j = g.find(account).unwrap_or_else(|| env::panic_str("not a member"));
            require!(g.members[j].put.0 > 0, "nothing to take out");
        }
        g.proposal = Some(Proposal { action, by: me.clone(), ends: now + VOTE_TIME, yes: vec![me], no: vec![] });
    }

    /// Vote yes or no. When the vote passes, it runs at once.
    pub fn vote(&mut self, id: u64, yes: bool) -> PromiseOrValue<()> {
        let me = env::predecessor_account_id();
        let now = env::block_timestamp() / SEC;
        let g = self.goals.get_mut(&id).unwrap_or_else(|| env::panic_str("no such goal"));
        require!(g.status == Status::Open, "goal is closed");
        let i = g.find(&me).unwrap_or_else(|| env::panic_str("not a member"));
        require!(g.members[i].put.0 >= MIN_VOTER, "put at least 1 USDC to vote");
        let mut p = g.proposal.clone().unwrap_or_else(|| env::panic_str("no open vote"));
        require!(now < p.ends, "vote is over");
        p.yes.retain(|a| a != &me);
        p.no.retain(|a| a != &me);
        if yes { p.yes.push(me) } else { p.no.push(me) }
        let passed = g.passed(&p);
        g.proposal = Some(p.clone());
        if !passed {
            return PromiseOrValue::Value(());
        }
        g.proposal = None;
        match p.action {
            Action::RefundAll => {
                g.start_refund();
                PromiseOrValue::Value(())
            }
            Action::Release => {
                let amount = g.cash;
                let to = g.organizer.clone();
                g.status = Status::Released;
                g.cash = U128(0);
                PromiseOrValue::Promise(
                    self.send(to, amount).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_goal_release(id, amount)),
                )
            }
            Action::Leave { account } => {
                let j = g.find(&account).expect("member");
                let out = g.part(j);
                let put = g.members[j].put;
                g.members[j].put = U128(0);
                g.total = U128(g.total.0 - put.0);
                g.cash = U128(g.cash.0 - out);
                PromiseOrValue::Promise(
                    self.send(account.clone(), U128(out))
                        .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_goal_out(id, account, U128(out), put, false)),
                )
            }
        }
    }

    /// After a refund vote, or 30 days past the date with no release: take your part (your money + its yield).
    pub fn claim_refund(&mut self, id: u64) -> Promise {
        let me = env::predecessor_account_id();
        let now = env::block_timestamp() / SEC;
        let g = self.goals.get_mut(&id).unwrap_or_else(|| env::panic_str("no such goal"));
        if g.expired(now) {
            g.start_refund();
        }
        require!(g.status == Status::Refunding, "refunds are not open");
        let i = g.find(&me).unwrap_or_else(|| env::panic_str("not a member"));
        let put = g.members[i].put;
        require!(put.0 > 0, "nothing to claim");
        let out = g.refund_cash.0 * put.0 / g.refund_base.0;
        g.members[i].put = U128(0);
        g.cash = U128(g.cash.0 - out);
        self.send(me.clone(), U128(out)).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_goal_out(id, me, U128(out), put, true))
    }

    #[private]
    pub fn on_goal_release(&mut self, #[callback_result] r: Result<(), PromiseError>, id: u64, amount: U128) {
        if r.is_ok() {
            return;
        }
        // the transfer failed: the money stays in escrow and the goal opens again
        let g = self.goals.get_mut(&id).expect("goal");
        g.status = Status::Open;
        g.cash = U128(g.cash.0 + amount.0);
    }

    #[private]
    pub fn on_goal_out(&mut self, #[callback_result] r: Result<(), PromiseError>, id: u64, account: AccountId, out: U128, put: U128, refund: bool) {
        if r.is_ok() {
            return;
        }
        let g = self.goals.get_mut(&id).expect("goal");
        let Some(i) = g.find(&account) else { return };
        g.members[i].put = U128(g.members[i].put.0 + put.0);
        g.cash = U128(g.cash.0 + out.0);
        if !refund {
            g.total = U128(g.total.0 + put.0);
        }
    }

    pub fn get_goal(&self, id: u64) -> Option<Goal> {
        self.goals.get(&id).cloned()
    }
}

impl Contract {
    /// Anyone may join by putting money in while the goal is open.
    pub(crate) fn deposit_goal(&mut self, id: u64, sender: AccountId, amount: u128) -> u128 {
        let now = env::block_timestamp() / SEC;
        let Some(g) = self.goals.get_mut(&id) else { return amount };
        if g.status != Status::Open || g.expired(now) {
            return amount;
        }
        let month = (now.saturating_sub(g.created)) / MONTH + 1;
        let i = match g.find(&sender) {
            Some(i) => i,
            None => {
                if g.members.len() >= MAX_MEMBERS {
                    return amount;
                }
                g.members.push(GoalMember { account: sender, put: U128(0), streak: 0, last_month: 0 });
                g.members.len() - 1
            }
        };
        let m = &mut g.members[i];
        if m.last_month + 1 == month {
            m.streak += 1;
        } else if m.last_month != month {
            m.streak = 1;
        }
        m.last_month = month;
        m.put = U128(m.put.0 + amount);
        g.total = U128(g.total.0 + amount);
        g.cash = U128(g.cash.0 + amount);
        0
    }

    pub(crate) fn deposit_goal_yield(&mut self, id: u64, amount: u128) -> u128 {
        let Some(g) = self.goals.get_mut(&id) else { return amount };
        if g.status != Status::Open || g.total.0 == 0 {
            return amount;
        }
        g.cash = U128(g.cash.0 + amount);
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const USD: u128 = 1_000_000;
    const T0: u64 = 1_000;
    const DATE: u64 = T0 + 365 * 86_400;

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
    fn pay(c: &mut Contract, from: &str, amount: u128, msg: String, secs: u64) -> u128 {
        ctx("usdc.near", secs);
        match c.ft_on_transfer(acc(from), U128(amount), msg) {
            PromiseOrValue::Value(v) => v.0,
            _ => panic!("expected a value"),
        }
    }
    /// alice organises; alice 400, bob 300, carol 200, dave 100 = 1,000
    fn setup() -> (Contract, u64) {
        ctx("alice.near", T0);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_goal("Summer trip".into(), U128(1_000 * USD), DATE);
        for (who, usd) in [("alice.near", 400), ("bob.near", 300), ("carol.near", 200), ("dave.near", 100)] {
            assert_eq!(pay(&mut c, who, usd * USD, format!("{{\"goal\":{id}}}"), T0), 0);
        }
        (c, id)
    }
    fn vote(c: &mut Contract, id: u64, who: &str, yes: bool) {
        ctx(who, T0 + 10);
        let _ = c.vote(id, yes);
    }

    #[test]
    fn release_needs_75_percent_of_the_money() {
        let (mut c, id) = setup();
        ctx("alice.near", T0 + 5);
        c.propose(id, Action::Release); // alice 40%
        vote(&mut c, id, "carol.near", true); // 60%
        assert_eq!(c.get_goal(id).unwrap().status, Status::Open);
        vote(&mut c, id, "dave.near", true); // 70%
        assert_eq!(c.get_goal(id).unwrap().status, Status::Open);
        vote(&mut c, id, "bob.near", true); // 100%
        let g = c.get_goal(id).unwrap();
        assert_eq!((g.status, g.cash.0), (Status::Released, 0));
        // failed transfer: money back in escrow
        ctx("social.joulity.near", T0 + 20);
        c.on_goal_release(Err(PromiseError::Failed), id, U128(1_000 * USD));
        let g = c.get_goal(id).unwrap();
        assert_eq!((g.status, g.cash.0), (Status::Open, 1_000 * USD));
    }

    #[test]
    fn refund_by_majority_pays_money_plus_yield() {
        let (mut c, id) = setup();
        assert_eq!(pay(&mut c, "vault.near", 50 * USD, format!("{{\"goal_yield\":{id}}}"), T0), 0);
        ctx("bob.near", T0 + 5);
        c.propose(id, Action::RefundAll); // bob 30%
        vote(&mut c, id, "carol.near", true); // 50%: not more than half
        assert_eq!(c.get_goal(id).unwrap().status, Status::Open);
        vote(&mut c, id, "dave.near", true); // 60%
        assert_eq!(c.get_goal(id).unwrap().status, Status::Refunding);
        ctx("dave.near", T0 + 20);
        let _ = c.claim_refund(id);
        // dave put 10% -> 10% of 1,050
        assert_eq!(c.get_goal(id).unwrap().cash.0, 1_050 * USD - 105 * USD);
        // late deposits are refunded while refunding
        assert_eq!(pay(&mut c, "erin.near", 5 * USD, format!("{{\"goal\":{id}}}"), T0 + 30), 5 * USD);
    }

    #[test]
    fn one_member_leaves_with_majority() {
        let (mut c, id) = setup();
        ctx("dave.near", T0 + 5);
        c.propose(id, Action::Leave { account: acc("dave.near") });
        vote(&mut c, id, "alice.near", true); // 50%
        vote(&mut c, id, "bob.near", true); // 80%
        let g = c.get_goal(id).unwrap();
        assert_eq!((g.total.0, g.cash.0, g.status), (900 * USD, 900 * USD, Status::Open));
    }

    #[test]
    fn no_vote_blocks_release() {
        let (mut c, id) = setup();
        ctx("alice.near", T0 + 5);
        c.propose(id, Action::Release);
        vote(&mut c, id, "bob.near", false); // 30% no -> release can never reach 75%
        ctx("bob.near", T0 + 20);
        c.propose(id, Action::RefundAll); // a blocked vote can be replaced
        assert!(matches!(c.get_goal(id).unwrap().proposal.unwrap().action, Action::RefundAll));
    }

    #[test]
    fn refunds_open_alone_after_the_date() {
        let (mut c, id) = setup();
        ctx("carol.near", DATE + 31 * 86_400);
        let _ = c.claim_refund(id);
        let g = c.get_goal(id).unwrap();
        assert_eq!((g.status, g.cash.0), (Status::Refunding, 800 * USD));
    }

    #[test]
    #[should_panic(expected = "refunds are not open")]
    fn no_refund_alone_before_the_date() {
        let (mut c, id) = setup();
        ctx("carol.near", T0 + 100);
        let _ = c.claim_refund(id);
    }

    #[test]
    fn monthly_streak() {
        let (mut c, id) = setup();
        let msg = format!("{{\"goal\":{id}}}");
        pay(&mut c, "bob.near", USD, msg.clone(), T0 + MONTH + 5); // month 2
        pay(&mut c, "bob.near", USD, msg.clone(), T0 + 2 * MONTH + 5); // month 3
        pay(&mut c, "carol.near", USD, msg, T0 + 2 * MONTH + 5); // skipped month 2
        let g = c.get_goal(id).unwrap();
        assert_eq!(g.members[1].streak, 3);
        assert_eq!(g.members[2].streak, 1);
    }
}
