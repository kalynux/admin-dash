/**
 * `/vendors` — the eleven endpoints of the vendor surface.
 *
 * Sources: `api-doc/admin/api/vendors.md`, `api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md`,
 * and `backend/admin/src/modules/vendors/` where the first two disagree with the
 * running service. See `types/vendors.types.ts` for the four shapes the published
 * docs get wrong.
 *
 * ── Four reads direct, seven writes delegated ─────────────────────────────────
 * The list, the detail, the catalogue and the activity feed are answered from
 * jovi-mall's collections by wi-admin itself; **all seven writes are executed by
 * jovi-mall** and forwarded. That asymmetry is not cosmetic and it decides how
 * failures arrive here: a read fails with wi-admin's own codes, and a write can
 * additionally fail with `PLATFORM_OPERATION_REJECTED` carrying jovi-mall's code
 * in `details.platformCode` — which is the **only** handle on why.
 * `ApiError.platformCode` exposes it; call sites branch on that, never on
 * `error.code`.
 *
 * The gap is wider here than it was for users
 * ([ADR-008 D-1](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)): suspending a
 * vendor **takes their entire catalogue off sale inside the same transaction**,
 * and reinstating them **re-runs the activation gate on every listing** rather
 * than republishing blindly. A second writer would move the status, miss the
 * cascade, and leave a "suspended" vendor still selling.
 *
 * ── No vendor action is dual-controlled ───────────────────────────────────────
 * `vendors.md`'s route table has a ✅ column and it means **audited**, not quorum.
 * The only three four-eyes actions on the service are promoting an administrator
 * to tier 1, suspending or reinstating a tier-1 administrator, and marking a
 * payout ≥ 2 000 000 XAF as paid. So these use `api.post` / `api.patch`; nothing
 * here can answer `202`, and `api.dualControl` would be wrong.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    ApproveVendorKycBody,
    PlatformVendor,
    ProductRestoreResult,
    ProductSuspendResult,
    RejectVendorKycBody,
    SuspendVendorBody,
    SuspendVendorProductBody,
    UpdateVendorSettingsBody,
    Vendor,
    VendorActivityQuery,
    VendorDetail,
    VendorListQuery,
    VendorAgencyConnection,
    VendorAgencyConnectionQuery,
    VendorProduct,
    VendorProductDetail,
    VendorProductListQuery,
    VendorSettingsResult,
} from '@/types/vendors.types';

/**
 * `meta` on `GET /vendors` — the four standard keys, plus one this list alone has.
 *
 * Narrowed to numbers here rather than left as `ListMeta`'s `unknown`s, so a pager
 * cannot be handed a string.
 */
export interface VendorListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
    /**
     * Present, and only ever `true`, when a `search` term matched more business
     * names than the store pre-match could return (its cap is 500).
     *
     * [ADR-005 D-13 forbids a silent cap](../../api-doc/docs/ADR-005-API-CONTRACT.md):
     * a truncated result set that looked complete would be read as "this vendor
     * does not exist". The directory renders a hint when it is set.
     */
    businessNameMatchesTruncated?: true;
}

export interface VendorPage {
    data: Vendor[];
    meta: VendorListMeta;
}

export interface VendorProductPage {
    data: VendorProduct[];
    meta: {
        total: number;
        page: number;
        limit: number;
        pages: number;
    };
}

export interface VendorAgencyConnectionPage {
    data: VendorAgencyConnection[];
    meta: {
        total: number;
        page: number;
        limit: number;
        pages: number;
    };
}

/**
 * Coerce the envelope's `meta` into numbers, keeping the vendor-only flag.
 *
 * The `pages` fallback honours the contract's empty-list rule deliberately —
 * defaulting to `1` would render "page 1 of 1" over nothing. It only fires when
 * `api.list` synthesised a meta, which happens when something upstream of
 * wi-admin answered instead of it.
 *
 * `businessNameMatchesTruncated` is read as a strict `=== true` rather than
 * coerced: the server **omits** the key when it does not apply, and a truthiness
 * test over a coerced value would turn an absent key into a rendered warning.
 */
