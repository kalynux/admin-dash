/**
 * `/accounts/:ownerType/:ownerId` — one party's financial account, composed.
 *
 * Sources: `api-doc/admin/api/accounts.md` and, for the field-by-field shape,
 * `backend/admin/src/modules/accounts/read-models/account.dto.ts` — which is the
 * authority here because the mount is a composition of two delegated verdicts and
 * eleven direct reads, and the docs describe some of it in prose.
 *
 * ── Why the shape is this awkward, and must stay that way ─────────────────────
 * An owner has **three unrelated balance models** — a credit wallet, an earnings
 * account and a COD cash account. They are denominated differently, they point in
 * opposite directions, and two of them are not money. Adding any two produces a
 * number that means nothing, and the failure is silent: it renders. The DTO
 * defends against that with five mechanisms this client must not undo:
 *
 * 1. **No top-level `balance`, `total` or `amount`** — every number lives inside a
 *    named object, so nothing can be summed without first naming what it is.
 * 2. **Every balance carries `unit`** — `'money'` or `'credit'`. A credit's
 *    `currency` is `null`, not `'XAF'`.
 * 3. **Every balance carries `direction`** — the field that actually stops the
 *    arithmetic.
 * 4. **`null` means "does not apply to this owner kind"; `0` means "applies,
 *    currently empty".** A vendor gets `codCash: null` — a vendor never collects
 *    cash and *cannot* owe it. Rendering that as `0` would say *owes nothing*,
 *    which is a different claim.
 * 5. **There is no grand total at any level, deliberately.** Even
 *    `pending + available + reserve + requested` is omitted, because that
 *    arithmetic belongs to jovi-mall. **This client must not compute one either.**
 *
 * ── What a vendor's account looks like ────────────────────────────────────────
 * Four fields are permanently `null` for a vendor, by construction rather than by
 * chance: `balances.codCash`, `codExposure`, `flags.openDiscrepancies` and
 * `flags.overCodThreshold`. The UI says "does not apply to a vendor" for each.
 *
 * ⚠ **That does not run backwards.** `null` on one of these does *not* identify a
 * vendor, and `overCodThreshold` is the field where the difference bites: it is
 * also `null` for an **agency** (no single ceiling — read `codExposure`) and for
 * **an agent who has no ceiling set at all** (`accounts.md:257`). Copy that reads
 * a `null` as "does not apply to a vendor" is wrong on two owner kinds out of
 * three, so the reason must be chosen from `owner.type`, never from the `null`.
 *
 * ── The one place a vendor's commission is readable ───────────────────────────
 * `subscription.entitlements.commissionPercent`. It is **not** on the `/vendors`
 * surface at all: it lives on the billing `PricingPlan` and moves only by
 * assigning a plan ([ADR-008 D-8](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)).
 */

import type { ActorStamp } from '@/types/actor.types';
import type { ListMeta } from '@/types/api.types';
import type { PayoutDestination } from '@/types/money.types';

/**
 * The three owner kinds this mount accepts. `platform` is deliberately excluded.
 *
 * A **pinned enum** on the wire, so a bad value is a `400` rather than an empty
 * account: every collection here is keyed `(ownerType, ownerId)`, and an
 * unrecognised type would match nothing in five places and render as an account
 * whose every block is empty.
 *
 * The marketplace's own commission account is not one of these — it is a
 * singleton with no directory row, no plan, no credit wallet and no COD
 * liability, and it lives at `GET /money/earnings/platform`.
 */
export const ACCOUNT_OWNER_TYPES = ['vendor', 'agency', 'agent'] as const;
export type AccountOwnerType = (typeof ACCOUNT_OWNER_TYPES)[number];

// ─── Balances ─────────────────────────────────────────────────────────────────

/** What a balance is denominated in. `'credit'` is not money and never converts to it. */
export type BalanceUnit = 'money' | 'credit' | (string & {});

/**
 * Who owes whom — the field that stops two balances being added.
 *
 * `owed_to_agency` exists because an **agent's** COD cash is owed to their agency
 * while an **agency's** is owed to the platform, which is exactly why a deposit
 * and a remittance are different verbs. Neither applies to a vendor.
 */
