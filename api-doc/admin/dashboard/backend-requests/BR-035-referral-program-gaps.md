# BR-035: the referral program's gaps, found while building its screens

**From:** admin-dash · **Filed:** 2026-11-03 · **About:** `FRONTEND-CHANGELOG-referrals.md`, `api/referrals.md`
**State of the backend when this was read:** wi-admin's working tree, uncommitted, not deployed.

The screens are built and none of this blocks them. Each item says what admin-dash does today, so an answer
can change it. Items 1 and 2 are real gaps, and 3 to 6 are mostly documentation.

## 1. A rejected person can hold money nobody can release

**What happens.** A terminated partner with a balance is allowed a new application, reapplies, and is rejected
again. The status is now `rejected`.

- `isBalanceFrozen` is `status !== 'active' && !balance_released`, so the money stays frozen.
- `releaseBalance` accepts only `suspended` and `terminated`, so it answers `409 REFERRAL_BALANCE_NOT_FROZEN`,
  whose copy says there is nothing frozen.
- The same goes for `pending`, though approving ends that one.

The only exit is another reapplication and an approval, which an administrator may not want to give.

**What admin-dash does.** It shows the balance as frozen, offers no release (the changelog's table gives none for
`rejected`) and says the balance stays frozen while they have no active partnership.

**Ask.** Decide whether `release-balance` should also accept `rejected`, or whether a reapplication should be
refused while a frozen balance exists. Either is fine, and we will follow.

## 2. `?role=referral_partner` on `/money/transactions` is a `400`

The changelog says partners' rows carry the party role `referral_partner`, but `TRANSACTION_ROLES` in
`transaction.dto.ts` is still `customer · vendor · agency · agent · platform`, and the query schema is a strict
`z.enum` over it. So the rows appear and nothing can filter to them by role.

**What admin-dash does.** It links the row's party to the partner page and offers the three reasons as
`reasonCode` suggestions, which do work. It does not offer the role.

**Ask.** Add `referral_partner` to `TRANSACTION_ROLES`, then re-take `transaction-dto.ts` here. Our mirror test
will show the new value.

## 3. `balanceFrozen` is `true` on a brand-new applicant

`toPartnerDetailDto` reports `status !== 'active' && !balance_released`, so a `pending` or `rejected` partner
reads `true` with an empty wallet. The changelog says to show a frozen balance as frozen using this field.

**What admin-dash does.** `isReferralBalanceFrozen()` trusts it on `suspended` and `terminated`, and on the other
two only while money is really there.

**Ask.** Nothing is needed if this is intended. If not, narrow the field, or state the rule in `referrals.md`.

## 4. `GET /accounts/referral_partner/:id` is a `400`

The changelog says Accounts "can list" `referral_partner`, and it can. But `ACCOUNT_OWNER_TYPES` in
`account.validator.ts` is still the three roles, so the row's natural link, the account page, is refused.

**What admin-dash does.** `moneyOwnerPath()` sends a partner's row, on Accounts, Refund debt and the payout
detail, to the partner page. That page has the balances. It has no ledger view and no statement, and we are not
asking for them.

**Ask.** Say so in `referrals.md` § Money screens, so nobody builds the link from the page.

## 5. A partner's payout reads "unverified"

`hydrateOwnerNames` resolves the partner's code, but the verification lookup covers three roles, so a partner's
payout answers `{ verified: false, verdict: 'unverified' }`. jovi-mall's ticket note says a partner has no KYC of
their own and the note replaces that line. On a payout row, "unverified" reads as a check somebody skipped.

**What admin-dash does.** It shows *No verification* instead of the badge on `referral_partner` rows, and leaves
them out of the queue's "not vetted" filter.

**Ask.** Nothing needed. A `verdict: 'not_applicable'` would let us delete the special case, if you want one.

## 6. Pages behind their own round

| Page | What is missing |
|---|---|
| `api/README.md` | Does not link `referrals.md`, and still says "All 142 permissions" |
| `audit.md` | No `referral_partner` / `referral_settings` targets, no `referrals.*` actions, no `…write_off_referral_partner` |
| `money.md` | No `referral_partner` on payouts, accounts or clawbacks; the write-off's `:ownerType` |
| `transactions.md` | No `referral_reward*` reasons, no `referral_partner` party role |
| `users.md` | No `referral_balance` blocker, or that it applies only to the account's last open role |
| `errors.md` | No `REFERRAL_*` codes; three reach this dashboard as `details.platformCode` |
| `referrals.md` | `reward` on the detail can be `null` (`findForCommission` reads at most 50 and the DTO falls back to `null`); `search` on a phone starts at the country code; `referred` rows can be category `agent`, which never earns |

Everything in this table was taken from source, so nothing here is waiting on it.