function toPage(page: Paginated<Vendor>): VendorPage {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
            ...(page.meta.businessNameMatchesTruncated === true
                ? { businessNameMatchesTruncated: true as const }
                : {}),
        },
    };
}

function toProductPage(page: Paginated<VendorProduct>): VendorProductPage {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
        },
    };
}

function toConnectionPage(
    page: Paginated<VendorAgencyConnection>,
): VendorAgencyConnectionPage {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
        },
    };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * `GET /vendors` · `vendors.read` — the directory.
 *
 * Sorting is one key at a time from `VENDOR_SORT_KEYS`; anything else is a `400`
 * naming the permitted set. **Business name is not among them** — it lives on
 * `stores`, so sorting by it would need a `$lookup` before the `$sort`, which
 * cannot use an index and cannot carry the tiebreaker that keeps paging stable.
 *
 * `search` matches the business name, the display name, the email, the phone, or —
 * when the term is 24-hex — the **vendor id or its user id**. Both id branches are
 * deliberate: every other admin screen identifies this person by their user id.
 *
 * `from`/`to` filter **creation**, are half-open `[from, to)`, cap at 366 days,
 * and must be instants with an explicit zone — a date-only value is refused. Use
 * `resolveDayFilter` from `lib/datetime.ts`; never format a day yourself.
 */
export async function listVendors(
    query: VendorListQuery = {},
    options?: RequestOptions,
): Promise<VendorPage> {
    return toPage(await api.list<Vendor>(withQuery('/vendors', { ...query }), options));
}

/**
 * `GET /vendors/:vendorId` · `vendors.read` — the shop, the account behind it,
 * their settings, and an operational tally.
 *
 * A malformed id is a `400 VALIDATION_ERROR` ("Not a valid vendor id") at the
 * edge, not a `404`; a real id nobody holds is `404 NOT_FOUND`.
 *
 * Nothing sensitive is ever returned: payout details and the national id number
 * are excluded by the read projection **and** by the DTO naming its own fields.
 */
export function getVendor(vendorId: string, options?: RequestOptions): Promise<VendorDetail> {
    return api.get<VendorDetail>(`/vendors/${encodeURIComponent(vendorId)}`, options);
}

/**
 * `GET /vendors/:vendorId/products` · `vendors.read` — the catalogue, as platform
 * oversight sees it.
 *
 * The `suspensionReason` filter is the one worth knowing about: *which of this
 * vendor's listings did **we** take down, and which did their agency* is
 * unanswerable without it, and the two have very different remedies.
 *
 * A `404` here means **the vendor** does not exist — checked before the catalogue
 * is read, so an empty list reads as "they sell nothing" only when that is true.
 */
export async function listVendorProducts(
    vendorId: string,
    query: VendorProductListQuery = {},
    options?: RequestOptions,
): Promise<VendorProductPage> {
    return toProductPage(
        await api.list<VendorProduct>(
            withQuery(`/vendors/${encodeURIComponent(vendorId)}/products`, { ...query }),
            options,
        ),
    );
}

