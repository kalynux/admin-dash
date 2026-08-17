/**
 * `/accounts/:ownerType/:ownerId` — one party's financial account.
 *
 * Sources: `docs/admin/api/accounts.md` and
 * `backend/admin/src/modules/accounts/`.
 *
 * ── Why this is not on the `/vendors` surface ─────────────────────────────────
 * [ADR-008](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md) explicitly excludes
 * billing, earnings and payouts from `/vendors`: assembling them there would let
 * `vendors.read` alone reach what `billing.*` and `money.*` exist to gate. So the
 * vendor screen reads *this* mount instead, behind *its* permissions — which is
 * the same information reached through the right door. A Support administrator
 * holds none of the three and never sees the tab.
 *
 * ── Written per owner kind ────────────────────────────────────────────────────
 * `ownerType` is a pinned enum of `vendor | agency | agent` — `platform` is
 * deliberately excluded, because the marketplace never pays itself out. Every
 * function takes it as a parameter, so the vendor, agency and agent screens share
 * one implementation. `listAccountCashLedger` is the exception and narrows to
 * `CashLedgerOwnerType`: the route itself refuses a vendor.
 *
 * ── Read-only, and no writes exist on this mount ──────────────────────────────
 * There is nothing to POST here. Everything that changes an account changes it
 * somewhere else — a plan through `/billing`, a payout through `/money` — and this
 * is the composed view of the result.
 *
 * ── Authorization is composed, then narrowed ──────────────────────────────────
 * The account view requires the permission owning each block it carries
 * (`money.earnings.read` + `billing.plans.read` + `cod.overview.read`, `all`
 * mode); the four sub-routes each narrow to the single family whose data they
 * carry. **No `accounts` permission family exists and none should be requested** —
 * one would be a side door onto all three.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    AccountActivityItem,
    AccountActivityQuery,
    AccountOwnerType,
    AccountPayoutsQuery,
    CashLedgerEntry,
    CashLedgerOwnerType,
    CashLedgerQuery,
    CreditBalance,
    CreditLedgerEntry,
    CreditLedgerMeta,
    CreditLedgerQuery,
    OwnerAccount,
} from '@/types/accounts.types';
import type { Payout } from '@/types/money.types';

/**
 * `GET /accounts/:ownerType/:ownerId` ·
 * **`money.earnings.read` + `billing.plans.read` + `cod.overview.read`**, `all` mode.
 *
 * The heaviest read on the service — two delegated verdicts and eleven direct
 * reads, fanned out in parallel. It needs three permissions because it is
 * genuinely three domains composed into one answer, which is also why there is no
 * `accounts` permission family and none should be requested.
 *
 * **Query parameters are strict: it takes none.** Sending any is a `400`.
 *
 * Four fields are permanently `null` for a vendor — `balances.codCash`,
 * `codExposure`, `flags.openDiscrepancies`, `flags.overCodThreshold` — because a
 * vendor cannot hold cash. `null` there means *does not apply*, which is a
 * different claim from `0`.
 *
 * `404 ACCOUNT_OWNER_NOT_FOUND` is "no such vendor". **An owner with no balances
 * is not this** — that reports zeroes.
 */
export function getOwnerAccount(
    ownerType: AccountOwnerType,
    ownerId: string,
    options?: RequestOptions,
): Promise<OwnerAccount> {
    return api.get<OwnerAccount>(
        `/accounts/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}`,
        options,
    );
}

/**
 * `GET /accounts/:ownerType/:ownerId/activity` ·
 * **`money.earnings.read` + `billing.plans.read`**, `all` mode — and deliberately
 * *not* `cod.overview.read`, because the COD cash ledger is not in this feed.
 *
 * **The one cursor-paged endpoint on the whole service.** It merges five
 * collections — plan purchases, credit top-ups, credit transactions, the earnings
 * ledger and payout requests — so it cannot be offset-paged honestly: it reports
 * no `total` and no `pages`, offers no sorting, and takes no filter, not even by
 * category.
 *
 * ⚠ **Two behaviours that look like bugs and are not.** `mergeActivity`
 * (`account-activity.read.repository.ts:79-97`) refuses to split a group of rows
 * sharing a timestamp, so:
 *
 * 1. **a page can come back longer than `limit`**, and
 * 2. **the final page can come back empty** with `hasMore: false`.
 *
 * So paging is driven by `meta.hasMore` and `meta.nextCursor` alone. Deriving
 * "there is more" from `data.length === limit` would both stop early and loop.
 *
 * `before` is **strictly older than**, never inclusive — pass `meta.nextCursor`
 * straight back, and omit it for the first page.
 */
export function listOwnerAccountActivity(
    ownerType: AccountOwnerType,
    ownerId: string,
    query: AccountActivityQuery = {},
    options?: RequestOptions,
) {
    return api.cursor<AccountActivityItem>(
        withQuery(
            `/accounts/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}/activity`,
            { ...query },
        ),
        options,
    );
}

/**
 * `GET /accounts/:ownerType/:ownerId/payouts` · **`money.payouts.read` alone**.
 *
 * This owner's payout history — the same rows, repository, projection and
 * masking as `/money/payouts`, scoped to one party, which is why it answers the
 * same `Payout` type rather than a copy of one.
 *
 * **Deliberately not the account view's three-permission composition.** Reading
 * where an owner's money went is a payout question, and requiring the full
 * composition here would mean an administrator who may work the payout queue
 * could not open the account it belongs to.
 *
 * Sort allowlist `createdAt` · `amount` · `resolvedAt`, default `-createdAt` —
 * imported from the money validator server-side, not restated, because a second
 * copy is how one surface ends up able to order by a field the other cannot.
 *
 * `destination.full` is `null` here too; the digits live behind the audited
 * reveal on `/money` alone.
 */