export type BalanceDirection =
    | 'owed_to_owner'
    | 'spendable_by_owner'
    | 'owed_to_platform'
    | 'owed_to_agency'
    | (string & {});

/**
 * What the platform owes this owner, as jovi-mall reconciles it.
 *
 * A **delegated verdict**, not a read of a table — the four sub-balances only move
 * inside jovi-mall's transactions. They are not summed on the wire and must not be
 * summed here.
 */
export interface EarningsBalance {
    unit: 'money';
    currency: string | null;
    direction: 'owed_to_owner';
    /** In escrow — allocated and not yet releasable. */
    pending: number;
    /** Withdrawable now. */
    available: number;
    /** An agency's COD rolling reserve. `0` for a vendor. */
    reserve: number;
    /** Already asked for through a payout request and not yet paid. */
    requested: number;
}

/** Metered-action units. No currency, no expiry, and they can never be paid out. */
export interface CreditBalance {
    unit: 'credit';
    /** Always `null` — a credit is not denominated in anything. */
    currency: null;
    direction: 'spendable_by_owner';
    balance: number;
    /**
     * `false` when the owner has no wallet row yet — it is created lazily. The
     * balance still reads `0`, because a missing wallet and an empty one hold the
     * same amount of credit; this flag is what tells them apart for anybody
     * debugging why a grant did not land.
     */
    walletExists: boolean;
}

/** Cash the owner is holding and owes onward. **Always `null` for a vendor.** */
export interface CodCashBalance {
    unit: 'money';
    currency: string | null;
    direction: 'owed_to_platform' | 'owed_to_agency';
    held: number;
    lastMovementAt: string | null;
}

export interface AccountBalances {
    earnings: EarningsBalance;
    credits: CreditBalance;
    /** `null` for a vendor — a vendor never collects cash and cannot owe it. */
    codCash: CodCashBalance | null;
}

// ─── The rest of the account ──────────────────────────────────────────────────

export interface AccountOwner {
    type: AccountOwnerType;
    id: string;
    /** The **business** name where there is one — a vendor's Store, an agency's Magazin. */
    name: string | null;
    /** The platform user behind the party. The join key for `/dashboard/users/:id`. */
    userId: string | null;
    /** Falls back to the literal `'unknown'` rather than being omitted. */
    status: string;
    /** For a vendor this reads `suspended_at`; an agent's reads a platform ban. */
    suspended: boolean;
    suspendedReason: string | null;
    createdAt: string | null;
}

/**
 * Contact and verification, named per owner kind.
 *
 * **The two KYC fields are not interchangeable.** A vendor and an agent carry a
 * KYC *status* string; an agency carries a verification *boolean* and no status
 * enum at all. **For a vendor both are populated** — which is why neither may be
 * rendered as the presence of the other.
 */
export interface AccountProfile {
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    phoneVerified: boolean;
    country: string | null;
    timezone: string | null;
    preferredLanguage: string | null;
    /** Vendor and agent only. `null` for an agency. */
    kycStatus: string | null;
    /** Agency and vendor only. `null` for an agent. */
    kycVerified: boolean | null;
    kycVerifiedAt: string | null;
    kycRejectionReason: string | null;
    onboardingStep: number | null;
}

/**
 * What the plan allows — **a delegated verdict**, computed by the platform.
 *
 * A plan's `role` decides which limit fields it carries, so a vendor plan leaves
 * `maxUnterminatedShipments` and `liveTrackingEnabled` null: those are delivery
 * limits. `null` here is "not part of this plan", never "unlimited".
 */
export interface PlanEntitlements {
    planCode: string | null;
    /** **The only place a vendor's commission is readable on this service.** */
    commissionPercent: number | null;
    maxActiveProducts: number | null;
    maxStorageBytes: number | null;
    maxUnterminatedShipments: number | null;
    /**
     * Agent plans only (2026-09-21): the COD pool **the plan** grants a
     * KYC-verified agent. `null` for vendors and agencies, and for "no active
     * plan".
     *
     * ⚠ **The plan's number, not the agent's pool.** The pool an agent can
     * actually carry — after identity verification, an administrator's pin, or
     * their own lower choice — is `cod.maxThreshold` on `GET /agents/:agentId`.
     * Never present the two as the same figure.
     */
    maxCodPool: number | null;
    liveTrackingEnabled: boolean | null;
}