/**
 * `GET /vendors/:vendorId/products/:productId` · `vendors.read` — one listing, in
 * full.
 *
 * Granted at BR-005 and in `ROUTE-MAP.md` since; it had no function here until
 * Phase B2, which is why the catalogue tab could only ever show the thirteen
 * fields a list row carries.
 *
 * ── ⚠ It is DELEGATED, so a "not found" does not arrive as `NOT_FOUND` ────────
 * The only delegated *read* on this whole gateway, and for a stated reason
 * (ADR-009 D-6): `media` needs `storage.getPublicUrl(key)` and `storage` needs
 * jovi-mall's fee calculator, neither of which wi-admin owns. The consequence at
 * the call site is the part that bites — a missing vendor **or** a product that
 * is not theirs both come back as **`404 PLATFORM_OPERATION_REJECTED`** carrying
 * `VENDOR_NOT_FOUND` or `CATALOG_PRODUCT_NOT_FOUND` in `details.platformCode`.
 * `ApiError.isNotFound` still answers on the status, so an ordinary
 * "no such record" branch works; anything wanting to tell the two apart must read
 * `platformCode`, never `error.code`.
 *
 * Scoped by **both** ids: the ownership is the authorisation. A malformed id is a
 * `400 VALIDATION_ERROR` at the edge before either lookup runs.
 *
 * **Not audited.** It is a read, and this service audits exactly one of those —
 * the payout destination, where the disclosure *is* the action. Opening a
 * product listing is not.
 */
export function getVendorProduct(
    vendorId: string,
    productId: string,
    options?: RequestOptions,
): Promise<VendorProductDetail> {
    return api.get<VendorProductDetail>(
        `/vendors/${encodeURIComponent(vendorId)}/products/${encodeURIComponent(productId)}`,
        options,
    );
}

/**
 * `GET /vendors/:vendorId/agencies` · **`vendors.read` AND `agencies.read`**,
 * `all` mode — the vendor's delivery-agency connections, as rows.
 *
 * Granted at BR-018. The mirror image of the agency roster, and the enumeration
 * behind `counts.agencyConnections`: the seven integers on the vendor detail say
 * six connections are active, and these rows say **which** six.
 *
 * ── ⚠ The second permission is not incidental ────────────────────────────────
 * The rows carry business names, contact people and commercial state, so gating
 * on `vendors.read` alone would make this a second door onto the agency
 * directory. Gate the affordance with
 * `<Can permission={['vendors.read','agencies.read']} mode="all">` — `satisfies`
 * takes no default mode precisely so this cannot be read as `any`. A caller
 * holding one and not the other gets a `403` whose `details.required` names the
 * **missing** one, so a client can say which permission is short.
 *
 * ── A direct read, unlike every write on the same collection ─────────────────
 * A `vendor_agency_connections` document is a *record*, and there is no verdict
 * on this surface. Every **write** on the collection stays delegated, and there
 * the reason is concrete: a status change suspends or restores the vendor's
 * products in the same transaction.
 *
 * `status` is validated for shape rather than membership, so send jovi-mall's
 * token through unchanged and render an unrecognised one rather than rejecting
 * it. A blank string is a `400`; `buildQuery` already drops `''`.
 */
export async function listVendorAgencyConnections(
    vendorId: string,
    query: VendorAgencyConnectionQuery = {},
    options?: RequestOptions,
): Promise<VendorAgencyConnectionPage> {
    return toConnectionPage(
        await api.list<VendorAgencyConnection>(
            withQuery(`/vendors/${encodeURIComponent(vendorId)}/agencies`, { ...query }),
            options,
        ),
    );
}

/**
 * `GET /vendors/:vendorId/activity` · **`vendors.read` AND `audit.read`**, `all` mode.
 *
 * The composite is the point: requiring only `vendors.read` would make this a
 * second door onto the audit trail that bypasses the permission governing it.
 * Gate the affordance with `<Can permission={['vendors.read','audit.read']} mode="all">`
 * — `satisfies` takes no default mode precisely so this cannot be read as `any`.
 *
 * **This is what administrators did to this vendor**, not what the vendor did on
 * the platform. Their orders, shipments and catalogue edits live in other domains
 * behind other permissions.
 *
 * The response is the audit entry shape, so it reuses `toAuditPage` rather than a
 * third coercion helper that could disagree with it. Note the span caps at
 * **366 days here**, not the 92 that `GET /audit` enforces.
 */
