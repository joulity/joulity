//! Reward circle: only the yield rotates, never the money.
//!
//! - Savers put USDC in, once or every month. Their money stays theirs and can be taken back at any time.
//! - Yield (sent in by the vault with msg {"reward_yield": id}) is shared pro rata to the money in the circle.
//! - A booster takes an advance of their own future yield now: at most `max_boost_bps` of their money, one boost
//!   per member, one boost per period for the whole circle, and the creator goes first. The booster then owes the
//!   advance plus `premium_bps`. Their yield repays it; the premium part is shared with everyone as a bonus.
//! - Leaving early: whatever is still owed comes out of the leaver's own money. The cap keeps the debt far below
//!   that money, so the other members can never lose because someone stopped paying or left.

use crate::*;

/// precision of the yield-per-dollar accumulator
const ACC: u128 = 1_000_000_000_000_000_000;
const BPS: u128 = 10_000;
/// a boost can never take more than 30% of the booster's money, whatever the creator sets
const MAX_BOOST_CAP_BPS: u16 = 3_000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Saver {
    pub account: AccountId,
    /// money put in (USDC units)
    pub principal: U128,
    /// advance + premium still owed
    pub debt: U128,
    /// yield credited and not yet claimed
    pub earned: U128,
    /// accumulator value already credited to this saver
    pub acc_seen: U128,
    pub boosted: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct RewardCircle {
    pub name: String,
    pub creator: AccountId,
    /// seconds between two boosts in the circle
    pub period: u64,
    /// advance cap as a share of the booster's money
    pub max_boost_bps: u16,
    /// what a booster pays on top of the advance; it becomes the savers' bonus
    pub premium_bps: u16,
    pub members: Vec<Saver>,
    /// sum of all principal
    pub total: U128,
    /// yield per USDC unit, scaled by ACC
    pub acc: U128,
    /// USDC this circle holds right now
    pub cash: U128,
    /// unix seconds of the last boost; 0 = none yet
    pub last_boost: u64,
    pub boosts: u32,
    /// advances paid out so far, premiums shared so far (for the dashboard)
    pub advanced: U128,
    pub bonus_paid: U128,
}

/// One member as the app shows it, with yield credited up to now.
#[near(serializers = [json])]
pub struct SaverView {
    pub account: AccountId,
    pub principal: U128,
    pub debt: U128,
    pub earned: U128,
    pub boosted: bool,
    /// the advance this member could take now (0 if not allowed)
    pub can_boost: U128,
    /// what leaving now would pay out
    pub exit_value: U128,
}

impl RewardCircle {
    fn find(&self, who: &AccountId) -> Option<usize> {
        self.members.iter().position(|m| &m.account == who)
    }

    /// Credit pending yield to member i; their yield repays their debt first and the premium part is shared.
    fn settle(&mut self, i: usize) {
        let m = &mut self.members[i];
        let mut new = m.principal.0 * (self.acc.0 - m.acc_seen.0) / ACC;
        m.acc_seen = self.acc;
        let mut bonus = 0;
        if m.debt.0 > 0 && new > 0 {
            let repay = new.min(m.debt.0);
            m.debt = U128(m.debt.0 - repay);
            new -= repay;
            bonus = repay * self.premium_bps as u128 / (BPS + self.premium_bps as u128);
        }
        m.earned = U128(m.earned.0 + new);
        self.share(bonus);
    }

    /// Add `amount` of yield (or bonus) for everyone, pro rata to their money.
    fn share(&mut self, amount: u128) {
        if amount == 0 || self.total.0 == 0 {
            return;
        }
        self.acc = U128(self.acc.0 + amount * ACC / self.total.0);
        if amount > 0 {
            self.bonus_paid = U128(self.bonus_paid.0 + amount);
        }
    }

    fn boost_size(&self, i: usize) -> u128 {
        self.members[i].principal.0 * self.max_boost_bps as u128 / BPS
    }

    /// Can member i boost at `now`? The creator may boost at once; everyone else after the creator has,
    /// and never two boosts in the same period.
    fn may_boost(&self, i: usize, now: u64) -> bool {
        let m = &self.members[i];
        if m.boosted || m.principal.0 == 0 {
            return false;
        }
        let creator_done = self.find(&self.creator).map_or(true, |c| self.members[c].boosted);
        if m.account != self.creator && !creator_done {
            return false;
        }
        let size = self.boost_size(i);
        size > 0 && size <= self.cash.0 && (self.last_boost == 0 || now >= self.last_boost + self.period)
    }

    fn view(&self, i: usize, now: u64) -> SaverView {
        let mut c = self.clone();
        c.settle(i);
        let m = &c.members[i];
        SaverView {
            account: m.account.clone(),
            principal: m.principal,
            debt: m.debt,
            earned: m.earned,
            boosted: m.boosted,
            can_boost: U128(if self.may_boost(i, now) { self.boost_size(i) } else { 0 }),
            exit_value: U128(m.principal.0 + m.earned.0 - m.debt.0),
        }
    }
}

#[near]
impl Contract {
    pub fn create_reward_circle(&mut self, name: String, period: u64, max_boost_bps: u16, premium_bps: u16) -> u64 {
        require!(!name.is_empty() && name.len() <= 64, "name: 1-64 characters");
        require!(period >= 60, "period: at least 60 seconds");
        require!(max_boost_bps > 0 && max_boost_bps <= MAX_BOOST_CAP_BPS, "boost: 0.01-30% of the money");
        require!(premium_bps <= 10_000, "premium: 0-100%");
        let id = self.take_id();
        let creator = env::predecessor_account_id();
        self.rewards.insert(
            id,
            RewardCircle {
                name,
                creator,
                period,
                max_boost_bps,
                premium_bps,
                members: vec![],
                total: U128(0),
                acc: U128(0),
                cash: U128(0),
                last_boost: 0,
                boosts: 0,
                advanced: U128(0),
                bonus_paid: U128(0),
            },
        );
        id
    }

    /// Take your future yield now. You then owe it plus the premium; your own yield pays it back.
    pub fn boost(&mut self, id: u64) -> Promise {
        let now = env::block_timestamp() / SEC;
        let me = env::predecessor_account_id();
        let r = self.rewards.get_mut(&id).unwrap_or_else(|| env::panic_str("no such reward circle"));
        let i = r.find(&me).unwrap_or_else(|| env::panic_str("not a member"));
        r.settle(i);
        require!(r.may_boost(i, now), "no boost for you now");
        let size = r.boost_size(i);
        let premium = r.premium_bps as u128;
        let m = &mut r.members[i];
        m.boosted = true;
        m.debt = U128(m.debt.0 + size + size * premium / BPS);
        r.cash = U128(r.cash.0 - size);
        r.advanced = U128(r.advanced.0 + size);
        r.last_boost = now;
        r.boosts += 1;
        self.send(me.clone(), U128(size)).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_boost(id, me, U128(size)))
    }

    /// A failed advance is undone completely; the member can boost again.
    #[private]
    pub fn on_boost(&mut self, #[callback_result] res: Result<(), PromiseError>, id: u64, account: AccountId, size: U128) {
        if res.is_ok() {
            return;
        }
        let r = self.rewards.get_mut(&id).expect("reward circle");
        if let Some(i) = r.find(&account) {
            let owed = size.0 + size.0 * r.premium_bps as u128 / BPS;
            let m = &mut r.members[i];
            m.boosted = false;
            m.debt = U128(m.debt.0.saturating_sub(owed));
        }
        r.cash = U128(r.cash.0 + size.0);
        r.advanced = U128(r.advanced.0 - size.0);
        r.boosts -= 1;
        r.last_boost = 0;
    }

    /// Take the yield you have earned.
    pub fn claim_reward(&mut self, id: u64) -> Promise {
        let me = env::predecessor_account_id();
        let r = self.rewards.get_mut(&id).unwrap_or_else(|| env::panic_str("no such reward circle"));
        let i = r.find(&me).unwrap_or_else(|| env::panic_str("not a member"));
        r.settle(i);
        let amount = r.members[i].earned.0;
        require!(amount > 0, "nothing to claim");
        r.members[i].earned = U128(0);
        r.cash = U128(r.cash.0 - amount);
        self.send(me.clone(), U128(amount)).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_reward_out(id, me, U128(amount), U128(0)))
    }

    /// Leave with your money and yield, minus what you still owe. What you owed is shared with the others.
    pub fn leave_reward_circle(&mut self, id: u64) -> Promise {
        let me = env::predecessor_account_id();
        let r = self.rewards.get_mut(&id).unwrap_or_else(|| env::panic_str("no such reward circle"));
        let i = r.find(&me).unwrap_or_else(|| env::panic_str("not a member"));
        r.settle(i);
        let m = r.members[i].clone();
        let out = m.principal.0 + m.earned.0 - m.debt.0;
        // the advance part of the debt was already paid out; the premium part is new money for the others
        let premium = m.debt.0 * r.premium_bps as u128 / (BPS + r.premium_bps as u128);
        r.total = U128(r.total.0 - m.principal.0);
        r.members[i] = Saver { account: me.clone(), principal: U128(0), debt: U128(0), earned: U128(0), acc_seen: r.acc, boosted: m.boosted };
        r.cash = U128(r.cash.0 - out);
        r.share(premium);
        require!(out > 0, "nothing to take out");
        self.send(me.clone(), U128(out)).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_reward_out(id, me, U128(m.earned.0), U128(out - m.earned.0)))
    }

    /// A failed transfer puts the yield and money back on the member's line.
    #[private]
    pub fn on_reward_out(&mut self, #[callback_result] res: Result<(), PromiseError>, id: u64, account: AccountId, earned: U128, principal: U128) {
        if res.is_ok() {
            return;
        }
        let r = self.rewards.get_mut(&id).expect("reward circle");
        if let Some(i) = r.find(&account) {
            r.settle(i);
            let m = &mut r.members[i];
            m.earned = U128(m.earned.0 + earned.0);
            m.principal = U128(m.principal.0 + principal.0);
            r.total = U128(r.total.0 + principal.0);
            r.cash = U128(r.cash.0 + earned.0 + principal.0);
        }
    }

    pub fn get_reward_circle(&self, id: u64) -> Option<RewardCircle> {
        self.rewards.get(&id).cloned()
    }

    pub fn get_saver(&self, id: u64, account: AccountId) -> Option<SaverView> {
        let r = self.rewards.get(&id)?;
        let i = r.find(&account)?;
        Some(r.view(i, env::block_timestamp() / SEC))
    }
}