/**
 * The billing plan. **Always an object**, even with no plan — its *fields* go null
 * together, because `entitlements` lives inside it and a null subscription would
 * make "no plan" and "we could not determine the plan" the same shape.
 */
export interface AccountSubscription {
    subscriberPlanId: string | null;
    planId: string | null;
    planCode: string | null;
    planName: string | null;
    /** `null` means **no active plan** — the whole block's fields go null with it. */
    status: string | null;
    startedAt: string | null;
    expiresAt: string | null;
    /** From the platform's own notice period, not a number this client picked. */
    notifyDaysBeforeExpiry: number | null;
    /** `null` when nobody assigned it — a self-service purchase, or a free default. */
    assignedBy: ActorStamp | null;
    paymentReference: string | null;
    allowanceGranted: boolean | null;
    entitlements: PlanEntitlements;
}

export interface CodContractExposure {
    contractId: string;
    agencyId: string;
    agentId: string;
    status: string;
    outstandingBalance: number | null;
    outstandingToAgent: number | null;
    /** `0` **blocks all COD** rather than meaning no limit. */
    maxThreshold: number | null;
    lastSettledAt: string | null;
}

export interface ReserveHold {
    id: string;
    amount: number;
    currency: string | null;
    heldAt: string | null;
    releaseAt: string | null;
    released: boolean;
}

/** Agent and agency only. **`null` for a vendor**, who has no COD exposure of any kind. */
export interface CodExposure {
    contracts: CodContractExposure[];
    /** Agency only. `null` for an agent, who has no rolling reserve. */
    reserveHolds: ReserveHold[] | null;
}

/**
 * The destination types live in `money.types.ts` — they are money's, and the
 * audited disclosure that populates `full` is on `/money`.
 *
 * ⚠ On **this** mount `full` is always `null` and `revealed` always `false`: the
 * projection behind the account view never reads the number columns, so an
 * operator recognises a destination here by its **provider and account name**
 * ("MTN · Jean Dupont"), never by its last four. The digits are reachable only
 * through `GET /money/payouts/:payoutId/destination`.
 */
export type {
    PayoutDestination,
    PayoutDestinationBank,
    PayoutDestinationCard,
    PayoutDestinationMobileMoney,
} from '@/types/money.types';

/**
 * `GET /accounts/:ownerType/:ownerId/payouts` returns **the same rows as
 * `/money/payouts`**, through the same repository and the same masked
 * projection — so it is the same type, not a copy of one.
 */
export type { Payout } from '@/types/money.types';

export interface AccountPayoutsSummary {
    /** **0 or 1, never a count worth aggregating** — one pending request per owner. */
    pendingCount: number;
    pendingAmount: number | null;
    currency: string | null;
    lastPaidAt: string | null;
    lastPaidAmount: number | null;
    /** `null` on a payout predating the snapshot — no destination on file at all. */
    destination: PayoutDestination | null;
}

/**
 * The four things that make an account worth looking at.
 *
 * `null` carries mechanism 4's meaning: the question does not apply to this owner
 * kind, which is different from "no, none".
 */
export interface AccountFlags {
    /** **`null` for a vendor**, who has no cash discrepancies by construction. */
    openDiscrepancies: number | null;
    /** Allocations whose COD cash the platform has not physically received. */
    unsettledCollections: number;
    shipmentCapAlertedAt: string | null;
    /**
     * Their held cash has reached the ceiling that stops further dispatch,
     * compared with `>=` — so a `0` ceiling always reads "over".
     *
     * ⚠ **`null` has three causes, not one**: a **vendor** (no cash), an
     * **agency** (no single ceiling — see `codExposure`), and **an agent with no
     * ceiling set at all**. The third is the one that surprises: it is a live
     * agent about whom the question has no answer yet, not an owner kind the
     * question misses. `accounts.md:257` names all three.
     */
    overCodThreshold: boolean | null;
}

/** `GET /accounts/:ownerType/:ownerId` — the heaviest read on the service. */
export interface OwnerAccount {
    owner: AccountOwner;
    profile: AccountProfile;
    subscription: AccountSubscription;
    balances: AccountBalances;
    /** Agent and agency only — **`null` for a vendor**. */
    codExposure: CodExposure | null;
    payouts: AccountPayoutsSummary;
    flags: AccountFlags;
}