export async function listVendorActivity(
    vendorId: string,
    query: VendorActivityQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(
            withQuery(`/vendors/${encodeURIComponent(vendorId)}/activity`, { ...query }),
            options,
        ),
    );
}

/**
 * How many vendors there are — `meta.total` on a list asked for with `limit=1`.
 *
 * Moved here from `services/counts.ts`, which asked for exactly that in its own
 * header note: a path encoded in two places is the two-lists-that-can-disagree
 * failure the navigation config spends four paragraphs avoiding. `counts.ts`
 * re-exports this, so the overview's import keeps working.
 *
 * **Signature deliberately matches its siblings** — `(options?)`, not
 * `(query?, options?)`. The overview passes this function by reference to
 * `CountTile`, which calls it as `read({ signal })`; a leading query parameter
 * would serialise the `AbortSignal` into the URL.
 */
export async function countVendors(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(withQuery('/vendors', { limit: 1 }), options);
    return Number(page.meta.total ?? 0);
}

// ─── Writes — all delegated, all audited, all CSRF-protected ──────────────────

/**
 * `POST /vendors/:vendorId/suspend` · `vendors.suspend`.
 *
 * **Heavier than it looks.** This takes the vendor's whole catalogue off sale
 * inside one jovi-mall transaction, and the response's `suspendedProductCount` is
 * the only place that number is ever reported — no later read carries it.
 *
 * It also blocks their API access, narrowly: jovi-mall's `requireAuth` and `login`
 * refuse a vendor whose role entity is `inactive` with its own code,
 * `AUTH_VENDOR_SUSPENDED`. The check is `=== 'inactive'`, never `!== 'active'`,
 * because `pending_verification` is the registration default and the negated form
 * would have locked out every vendor who never verified their email.
 *
 * It does **not** touch the sign-in account. `users.status` is a separate axis
 * with its own permission and its own screen: "your login is suspended" and "your
 * shop is suspended" have different remedies, and one person can hold both a
 * `vendor` and a `customer` role.
 *
 * A compare-and-set on `status`, so the loser of two concurrent screens gets `409`
 * with `platformCode: 'VENDOR_STATUS_CONFLICT'` rather than overwriting the
 * winner's reason.
 */
export function suspendVendor(
    vendorId: string,
    body: SuspendVendorBody,
    options?: RequestOptions,
): Promise<PlatformVendor> {
    return api.post<PlatformVendor>(
        `/vendors/${encodeURIComponent(vendorId)}/suspend`,
        body,
        options,
    );
}

/**
 * `POST /vendors/:vendorId/restore` · **`vendors.suspend`** — the same permission
 * governs both directions; only the audit actions differ (`vendors.suspend` and
 * **`vendors.reinstate`**).
 *
 * No request body. **Fewer listings come back than went down, routinely, and that
 * is correct**: this re-runs the activation gate on every listing rather than
 * republishing blindly, so anything that no longer passes stays off sale. Show
 * `restoredProductCount` and say why, or an operator reads the difference as a
 * partial failure.
 *
 * A listing suspended as `platform_oversight` is **never** republished by this
 * call — only `restoreVendorProduct` lifts that. It is a human act, so nothing
 * automatic clears it.
 *
 * `409 VENDOR_STATUS_CONFLICT` when the vendor is not `inactive`.
 */
export function restoreVendor(
    vendorId: string,
    options?: RequestOptions,
): Promise<PlatformVendor> {
    return api.post<PlatformVendor>(
        `/vendors/${encodeURIComponent(vendorId)}/restore`,
        undefined,
        options,
    );
}

/**
 * `POST /vendors/:vendorId/kyc/approve` · `vendors.kyc.review`.
 *
 * The body is **strict** and `note` is optional — an approval needs no
 * justification the vendor has to act on.
 *
 * **Approving gates nothing.** Verification is visible to agencies and is now
 * settable and explicable, but no vendor behaviour depends on it: gating selling
 * on it would lock out the entire existing roster until each vendor is reviewed
 * ([ADR-008 D-5](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)). Say so on the
 * screen rather than letting an operator infer a consequence that does not exist.
 *
 * `409 VENDOR_KYC_STATUS_CONFLICT` when the verdict already is `verified`.
 */
