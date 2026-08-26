/**
 * `/billing` — the pricing-plan catalog and who is on it. All eight routes.
 *
 * ── The three writes deliberately return no document ──────────────────────────
 * `createPlan`, `updatePlan` and `assignSubscription` answer jovi-mall's **raw
 * Mongoose document**: snake_case, `_id` and `__v`, no `id`, no nested `limits`,
 * and on a subscription no `owner`/`plan`/`assignedBy` objects at all. Neither
 * schema opts into the `_id`-stripping transform, so nothing normalises it on the
 * way out.
 *
 * These functions therefore **discard `data` entirely** rather than typing it
 * `unknown` — the house rule established by `orders.service.ts`: an opaque type
 * still lets a call site index into it, while a function that never returns the
 * document makes rendering one structurally impossible. Every caller refetches,
 * which is what a delegated write needs anyway.
 *
 * `archivePlan` is the exception that keeps its `message`, because the platform
 * answers `data: null` and the sentence — *"existing subscribers keep it until
 * their term ends"* — is the only place that fact is stated.
 *
 * ── Nothing here is dual-controlled ───────────────────────────────────────────
 * `billing.subscriptions.assign` is flagged `financial` and `billing.plans.delete`
 * `destructive`, but both are *grant* concerns rather than quorum ones. No
 * billing route can answer `202`, so `api.dualControl` would be wrong.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    AssignSubscriptionBody,
    CreatePlanBody,
    OwnerSubscriptions,
    Plan,
    PlanListQuery,
    Subscription,
    SubscriptionListQuery,
    UpdatePlanBody,
} from '@/types/billing.types';

/**
 * `GET /billing/plans` · `billing.plans.read`.
 *
 * Sort allowlist `sortOrder` · `price` · `name` · `createdAt`, default
 * **`sortOrder` ascending** — `sortOrder` is the field the platform put there to
 * say what order these belong in, and a catalog listed newest-first shows the
 * tiers in whatever order somebody happened to create them.
 *
 * `includeArchived` defaults to `false`. Archived plans are **excluded, not
 * gone**: existing subscribers keep running on one, so "which plan is this vendor
 * on" can name a row this list would not otherwise show.
 */