impl Contract {
    /// Money in: the first deposit makes you a member. Lump sum or monthly, any amount.
    pub(crate) fn deposit_reward(&mut self, id: u64, sender: AccountId, amount: u128) -> u128 {
        let Some(r) = self.rewards.get_mut(&id) else { return amount };
        let i = match r.find(&sender) {
            Some(i) => i,
            None => {
                if r.members.len() >= MAX_MEMBERS {
                    return amount;
                }
                r.members.push(Saver { account: sender, principal: U128(0), debt: U128(0), earned: U128(0), acc_seen: r.acc, boosted: false });
                r.members.len() - 1
            }
        };
        r.settle(i);
        r.members[i].principal = U128(r.members[i].principal.0 + amount);
        r.total = U128(r.total.0 + amount);
        r.cash = U128(r.cash.0 + amount);
        0
    }

    /// Yield from the vault, shared pro rata. Refunded if the circle is empty.
    pub(crate) fn deposit_reward_yield(&mut self, id: u64, amount: u128) -> u128 {
        let Some(r) = self.rewards.get_mut(&id) else { return amount };
        if r.total.0 == 0 {
            return amount;
        }
        r.acc = U128(r.acc.0 + amount * ACC / r.total.0);
        r.cash = U128(r.cash.0 + amount);
        // boosters repay at once, so the savers see their bonus now (at most 50 members)
        for i in 0..r.members.len() {
            if r.members[i].debt.0 > 0 {
                r.settle(i);
            }
        }
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const USD: u128 = 1_000_000; // USDC has 6 decimals
    const MONTH: u64 = 30 * 86_400;

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
    fn saver(c: &Contract, id: u64, who: &str) -> SaverView {
        c.get_saver(id, acc(who)).unwrap()
    }
    /// alice (creator), bob and carol each put $1,000; boost 10% of your money, premium 25%
    fn setup() -> (Contract, u64) {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        let id = c.create_reward_circle("Friends".into(), MONTH, 1_000, 2_500);
        for who in ["alice.near", "bob.near", "carol.near"] {
            assert_eq!(pay(&mut c, who, 1_000 * USD, format!("{{\"reward\":{id}}}"), 1_000), 0);
        }
        (c, id)
    }
    /// what the circle holds always covers what every member could take out
    fn solvent(c: &Contract, id: u64) {
        let r = c.get_reward_circle(id).unwrap();
        let owed: u128 = r.members.iter().map(|m| saver(c, id, m.account.as_str()).exit_value.0).sum();
        assert!(r.cash.0 + 3 >= owed, "cash {} < owed {}", r.cash.0, owed);
    }

    #[test]
    fn creator_boosts_first_and_savers_get_the_premium() {
        let (mut c, id) = setup();
        // bob cannot go before the creator
        assert_eq!(saver(&c, id, "bob.near").can_boost.0, 0);
        assert_eq!(saver(&c, id, "alice.near").can_boost.0, 100 * USD);

        ctx("alice.near", 1_000);
        let _ = c.boost(id); // alice gets $100 now and owes $125
        let a = saver(&c, id, "alice.near");
        assert_eq!(a.debt.0, 125 * USD);
        assert_eq!(c.get_reward_circle(id).unwrap().cash.0, 2_900 * USD);
        // one boost per month for the circle
        assert_eq!(saver(&c, id, "bob.near").can_boost.0, 0);
        solvent(&c, id);

        // a year of yield: 10% on $3,000 = $300, $100 each
        assert_eq!(pay(&mut c, "vault.near", 300 * USD, format!("{{\"reward_yield\":{id}}}"), 2_000), 0);
        ctx("anyone.near", 2_000);
        let (a, b) = (saver(&c, id, "alice.near"), saver(&c, id, "bob.near"));
        // alice's $100 repaid most of her debt; $20 of it was premium, shared with all three
        // $100 of her yield repaid $100 of the $125, plus her own share of the bonus
        assert!(a.debt.0 < 25 * USD && a.debt.0 > 15 * USD);
        assert_eq!(a.earned.0, 0);
        assert!(b.earned.0 > 106 * USD, "bob earned {}", b.earned.0); // $100 yield + about $6.67 bonus
        solvent(&c, id);

        // next month bob may boost
        assert_eq!(saver(&c, id, "bob.near").can_boost.0, 0);
        ctx("bob.near", 1_000 + MONTH);
        assert_eq!(saver(&c, id, "bob.near").can_boost.0, 100 * USD);
    }

    #[test]
    fn booster_who_leaves_pays_what_he_owes_and_others_lose_nothing() {
        let (mut c, id) = setup();
        ctx("alice.near", 1_000);
        let _ = c.boost(id); // took $100, owes $125
        // no yield yet; alice walks away: $1,000 - $125 = $875 back
        assert_eq!(saver(&c, id, "alice.near").exit_value.0, 875 * USD);
        ctx("alice.near", 1_500);
        let _ = c.leave_reward_circle(id);
        // the $25 premium is shared by bob and carol
        let (b, k) = (saver(&c, id, "bob.near"), saver(&c, id, "carol.near"));
        assert_eq!(b.exit_value.0, 1_012_500_000);
        assert_eq!(k.exit_value.0, 1_012_500_000);
        assert_eq!(c.get_reward_circle(id).unwrap().cash.0, 2_025 * USD);
        solvent(&c, id);
    }

    #[test]
    fn monthly_deposits_count_from_when_they_arrive() {
        let (mut c, id) = setup();
        pay(&mut c, "vault.near", 30 * USD, format!("{{\"reward_yield\":{id}}}"), 2_000); // $10 each
        pay(&mut c, "bob.near", 1_000 * USD, format!("{{\"reward\":{id}}}"), 3_000); // bob doubles up
        pay(&mut c, "vault.near", 40 * USD, format!("{{\"reward_yield\":{id}}}"), 4_000); // $10 per $1,000
        ctx("anyone.near", 4_000);
        assert_eq!(saver(&c, id, "alice.near").earned.0, 20 * USD);
        assert_eq!(saver(&c, id, "bob.near").earned.0, 30 * USD);
        solvent(&c, id);
    }

    #[test]
    fn failed_boost_is_undone() {
        let (mut c, id) = setup();
        ctx("alice.near", 1_000);
        let _ = c.boost(id);
        ctx("social.joulity.near", 1_000);
        c.on_boost(Err(PromiseError::Failed), id, acc("alice.near"), U128(100 * USD));
        let a = saver(&c, id, "alice.near");
        assert_eq!((a.debt.0, a.boosted), (0, false));
        assert_eq!(c.get_reward_circle(id).unwrap().cash.0, 3_000 * USD);
        assert_eq!(a.can_boost.0, 100 * USD);
    }

    #[test]
    #[should_panic(expected = "boost: 0.01-30% of the money")]
    fn boost_cap_is_limited() {
        ctx("alice.near", 1_000);
        let mut c = Contract::new(acc("usdc.near"));
        c.create_reward_circle("Greedy".into(), MONTH, 5_000, 0);
    }

    #[test]
    #[should_panic(expected = "no boost for you now")]
    fn no_second_boost() {
        let (mut c, id) = setup();
        ctx("alice.near", 1_000);
        let _ = c.boost(id);
        ctx("alice.near", 1_000 + 3 * MONTH);
        let _ = c.boost(id);
    }
}