export function approveVendorKyc(
    vendorId: string,
    body: ApproveVendorKycBody = {},
    options?: RequestOptions,
): Promise<PlatformVendor> {
    return api.post<PlatformVendor>(
        `/vendors/${encodeURIComponent(vendorId)}/kyc/approve`,
        body,
        options,
    );
}

/**
 * `POST /vendors/:vendorId/kyc/reject` · `vendors.kyc.review`.
 *
 * `reason` is **required** where the approval's `note` is optional, and the
 * asymmetry is deliberate: a rejection the vendor cannot see the cause of is one
 * they can only respond to by re-submitting blind.
 *
 * The reason is stored **in jovi-mall**, not only in wi-admin's audit row —
 * jovi-mall cannot read this database, so a reason held only here could never be
 * shown to the vendor it is about.
 *
 * `409 VENDOR_KYC_STATUS_CONFLICT` when the verdict already is `rejected`.
 */
export function rejectVendorKyc(
    vendorId: string,
    body: RejectVendorKycBody,
    options?: RequestOptions,
): Promise<PlatformVendor> {
    return api.post<PlatformVendor>(
        `/vendors/${encodeURIComponent(vendorId)}/kyc/reject`,
        body,
        options,
    );
}

/**
 * `POST /vendors/:vendorId/products/:productId/suspend` · `vendors.products.manage`.
 *
 * Nested under `/:vendorId` because **the ownership is the authorisation** —
 * jovi-mall scopes the write by both ids, so a product belonging to another vendor
 * cannot be acted on by naming this one.
 *
 * The body field is **`note`**, not `reason`, and it is required (3–500). The
 * takedown is recorded with reason `platform_oversight`, which is disjoint from
 * every automatic sweep: **nothing automatic ever clears it**, and reinstating the
 * vendor will not republish this listing.
 *
 * Failures are **422**, not `409` as the docs say: `VENDOR_PRODUCT_NOT_SUSPENDABLE`
 * covers both "not this vendor's product" and "not currently on sale". Offer the
 * action only on a listing that is actually active — `canSuspendProduct` in
 * `types/vendors.types.ts`.
 *
 * The audit row targets the **vendor**, with the product in its payload, so this
 * appears in the vendor's activity feed — which is where somebody asking *this
 * vendor's listings went dark, why* will look
 * ([ADR-008 D-7](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)).
 */
export function suspendVendorProduct(
    vendorId: string,
    productId: string,
    body: SuspendVendorProductBody,
    options?: RequestOptions,
): Promise<ProductSuspendResult> {
    return api.post<ProductSuspendResult>(
        `/vendors/${encodeURIComponent(vendorId)}/products/${encodeURIComponent(productId)}/suspend`,
        body,
        options,
    );
}

/**
 * `POST /vendors/:vendorId/products/:productId/restore` · `vendors.products.manage`.
 *
 * No request body. **Lifts exactly one reason.** A listing taken down by an agency
 * cascade or by the vendor's own suspension is refused with `422
 * VENDOR_PRODUCT_NOT_OVERSIGHT_SUSPENDED` — those have their own remedies. Offer
 * the action only where `canRestoreProduct` says so.
 *
 * The activation gate still runs: `422 VENDOR_PRODUCT_UNSUSPEND_BLOCKED` carries
 * `details.blockers` — a list of `{ code, message }` that is the literal answer to
 * *why won't this go back on sale*. Render every entry; it is the richest error on
 * the surface.
 */
export function restoreVendorProduct(
    vendorId: string,
    productId: string,
    options?: RequestOptions,
): Promise<ProductRestoreResult> {
    return api.post<ProductRestoreResult>(
        `/vendors/${encodeURIComponent(vendorId)}/products/${encodeURIComponent(productId)}/restore`,
        undefined,
        options,
    );
}