export function listPlans(
    query: PlanListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Plan>> {
    return api.list<Plan>(withQuery('/billing/plans', { ...query }), options);
}

/**
 * `GET /billing/plans/:planId` · `billing.plans.read`.
 *
 * **Returns archived plans too** — there is no `deletedAt` filter on this read,
 * which is deliberate and is why the detail screen can explain an archived tier
 * rather than 404 on it.
 */
export function getPlan(planId: string, options?: RequestOptions): Promise<Plan> {
    return api.get<Plan>(`/billing/plans/${encodeURIComponent(planId)}`, options);
}

/**
 * `GET /billing/plans/:planId/subscribers` · `billing.plans.read`.
 *
 * Everyone on this tier. The plan is fixed by the path and cannot be widened by a
 * query parameter, so `plan.code` and `plan.name` are never null here — the
 * dangling-plan case is only reachable on the cross-owner list below.
 */
export function listPlanSubscribers(
    planId: string,
    query: SubscriptionListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Subscription>> {
    return api.list<Subscription>(
        withQuery(`/billing/plans/${encodeURIComponent(planId)}/subscribers`, { ...query }),
        options,
    );
}

/**
 * `GET /billing/subscriptions` · `billing.plans.read`.
 *
 * Every term across every owner kind.
 *
 * ⚠ `expiringBefore` compiles to `expires_at: { $ne: null, $lt: … }`, so it
 * **never matches the never-expiring free tier**. That is correct — a plan with
 * no expiry is not "expiring later" — but it means the filter answers a narrower
 * question than its name suggests.
 */
export function listSubscriptions(
    query: SubscriptionListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Subscription>> {
    return api.list<Subscription>(withQuery('/billing/subscriptions', { ...query }), options);
}

/**
 * `GET /billing/subscriptions/:ownerType/:ownerId` · `billing.plans.read` ·
 * direct read · **unpaginated**.
 *
 * Every term one owner holds, already partitioned into `current` / `queued` /
 * `history` by the service.
 *
 * ⚠ **Use this, not `listSubscriptions({ ownerId })`, whenever the question is
 * about one owner.** The cross-owner list is server-paginated, so an owner's
 * rows can straddle a page boundary and a client grouping them would group only
 * *some* of their terms with no way to know. And ranking `status` client-side to
 * find the live row is a guess that changes silently when a fifth status appears
 * upstream — here the answer comes from the service.
 *
 * ⚠ **`current: null` means "no active plan"**, not "could not determine".
 *
 * ⚠ **Read `queued` before offering an assignment.** Non-null means
 * `assignSubscription` will be refused with `BILLING_PENDING_PLAN_EXISTS`, and
 * that refusal sits on an ordinary path rather than an edge case.
 *
 * `meta.total` counts all rows and is not a page size; it is dropped here
 * because the four fields already carry it.
 *
 * `404 ACCOUNT_OWNER_NOT_FOUND` names no vendor, agency or agent. **An owner who
 * has never had a plan is not this** — that answers `current: null` with an
 * empty `history`.
 */
export function getOwnerSubscriptions(
    ownerType: string,
    ownerId: string,
    options?: RequestOptions,
): Promise<OwnerSubscriptions> {
    return api.get<OwnerSubscriptions>(
        `/billing/subscriptions/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}`,
        options,
    );
}

/**
 * `GET /billing/subscriptions/:subscriptionId` · `billing.plans.read` · direct read.
 *
 * One term by its own id, so an operator can link a colleague to one and a
 * `paymentReference` quoted in a support ticket has somewhere to point.
 *
 * No collision with the owner-scoped read above: that one takes two path
 * segments and this takes one, so Express separates them structurally rather
 * than by declaration order.
 */
export function getSubscription(
    subscriptionId: string,
    options?: RequestOptions,
): Promise<Subscription> {
    return api.get<Subscription>(
        `/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
        options,
    );
}

/**
 * `POST /billing/plans` · `billing.plans.manage` · **delegated** · `201`.
 *
 * **Returns nothing.** See the module header: the response is a raw snake_case
 * document, so the caller refetches the catalog instead.
 *
 * The body is `.strict()` and the five limits are **flat**, not nested under
 * `limits` — sending the nested shape the response uses is a `400`.
 *
 * `409 PLATFORM_OPERATION_REJECTED` with `platformCode
 * BILLING_PLAN_CODE_EXISTS` when the code is taken; codes are unique and
 * immutable once set.
 */
export async function createPlan(
    body: CreatePlanBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>('POST', '/billing/plans', body, options);
    return { message: result.message };
}

/**
 * `PATCH /billing/plans/:planId` · `billing.plans.manage` · **delegated**.
 *
 * **Returns nothing**, for the same reason as `createPlan`.
 *
 * `role` and `code` are refused outright, and an empty body is a `400`. `null`
 * clears exactly five keys and is a `400` on the rest — see `UpdatePlanBody`.
 *
 * ⚠ **On an archived plan this always fails**, with `404
 * PLATFORM_OPERATION_REJECTED` / `BILLING_PLAN_NOT_FOUND`: wi-admin's read
 * returns archived rows, jovi-mall's write does not see them. The UI hides the
 * affordance rather than surfacing that as a missing plan.
 */
export async function updatePlan(
    planId: string,
    body: UpdatePlanBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'PATCH',
        `/billing/plans/${encodeURIComponent(planId)}`,
        body,
        options,
    );
    return { message: result.message };
}

/**
 * `DELETE /billing/plans/:planId` · `billing.plans.delete` (`destructive`) ·
 * **delegated**.
 *
 * **A soft delete.** The row stays, `archivedAt` is stamped, and every owner
 * already on the tier keeps running on it until their term ends.
 *
 * The platform answers `data: null`, so this keeps the **message** — it is the
 * only place the subscriber consequence is stated, and it names the plan code.
 * Read the row back afterwards with `?includeArchived=true`.
 */
export async function archivePlan(
    planId: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<null>(
        'DELETE',
        `/billing/plans/${encodeURIComponent(planId)}`,
        undefined,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /billing/subscriptions/:ownerType/:ownerId` ·
 * `billing.subscriptions.assign` (`financial`) · **delegated**.
 *
 * **Returns nothing** — the response is the raw `subscriber_plans` document, with
 * no `owner`, no `plan` and no `assignedBy`, so it cannot render through the same
 * component the list uses.
 *
 * Assigning expires the current term, grants a credit allowance exactly once
 * inside the same transaction that activates it, and emits an event that resizes
 * an agent's shipment capacity — which is why it is delegated rather than written
 * here.
 *
 * Four platform refusals, and the fourth is undocumented:
 * `BILLING_PLAN_INACTIVE`, `BILLING_PLAN_ROLE_MISMATCH`,
 * `BILLING_PLAN_NOT_FOUND`, and **`BILLING_PENDING_PLAN_EXISTS`** — the owner
 * already has a queued term because their paid one has not lapsed.
 *
 * Note the two different 404s: a missing **plan** is `NOT_FOUND`, a missing
 * **owner** is `ACCOUNT_OWNER_NOT_FOUND`.
 */
export async function assignSubscription(
    ownerType: string,
    ownerId: string,
    body: AssignSubscriptionBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/billing/subscriptions/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}`,
        body,
        options,
    );
    return { message: result.message };
}