export function listAccountPayouts(
    ownerType: AccountOwnerType,
    ownerId: string,
    query: AccountPayoutsQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Payout>> {
    return api.list<Payout>(
        withQuery(
            `/accounts/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}/payouts`,
            { ...query },
        ),
        options,
    );
}

/**
 * `GET /accounts/:ownerType/:ownerId/credits` · **`billing.plans.read`**.
 *
 * The credit ledger, with the wallet balance in `meta`.
 *
 * **Credits are a billing artefact and are not money** — granted by a plan
 * allowance, bought as a pack, spent on metered actions. Requiring a `money.*`
 * permission would say they were.
 *
 * ── Why `meta.wallet` is narrowed here rather than at the call site ───────────
 * The endpoint answers through `sendSuccess`, not `sendPaginated`, specifically
 * so the wallet stays a **whole balance object** — `unit`, `currency` and
 * `direction` intact — instead of being flattened into `meta`'s scalar index
 * signature. That signature is also why it arrives at this client as `unknown`.
 * Narrowing it once, here, is the same move every other service makes with
 * `toPage`: a cast at each call site is how three screens end up disagreeing
 * about whether the wallet exists.
 *
 * ⚠ **Top-up rows are not in this ledger.** A paid top-up writes to both
 * `credit_topups` and `credit_transactions`, and the repository drops the ledger
 * half so one event is not counted twice. Top-ups appear once, on `/activity`.
 */
export async function listAccountCredits(
    ownerType: AccountOwnerType,
    ownerId: string,
    query: CreditLedgerQuery = {},
    options?: RequestOptions,
): Promise<{ data: CreditLedgerEntry[]; meta: CreditLedgerMeta }> {
    const page = await api.list<CreditLedgerEntry>(
        withQuery(
            `/accounts/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}/credits`,
            { ...query },
        ),
        options,
    );

    return { data: page.data, meta: { ...page.meta, wallet: toWallet(page.meta.wallet) } };
}

/**
 * The wallet, as a balance object whichever way the server phrased it.
 *
 * A missing wallet and an empty one hold the same amount of credit, so the
 * fallback is a real zero balance with `walletExists: false` rather than
 * `null` — which is exactly the distinction the flag exists to carry, and keeps
 * every renderer off a null check that would otherwise read as "no credits".
 */
function toWallet(value: unknown): CreditBalance {
    const record = (typeof value === 'object' && value !== null ? value : {}) as Record<
        string,
        unknown
    >;

    return {
        unit: 'credit',
        currency: null,
        direction: 'spendable_by_owner',
        balance: typeof record.balance === 'number' ? record.balance : 0,
        walletExists: record.walletExists === true,
    };
}

/**
 * `GET /accounts/:ownerType/:ownerId/cash-ledger` · **`cod.overview.read`**.
 *
 * The COD liability's movements — **a different unit of meaning from
 * `/activity`**, which is why it is a different endpoint rather than a filter on
 * that one. COD cash is not owner value; it is money the owner is holding and
 * owes onward. Merging the two would put a liability and an asset in one running
 * order, which is the single most likely way somebody misreads an account.
 *
 * ── `ownerType` is narrowed, and a vendor does not compile ────────────────────
 * The route's own params schema accepts `agent` and `agency` only, so a vendor is
 * a `400` reading *"A cash ledger exists for agent and agency accounts only"* —
 * a route-level refusal, not an empty page. `CashLedgerOwnerType` moves that
 * refusal to build time; narrow with `supportsCashLedger` before calling.
 *
 * `amount` is **signed**: positive raises the liability, negative discharges it.
 */
export function listAccountCashLedger(
    ownerType: CashLedgerOwnerType,
    ownerId: string,
    query: CashLedgerQuery = {},
    options?: RequestOptions,
): Promise<Paginated<CashLedgerEntry>> {
    return api.list<CashLedgerEntry>(
        withQuery(
            `/accounts/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}/cash-ledger`,
            { ...query },
        ),
        options,
    );
}

/**
 * The three permissions `getOwnerAccount` needs, in `all` mode.
 *
 * Named once here so the gate on the tab and the requirement in the docstring
 * cannot drift — the same reason the navigation config derives a parent's
 * requirement rather than letting one be written twice.
 */
export const ACCOUNT_READ_PERMISSIONS = [
    'money.earnings.read',
    'billing.plans.read',
    'cod.overview.read',
] as const;

/**
 * What `/activity` needs, in `all` mode — **and deliberately not
 * `cod.overview.read`**, because the cash ledger is not in that feed.
 */
export const ACCOUNT_ACTIVITY_PERMISSIONS = ['money.earnings.read', 'billing.plans.read'] as const;

/*
 * The three sub-lists each narrow to the single family whose data they carry, so
 * an administrator who may work the payout queue but not see a COD position gets
 * exactly that, on the same account.
 */
export const ACCOUNT_PAYOUTS_PERMISSION = 'money.payouts.read' as const;
export const ACCOUNT_CREDITS_PERMISSION = 'billing.plans.read' as const;
export const ACCOUNT_CASH_LEDGER_PERMISSION = 'cod.overview.read' as const;