/**
 * `PATCH /vendors/:vendorId/settings` · `vendors.settings.manage`.
 *
 * **Three fields, and the body is strict.** Naming anything else is a `400` *here,
 * before the request reaches jovi-mall* — a call that looks like it changed a
 * commission must never come back `200` having changed nothing.
 *
 * The rule that picked these three
 * ([ADR-008 D-8](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)): a setting is the
 * administrator's when its effect lands on somebody other than the vendor.
 * `notifyDaysBeforeExpiry` notifies the vendor about the vendor, so it is theirs
 * and the schema rejects it by name. **Commission is not here at all** — it lives
 * on the billing `PricingPlan`, and nothing here should be extended to reach it.
 *
 * `autoRedirectThresholdAmount: null` **clears the cap**: every order then
 * auto-dispatches while the flag is on. An empty body is a `400 "Nothing to
 * update"`.
 *
 * The response carries only the three writable values, not the whole settings
 * block — the screen refetches the detail rather than merging it.
 */
export function updateVendorSettings(
    vendorId: string,
    body: UpdateVendorSettingsBody,
    options?: RequestOptions,
): Promise<VendorSettingsResult> {
    return api.patch<VendorSettingsResult>(
        `/vendors/${encodeURIComponent(vendorId)}/settings`,
        body,
        options,
    );
}

// ─── The platform codes a delegated vendor write can carry ────────────────────

/**
 * jovi-mall's own codes, as they arrive in `details.platformCode`.
 *
 * **Not published.** `vendors.md` documents exactly one of these
 * (`VENDOR_STATUS_CONFLICT`) and gives no error table at all for restore, the two
 * KYC verdicts or the product restore. Every constant below was read from
 * `backend/jovi-mall/src/modules/vendors/admin-vendor.service.ts`, where it is
 * thrown, at the status noted — and each is handled defensively, so a code this
 * list does not know still falls through to the generic error toast rather than
 * being swallowed.
 */

/** 404 — raised by every write before it does anything. */
export const PLATFORM_CODE_VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND';

/**
 * 409 — the compare-and-set on `status` lost, in **either** direction: already
 * suspended, or not suspended. Reload and look at what the record says now.
 */
export const PLATFORM_CODE_VENDOR_STATUS_CONFLICT = 'VENDOR_STATUS_CONFLICT';

/** 409 — the verdict already is the one being asked for. */
export const PLATFORM_CODE_KYC_STATUS_CONFLICT = 'VENDOR_KYC_STATUS_CONFLICT';

/**
 * **422** — the listing cannot be taken off sale. Covers both "it is not this
 * vendor's product" and "it is not currently on sale", deliberately: distinguishing
 * them would confirm the existence of another vendor's product id.
 */
export const PLATFORM_CODE_PRODUCT_NOT_SUSPENDABLE = 'VENDOR_PRODUCT_NOT_SUSPENDABLE';

/** 404 — no such product on the restore path. */
export const PLATFORM_CODE_PRODUCT_NOT_FOUND = 'CATALOG_PRODUCT_NOT_FOUND';

/**
 * **422** — the takedown was not `platform_oversight`, so this endpoint will not
 * lift it. `details.reason` names what actually took it down.
 */
export const PLATFORM_CODE_PRODUCT_NOT_OVERSIGHT_SUSPENDED =
    'VENDOR_PRODUCT_NOT_OVERSIGHT_SUSPENDED';

/**
 * **422** — the activation gate refused. `details.blockers` is a
 * `{ code, message, details? }[]` and is the only statement of why.
 */
export const PLATFORM_CODE_PRODUCT_UNSUSPEND_BLOCKED = 'VENDOR_PRODUCT_UNSUSPEND_BLOCKED';