// ─── The activity feed ────────────────────────────────────────────────────────

export type AccountActivityCategory = 'plan' | 'credit' | 'earning' | 'payout' | (string & {});

/**
 * One normalised movement, merged from **five collections** — plan purchases,
 * credit top-ups, credit transactions, the earnings ledger and payout requests.
 *
 * The COD cash ledger is deliberately **not** in this feed; for a vendor there
 * would be nothing in it anyway.
 *
 * `type`, `status` and `gateway` are **unenumerated in both services**. Render
 * them raw; nothing may switch on them.
 */
export interface AccountActivityItem {
    /** The **source document's** id — not synthetic, so a row can be looked up. */
    id: string;
    category: AccountActivityCategory;
    /** `plan_purchase` · `credit_topup` · `credit_allowance` · `earning_hold` … */
    type: string;
    status: string;
    unit: BalanceUnit;
    /** From the **owner's** perspective: value arriving vs leaving. */
    direction: 'in' | 'out' | (string & {});
    /** Magnitude in `unit`, **always positive**. The sign lives in `direction`. */
    amount: number;
    currency: string | null;
    /** `null` on a row that moves no credit. */
    credits: number | null;
    description: string;
    gateway: string | null;
    source: { type: string; id: string } | null;
    createdAt: string;
}

/**
 * `GET /accounts/:ownerType/:ownerId/activity` query parameters.
 *
 * **Strict, and there is nothing else to send** — no sort, no category filter, not
 * even a date range. The feed merges five collections and cannot be offset-paged
 * or ordered honestly, so it offers neither.
 */
export interface AccountActivityQuery {
    /** ISO-8601 instant. **Strictly older than**, never inclusive. Omit for page one. */
    before?: string;
    /** Default 20, max 100. See the warning on `AccountActivityPage`. */
    limit?: number;
}

/** The vocabulary the activity feed's categories are drawn from, for labelling only. */
export const ACCOUNT_ACTIVITY_CATEGORIES = ['plan', 'credit', 'earning', 'payout'] as const;

export const ACCOUNT_ACTIVITY_CATEGORY_LABELS: Record<string, string> = {
    plan: 'Plan',
    credit: 'Credits',
    earning: 'Earnings',
    payout: 'Payout',
};

// ─── The two sub-ledgers ──────────────────────────────────────────────────────

/*
 * ⚠ `CreditLedgerEntry.ref` is a bare STRING; `CashLedgerEntry.ref` is an OBJECT
 * `{ type, id }`. **Do not unify these behind one `LedgerEntry`.**
 *
 * A shared type would have to be `string | { type, id } | null`, and every
 * renderer would then branch on the *shape of a value* instead of on *which
 * ledger it came from*. The two provenance models are genuinely different:
 * jovi-mall's credit `ref` is free-form — a product id, a message id, a plan id,
 * with nothing saying which — while a cash entry names the collection it points
 * into.
 *
 * They also share a trap: **`amount` is SIGNED on both**, unlike
 * `AccountActivityItem.amount`, which is a positive magnitude whose sign lives in
 * `direction`. A component reused across the three would render one of them
 * backwards.
 */

/**
 * One row of `GET /accounts/:ownerType/:ownerId/credits`.
 *
 * ⚠ **Top-up rows are excluded from this ledger.** A paid top-up writes both a
 * `credit_topups` row and a `credit_transactions` one, and the repository drops
 * the ledger half so a single event is not counted twice
 * (`account.controller.ts:286-288`). Top-ups appear, once, on `/activity`. Say so
 * on screen — otherwise "my top-up is missing" reads as a bug.
 *
 * ⚠ `ref` and `createdAt` are **nullable** (`account.dto.ts:343-354`); the doc's
 * example shows both always present.
 */
export interface CreditLedgerEntry {
    id: string;
    /** `allowance` · `topup` · `debit` · `adjustment` · `refund`. Bounded, render raw. */
    type: string;
    reasonCode: string;
    /** **Signed** — this is the ledger, and it reads as one. */
    amount: number;
    balanceAfter: number;
    /** Free-form in jovi-mall: a product id, a message id, a plan id. */
    ref: string | null;
    createdAt: string | null;
}

