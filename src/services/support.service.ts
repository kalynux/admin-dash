/**
 * `/support/tickets` — nineteen routes, the largest module on the service.
 *
 * Source: `api-doc/admin/api/support.md`. Contract detail lives on the types in
 * `types/support.types.ts`; this file is about how to call them.
 *
 * ── Two reads direct, seventeen routes delegated ──────────────────────────────
 * The queue and the detail are answered from jovi-mall's collections by wi-admin
 * itself; **everything else is executed by jovi-mall** and forwarded. So the two
 * reads fail with wi-admin's own codes, and every write can additionally fail
 * with `PLATFORM_OPERATION_REJECTED` carrying jovi-mall's code in
 * `details.platformCode` — which is the only handle on why.
 *
 * ── The writes split four ways on purpose ─────────────────────────────────────
 * `update` for the content, `assign` for who holds it, `lifecycle` for
 * open/closed, `followers.manage` for who is on it. A single
 * `support.tickets.write` would mean anyone who can rename a ticket can also
 * reassign it. Status, priority and the content edit are likewise **three
 * sub-resources rather than three fields on one PATCH**: the permission and the
 * audit row attach to the *action*, and folding them into one body would produce
 * one audit row that cannot say which of them happened.
 *
 * ── `assigned_admin_id` was a LOCK, and it is gone ────────────────────────────
 * The legacy mount auto-set that field on an administrator's **first action**,
 * and it thereafter answered `403` to everybody else — Developers included. It
 * read like an assignment and behaved like an exclusive lock. Assignment here is
 * explicit, recorded, and *removes* reach rather than granting it: the
 * unassigned pool is actionable by every tier, assigning to a Developer takes a
 * ticket **out of** an Admin's reach, and **there is no unassign** — dropping a
 * ticket back to the pool would be a way around the tier rules.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    AddFollowerBody,
    AssignTicketBody,
    AttachFileBody,
    CreateNoteBody,
    CreateTicketBody,
    Ticket,
    TicketAttachment,
    TicketDetail,
    TicketListQuery,
    TicketToken,
    UpdateTicketBody,
} from '@/types/support.types';

const base = (ticketId: string) => `/support/tickets/${encodeURIComponent(ticketId)}`;

// ─── The queue ────────────────────────────────────────────────────────────────

/**
 * `GET /support/tickets` · `support.tickets.read` · **direct read**.
 *
 * ⚠ **An unrecognised `status` / `type` / `priority` / `importance` returns an
 * empty page, not a `400`.** All four are jovi-mall's vocabularies and are
 * validated for shape only, so a stale filter value looks like "no results"
 * rather than an error.
 *
 * `queue` narrows **inside** the caller's scope and can never widen it.
 */
