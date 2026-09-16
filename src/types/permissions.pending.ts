/**
 * Permissions the **service grants** and the **catalogue does not yet name**.
 *
 * ── Why this file exists at all ──────────────────────────────────────────────
 * `permissions.types.ts` is a transcription of `api-doc/admin/api/permissions.md`
 * and `permissions.types.test.ts` diffs the two in **both** directions — "declares
 * every documented permission, and no others". That guard is right and must stay
 * that way: a name in `src/` that the contract does not publish is normally a
 * typo, and a typo there is invisible at runtime because a permission that does
 * not exist can never be held.
 *
 * ADR-024 is the case where the guard's normal reading is the wrong one. Both
 * names below are real — they are declared in
 * `backend/admin/src/modules/authorization/domain/permission.catalog.ts`, they
 * guard live routes (`money.routes.ts`, `cod.routes.ts`), and
 * `npm run authz:matrix` prints them — but **`permissions.md` has not been
 * re-derived since**, upstream or mirrored. So the catalogue is behind the
 * service, and putting these two into `PERMISSION_NAMES` would fail the guard for
 * the right reason about the wrong file.
 *
 * ⚠ **A mirror is re-copied or it is wrong; it is never edited to make a test
 * pass.** Adding the rows to `permissions.md` by hand would forge the contract,
 * and weakening the diff would unguard 121 names to admit 2.
 *
 * ── Why this is not a hole in the type system ─────────────────────────────────
 * It uses machinery that already exists and is already documented as the way to
 * ask this question. `HeldPermissions` is `ReadonlySet<string>` and
 * `hasPermission(held, name: string)` takes an open string — deliberately,
 * because (in `permissions-context.ts`) *"`/permissions/me` may name a permission
 * this build has never heard of, and refusing to parse one would break the
 * dashboard on a routine backend deploy"*. That is exactly this situation. The
 * narrowing to `RoutedPermissionName` lives on `useCan()` to stop a **nav item**
 * naming a dead permission; these are not nav items.
 *
 * ⛔ **This is a waiting room, not an extension point.** Adding a third name here
 * because it is easier than filing a BR is the failure mode. `permissions.pending.test.ts`
 * fails the moment `permissions.md` publishes either row — at which point the
 * name moves into `PERMISSION_NAMES`, the call sites move to `can()`, and this
 * file gets smaller. It is designed to be deleted.
 */

/**
 * Endorse a payout request as genuine — ADR-024 D-1, `financial: true`.
 *
 * ⚠ **It also reaches `POST /money/payouts/:id/reject`**, which takes
 * `anyPermission('money.payouts.reject', 'money.payouts.triage')`. That is not a
 * detail: it is the half of triage that actually closes a request, and it is why
 * this permission is flagged `financial` honestly and admitted to tier 3 only by
 * a named exemption (`TIER_3_FINANCIAL_ALLOWLIST`). A reviewer's rejection is
 * final and returns the money to the owner's available balance.
 */
export const PERMISSION_MONEY_PAYOUTS_TRIAGE = 'money.payouts.triage';

/**
 * Endorse a declared COD deposit or remittance — ADR-024 D-5, **not** `financial`.
 *
 * The asymmetry with its payout sibling is real rather than an oversight: a
 * payout request holds the owner's balance from the moment it opens, while a COD
 * deposit or remittance in `declared` holds **nothing** — only a confirmed one
 * moves cash. So endorsing one moves nothing and rejecting one moves nothing
 * either, and it needs no exemption.
 *
 * ⚠ **It does not grant confirming.** `cod.deposits.confirm` and
 * `cod.remittances.confirm` are the writes that assert cash arrived; they stay
 * `financial` and stay out of Support's reach.
 */
export const PERMISSION_COD_TRIAGE = 'cod.triage';

/** The whole waiting room, for the guard that wants it to empty. */
export const PENDING_PERMISSION_NAMES = [
    PERMISSION_MONEY_PAYOUTS_TRIAGE,
    PERMISSION_COD_TRIAGE,
] as const;

export type PendingPermissionName = (typeof PENDING_PERMISSION_NAMES)[number];