/**
 * `meta` on the credit ledger.
 *
 * The wallet is a **whole balance object**, kept whole deliberately: the endpoint
 * answers through `sendSuccess` rather than `sendPaginated` precisely so `unit`,
 * `currency` and `direction` survive instead of being flattened into `meta`
 * (`account.controller.ts:307-319`). Stripping those three is exactly what makes
 * somebody add a credit balance to a money balance.
 */
export type CreditLedgerMeta = ListMeta & { wallet: CreditBalance };

/**
 * One row of `GET /accounts/:ownerType/:ownerId/cash-ledger`.
 *
 * ⚠ `ref` and `createdAt` are **nullable** (`account.dto.ts:356-363`); the doc's
 * example shows `ref` as an always-present object.
 */
export interface CashLedgerEntry {
    id: string;
    entryType: string;
    /** **Signed** — positive **raises** the liability, negative discharges it. */
    amount: number;
    /** What the liability became. */
    balanceAfter: number;
    ref: { type: string; id: string } | null;
    createdAt: string | null;
}

/**
 * The owner kinds that have a cash ledger at all.
 *
 * ── Why this is a route fact, not a data fact ─────────────────────────────────
 * `AccountPanel` renders `null`s by branching on **the value, never on
 * `ownerType`** — an agency that legitimately holds no cash today must still show
 * its zero, and must render a figure tomorrow without an edit.
 *
 * This is the other kind of fact. `CashLedgerOwnerParamsSchema` is
 * `z.enum(['agent', 'agency'])` (`account.validator.ts:49-56`) — **the route
 * refuses the parameter**, and a vendor request is a `400` reading *"A cash
 * ledger exists for agent and agency accounts only"*. No value the server could
 * send would make a vendor cash ledger appear, so there is nothing to branch on
 * the value of.
 *
 * The rule, stated once: **a tab's *existence* is a route fact; a tab's
 * *content* is a data fact.**
 */
export const CASH_LEDGER_OWNER_TYPES = ['agency', 'agent'] as const;
export type CashLedgerOwnerType = (typeof CASH_LEDGER_OWNER_TYPES)[number];

/**
 * Narrows an owner kind to one that has a cash ledger.
 *
 * A type guard rather than a boolean so the service signature can demand
 * `CashLedgerOwnerType` and **passing a vendor does not compile** — the same
 * shape as `RoutedPermissionName` making a dead permission a compile error, and
 * stronger than a comment nobody reads.
 */
export function supportsCashLedger(ownerType: AccountOwnerType): ownerType is CashLedgerOwnerType {
    return (CASH_LEDGER_OWNER_TYPES as readonly string[]).includes(ownerType);
}

// ─── Sub-list query shapes ────────────────────────────────────────────────────

/** Shared with `/money/payouts` — the allowlist is not restated server-side. */
export const ACCOUNT_PAYOUT_SORT_KEYS = ['createdAt', 'amount', 'resolvedAt'] as const;
export const CREDIT_SORT_KEYS = ['createdAt', 'amount'] as const;
export const CASH_LEDGER_SORT_KEYS = ['createdAt', 'amount'] as const;
export const LEDGER_SORT_DEFAULT = '-createdAt';

/** For filter options only — the wire value is an unenumerated string. */
export const CREDIT_TRANSACTION_TYPES = [
    'allowance',
    'topup',
    'debit',
    'adjustment',
    'refund',
] as const;

export interface AccountPayoutsQuery {
    status?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface CreditLedgerQuery {
    type?: string;
    reasonCode?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface CashLedgerQuery {
    entryType?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/**
 * How many contracts and reserve holds the account overview carries.
 *
 * `EXPOSURE_LIMIT` in `account.controller.ts:125` — **a bound, not a page**. An
 * agent has a handful of agency contracts and an agency's reserve holds mature
 * within days, so there is nothing to page. The consequence for the UI: a full
 * 50 rows may be a truncation, and the screen says so rather than implying it is
 * the whole set.
 */
export const ACCOUNT_EXPOSURE_LIMIT = 50;