export function listTickets(
    query: TicketListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Ticket>> {
    return api.list<Ticket>(withQuery('/support/tickets', { ...query }), options);
}

/**
 * `GET /support/tickets/:ticketId` · `support.tickets.read` · **direct read**.
 *
 * The list item plus `description`.
 *
 * ⚠ **A `404 TICKET_NOT_FOUND` is the scope's denial as well as a missing
 * record**, and the two are indistinguishable by design — a `403` would confirm
 * the ticket exists. Render it as "not available to you", never as a fault.
 */
export function getTicket(ticketId: string, options?: RequestOptions): Promise<TicketDetail> {
    return api.get<TicketDetail>(base(ticketId), options);
}

// ─── Create and edit ──────────────────────────────────────────────────────────

/**
 * `POST /support/tickets` · `support.tickets.create` · delegated · **audited**.
 *
 * ⚠ **The response is jovi-mall's enriched ticket, passed through verbatim** —
 * *not* this service's `TicketDto`, snake_case fields included. Re-read through
 * `getTicket` if you need this service's shape; typed `unknown` here so nothing
 * renders it by accident.
 */
export function createTicket(
    body: CreateTicketBody,
    options?: RequestOptions,
): Promise<unknown> {
    return api.post<unknown>('/support/tickets', body, options);
}

/**
 * `PATCH /support/tickets/:ticketId` · `support.tickets.update` · delegated ·
 * **audited**.
 *
 * ⚠ **At least one field is required** — an empty body is a `400`, not an
 * accepted no-op, because a no-op that writes an audit row is a lie in the
 * trail.
 *
 * A `403` here is **the assignment lock**: you can see this ticket, and another
 * administrator holds it.
 */
export function updateTicket(
    ticketId: string,
    body: UpdateTicketBody,
    options?: RequestOptions,
): Promise<unknown> {
    return api.patch<unknown>(base(ticketId), body, options);
}

/**
 * `PATCH /support/tickets/:ticketId/status` · `support.tickets.update` ·
 * delegated · **audited**.
 *
 * `status` is format-validated here and **pinned at jovi-mall**, which owns the
 * state machine. An invalid transition or an unknown value comes back as
 * `PLATFORM_OPERATION_REJECTED`.
 */
export function setTicketStatus(
    ticketId: string,
    status: TicketToken,
    options?: RequestOptions,
): Promise<unknown> {
    return api.patch<unknown>(`${base(ticketId)}/status`, { status }, options);
}

/**
 * `PATCH /support/tickets/:ticketId/priority` · `support.tickets.update` ·
 * delegated · **audited**.
 *
 * ⚠ **One-way in effect.** jovi-mall sets `priority_locked` when an
 * administrator changes a priority, and the requester can no longer change it
 * afterwards. **Read `priorityLocked` on the ticket before offering the
 * control.**
 */
export function setTicketPriority(
    ticketId: string,
    priority: TicketToken,
    options?: RequestOptions,
): Promise<unknown> {
    return api.patch<unknown>(`${base(ticketId)}/priority`, { priority }, options);
}

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * `PATCH /support/tickets/:ticketId/assign` · `support.tickets.assign` ·
 * delegated · **audited**.
 *
 * ⚠ **Offer this only for tiers in `ticket.availableActions.assignableTiers`.**
 * The authority table is intricate — a tier-2 Admin may assign to 1 and 3,
 * *except* on a ticket a Developer handed them, which may only go to 3 — and it
 * keys on the **assigner's** tier, not the holder's, which is why the ticket
 * carries an `assignedBy` stamp at all. A second copy of the rules in the
 * dashboard is how a button appears for a verb the API refuses.
 *
 * ⚠ **An unassigned ticket cannot be assigned to anybody — claim it first.**
 */
export function assignTicket(
    ticketId: string,
    body: AssignTicketBody,
    options?: RequestOptions,
): Promise<unknown> {
    return api.patch<unknown>(`${base(ticketId)}/assign`, body, options);
}

/**
 * `POST /support/tickets/:ticketId/claim` · `support.tickets.assign` ·
 * delegated · **audited**.
 *
 * Take an unassigned ticket for yourself. **Its own route, not `assign` pointed
 * at yourself**: it records a different audit action, takes no target, and above
 * all is open to **every tier** where assignment is not — a Support
 * administrator may claim from the pool but may only ever assign *upward* to
 * tier 2.
 *
 * ⚠ **A claim records no `assignedBy`, and that absence is meaningful** — the
 * tier-2 rule reads `assignedBy.tier` to decide where a ticket may go next.
 *
 * Check `availableActions.claim` before offering the button.
 * `409 TICKET_ALREADY_ASSIGNED` when somebody got there first.
 */
export function claimTicket(ticketId: string, options?: RequestOptions): Promise<unknown> {
    return api.post<unknown>(`${base(ticketId)}/claim`, undefined, options);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * `POST /support/tickets/:ticketId/close` · `support.tickets.lifecycle` ·
 * delegated · **audited**.
 *
 * Body is **empty and strict** — the act is the whole statement.
 *
 * ⚠ Closing sets `terminalAt`, which starts jovi-mall's attachment-cleanup
 * clock, and **a closed ticket refuses new notes** (`409`). Reopen first.
 */
export function closeTicket(ticketId: string, options?: RequestOptions): Promise<unknown> {
    return api.post<unknown>(`${base(ticketId)}/close`, undefined, options);
}

/** `POST /support/tickets/:ticketId/reopen` · `support.tickets.lifecycle` · delegated · **audited**. */
export function reopenTicket(ticketId: string, options?: RequestOptions): Promise<unknown> {
    return api.post<unknown>(`${base(ticketId)}/reopen`, undefined, options);
}

// ─── Followers ────────────────────────────────────────────────────────────────

/**
 * `POST /support/tickets/:ticketId/followers` · `support.tickets.followers.manage` ·
 * delegated · **audited**.
 *
 * ⚠ **Followers are platform actors, never administrators.** The four-value
 * `role` enum is pinned precisely so `admin` is not expressible: an
 * administrator's relationship to a ticket is the assignment, and a private
 * note's visibility list is computed from the follower rows.
 */
export function addTicketFollower(
    ticketId: string,
    body: AddFollowerBody,
    options?: RequestOptions,
): Promise<unknown> {
    return api.post<unknown>(`${base(ticketId)}/followers`, body, options);
}

/** `DELETE /support/tickets/:ticketId/followers/:userId` · delegated · **audited**. */
export function removeTicketFollower(
    ticketId: string,
    userId: string,
    options?: RequestOptions,
): Promise<unknown> {
    return api.delete<unknown>(
        `${base(ticketId)}/followers/${encodeURIComponent(userId)}`,
        undefined,
        options,
    );
}

// ─── Notes ────────────────────────────────────────────────────────────────────

/**
 * `GET /support/tickets/:ticketId/notes` · `support.tickets.notes.read` ·
 * delegated.
 *
 * Scoped first: the ticket is loaded through the caller's scope **before** the
 * delegation, so an out-of-scope ticket is a `404` and no note leaves jovi-mall.
 *
 * **Administrators see all notes on a ticket they may read, private ones
 * included.** Passed through verbatim — author identity resolved, snake_case
 * included — so typed `unknown`.
 */
export function listTicketNotes(ticketId: string, options?: RequestOptions): Promise<unknown> {
    return api.get<unknown>(`${base(ticketId)}/notes`, options);
}

/**
 * `POST /support/tickets/:ticketId/notes` · `support.tickets.notes.write` ·
 * delegated · **audited**.
 *
 * ⚠ **`isPublic` decides whether the CUSTOMER sees this**, and it defaults to
 * `false`. See `CreateNoteBody` for the defect this default exists to prevent —
 * every note this service created was filed **public** until 2026-08-20.
 *
 * ⚠ **A closed ticket refuses notes** with a `409` from jovi-mall. Reopen first.
 *
 * The audit row records `isPublic` and the content **length** — never the text.
 * It is staff commentary on somebody's support case, the note row is itself the
 * durable record, and copying it into the compliance trail would duplicate
 * personal data into a store with a different retention rule.
 */
export function createTicketNote(
    ticketId: string,
    body: CreateNoteBody,
    options?: RequestOptions,
): Promise<unknown> {
    return api.post<unknown>(`${base(ticketId)}/notes`, body, options);
}

// ─── Attachments ──────────────────────────────────────────────────────────────

/**
 * `GET /support/tickets/:ticketId/attachments` · `support.tickets.attachments.read` ·
 * delegated.
 *
 * ⚠ **`url` is minted by jovi-mall's storage provider — do not cache it past its
 * expiry.**
 */
export function listTicketAttachments(
    ticketId: string,
    options?: RequestOptions,
): Promise<TicketAttachment[]> {
    return api.get<TicketAttachment[]>(`${base(ticketId)}/attachments`, options);
}

/**
 * `POST /support/tickets/:ticketId/attachments` · `support.tickets.attachments.write` ·
 * delegated · **audited**.
 *
 * ⚠ **This service accepts no multipart bodies anywhere.** The upload happens
 * against jovi-mall and this attaches the resulting file id.
 */
export function attachFileToTicket(
    ticketId: string,
    body: AttachFileBody,
    options?: RequestOptions,
): Promise<unknown> {
    return api.post<unknown>(`${base(ticketId)}/attachments`, body, options);
}

/**
 * `DELETE /support/tickets/attachments/:attachmentId` ·
 * `support.tickets.attachments.write` · delegated · **audited**.
 *
 * ⚠ **Keyed on the ATTACHMENT, not the ticket** — mirroring jovi-mall's own
 * route shape, because the attachment row is the only thing that names its
 * ticket. So unlike every sibling here the scope cannot be applied first; it has
 * to be *reached*, through three reads in order: resolve the attachment to its
 * ticket, apply the tier scope (`404`), apply the assignment lock (`403`).
 *
 * ⚠ **A `404 TICKET_NOT_FOUND` covers both "no such attachment" and "its ticket
 * is outside your scope"** — identical code, identical message, because two 404s
 * differing only in `error.code` are still an existence oracle.
 *
 * The audit target is the **attachment id** and the row carries no ticket label:
 * it is the one write on this surface whose target cannot be resolved to a
 * ticket without a second read.
 */
export function deleteTicketAttachment(
    attachmentId: string,
    options?: RequestOptions,
): Promise<unknown> {
    return api.delete<unknown>(
        `/support/tickets/attachments/${encodeURIComponent(attachmentId)}`,
        undefined,
        options,
    );
}

// ─── The two reference lookups ────────────────────────────────────────────────

/**
 * `GET /support/tickets/reference/orders` · `support.reference.read` · delegated.
 *
 * ⚠ **Unscoped**, deliberately: delegated as `role: 'admin'`, which jovi-mall
 * treats as an empty filter — every order. That is what a ticket-creation form
 * needs, and it is why the permission is its own rather than
 * `support.tickets.read`: the scope that governs *tickets* does not apply here
 * and would be misleading if it appeared to.
 *
 * `search` is forwarded to jovi-mall as its `q` parameter. That translation is
 * not cosmetic — until Phase 4 step 21 the value went under the wrong name and
 * was **ignored**, so the type-ahead answered the unfiltered first page while
 * looking as though it had searched.
 */
export function lookupTicketOrders(
    search?: string,
    options?: RequestOptions,
): Promise<unknown> {
    return api.get<unknown>(
        withQuery('/support/tickets/reference/orders', { search }),
        options,
    );
}

/** `GET /support/tickets/reference/products` · `support.reference.read` · delegated. */
export function lookupTicketProducts(
    search?: string,
    options?: RequestOptions,
): Promise<unknown> {
    return api.get<unknown>(
        withQuery('/support/tickets/reference/products', { search }),
        options,
    );
}
