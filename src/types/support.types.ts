/**
 * `/support/tickets` — the support queue.
 *
 * Source: `api-doc/admin/api/support.md`. **The only administrative door onto
 * tickets** — jovi-mall's own `/api/admin/tickets` mount was deleted when this
 * one was built, so anything still pointing there is calling a 404.
 *
 * ── Every tier holds every permission here ────────────────────────────────────
 * Support is where a Support-tier administrator works, so the grant matrix is
 * uniform and **the narrowing happens per record** rather than per permission.
 * That is the opposite of `/orders`, where the interventions are withheld from
 * tier 3 by permission — and it is why nothing in this file gates on tier.
 *
 * ── Three layers decide, and they fail differently ────────────────────────────
 * | Layer | Question | A miss answers |
 * |---|---|---|
 * | **Permission** | may you do this kind of thing at all | `403 AUTHZ_PERMISSION_DENIED` |
 * | **Scope** | which tickets are yours to *see* | **`404 TICKET_NOT_FOUND`** |
 * | **Assignment lock** | may you *act* on this one | `403 AUTHZ_PERMISSION_DENIED` |
 *
 * The scope is **a Mongo clause folded into every read, not a check**, so "not
 * yours" and "does not exist" are one answer by construction. A `403` there
 * would confirm the ticket exists, which is exactly what somebody mapping
 * another tier's queue wants to learn.
 *
 * ── ⚠ Do not re-implement the authority table ─────────────────────────────────
 * Every ticket carries **`availableActions`**, derived from the same two
 * functions the service enforces with. Render buttons from that and nothing
 * else — a second copy of the rules is how a dashboard offers a verb the API
 * refuses.
 */

import type { FileDetail } from '@/types/files.types';

// ─── Vocabularies that are NOT ours ───────────────────────────────────────────

/**
 * ⚠ **`status`, `type`, `priority` and `importance` are jovi-mall's, and
 * wi-admin validates them for SHAPE, never for membership** — a 1–60 character
 * token.
 *
 * jovi-mall owns all four and grows them with the product. **An unrecognised
 * value returns an empty page, not a `400`.** Render raw and never `switch`
 * exhaustively — adding an enum member is an additive, non-breaking change
 * upstream, so a closed `switch` here would break on a routine deploy.
 *
 * ── Why this stays a plain string even though the lists are now mirrored ──────
 * The vocabularies below exist, but **the token type does not narrow to them**,
 * and the split is deliberate. See `TICKET_TYPES`.
 */
export type TicketToken = string;

// ─── The mirrored vocabularies ────────────────────────────────────────────────

/**
 * jovi-mall's ticket vocabularies, mirrored.
 *
 * ── Why they are hard-coded rather than fetched ───────────────────────────────
 * **No endpoint should expose these. Not now, not later.** They belong to
 * jovi-mall; a route on wi-admin publishing them would be wi-admin taking
 * ownership of a list it does not own, and a second place for that list to live.
 * So they are mirrored from
 * [`api-doc/jovi-mall/ticket-vocabularies.ts`](../../api-doc/jovi-mall/ticket-vocabularies.ts)
 * — byte-identical to `modules/tickets/types/ticket.types.ts` — and the drift
 * risk is handled by `support-vocabularies.test.ts` rather than by a request.
 *
 * ── ⚠ These are for the CREATION FORM only. Filters stay free-text ───────────
 * That is not an inconsistency, it is the whole design:
 *
 * | | Against a stale list | So |
 * |---|---|---|
 * | **A filter** | matches nothing, *while looking correct* | keep it free-text |
 * | **A create** | is refused with a reason the operator can read | give it a picker |
 *
 * A silently-empty filter is the failure mode jovi-mall's own D-17 warns about,
 * and it is strictly worse than a refusal. So `TicketsList` keeps its typed
 * inputs and only `CreateTicketDialog` gets pickers.
 *
 * ⚠ **The casing is not uniform** — types and entity types are
 * `SCREAMING_SNAKE`, statuses and priorities are `lowercase`. Send them exactly
 * as they appear; jovi-mall compares them literally.
 */
export const TICKET_TYPES = [
    // General support
    'GENERAL_SUPPORT',
    'ACCOUNT_ACCESS',
    'ACCOUNT_VERIFICATION',
    'PROFILE_UPDATE',
    'SECURITY_ISSUE',
    // Orders
    'ORDER_ISSUE',
    'ORDER_CANCELLATION',
    'ORDER_REFUND',
    'ORDER_DISPUTE',
    'ORDER_FULFILLMENT',
    // Payments
    'PAYMENT_ISSUE',
    'PAYMENT_FAILED',
    'PAYMENT_CONFIRMATION',
    'CHARGEBACK',
    'INVOICE_REQUEST',
    // Payouts
    'PAYOUT_REQUEST',
    'PAYOUT_DELAY',
    'PAYOUT_DISPUTE',
    'COMMISSION_QUESTION',
    // Bookings
    'BOOKING_ISSUE',
    'BOOKING_CANCELLATION',
    'BOOKING_RESCHEDULE',
    'AVAILABILITY_PROBLEM',
    // Products
    'PRODUCT_ISSUE',
    'INVENTORY_PROBLEM',
    'PRICING_ISSUE',
    'VARIANT_ISSUE',
    // Shipping and delivery
    'SHIPPING_ISSUE',
    'DELIVERY_DELAY',
    'DELIVERY_CONFIRMATION',
    'ADDRESS_CHANGE',
    // Technical
    'TECHNICAL_ISSUE',
    'BUG_REPORT',
    'INTEGRATION_ISSUE',
    'API_ACCESS',
    // Policy and legal
    'POLICY_QUESTION',
    'COMPLIANCE',
    'LEGAL_REQUEST',
    // Other
    'OTHER',
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** The lifecycle. Five of the nine are "waiting on" a specific party. */
export const TICKET_STATUSES = [
    'open',
    'in_progress',
    'waiting_on_admin',
    'waiting_on_vendor',
    'waiting_on_customer',
    'waiting_on_agency',
    'waiting_on_agent',
    'resolved',
    'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * ⚠ **`resolved` and `closed` are terminal**, and entering one stamps
 * `terminalAt`. jovi-mall's file-cleanup uses that stamp as the grace clock for
 * detaching a ticket's attachments, so a reopen clears it.
 */
export const TERMINAL_TICKET_STATUSES = ['resolved', 'closed'] as const;

/** Operational priority — an administrator's judgement. */
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/**
 * ⚠ **The creator's subjective urgency, and it is IMMUTABLE.** Distinct from
 * `priority` on purpose: importance is what the person opening the ticket
 * thought, priority is what the desk decided. Overwriting the first with the
 * second would destroy the only record of the gap between them.
 *
 * Note the values differ from `priority` — `medium`/`critical`, not
 * `normal`/`urgent`. They are not interchangeable.
 */
export const TICKET_IMPORTANCES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketImportance = (typeof TICKET_IMPORTANCES)[number];

/** What a ticket can be *about*. Polymorphic — `entityId` names the row. */
export const TICKET_ENTITY_TYPES = [
    'ORDER',
    'PRODUCT',
    'BOOKING',
    'SHIPMENT',
    'DELIVERY',
    'USER',
    'VENDOR',
    'CUSTOMER',
    'AGENT',
    'AGENCY',
    'OTHER',
] as const;
export type TicketEntityType = (typeof TICKET_ENTITY_TYPES)[number];

/**
 * ⚠ **`entityId` is required by jovi-mall unless `entityType` is `OTHER`** —
 * and **wi-admin does not enforce it**, so a miss arrives as a
 * `PLATFORM_OPERATION_REJECTED` after the hop rather than as a local `400`.
 * Enforce it client-side.
 */
export const ENTITY_TYPE_WITHOUT_ID = 'OTHER';

/** Every platform actor. **`admin` is here and deliberately not in `FOLLOWER_ROLES`.** */
export const ACTOR_ROLES = ['admin', 'vendor', 'customer', 'agency', 'agent'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/**
 * ⚠ **Pinned, and the pinning is the point: `admin` must not be expressible.**
 *
 * Followers are **platform actors**. An administrator's relationship to a ticket
 * is the *assignment*, and a private note's visibility list is computed from the
 * follower rows — so an administrator appearing as a follower would put staff
 * commentary in front of them through the wrong door.
 */
export const FOLLOWER_ROLES = ['vendor', 'customer', 'agency', 'agent'] as const;
export type FollowerRole = (typeof FOLLOWER_ROLES)[number];

// ─── The administrator snapshot ───────────────────────────────────────────────

/**
 * An administrator, as this surface renders them.
 *
 * ⚠ **`tier` travels here and is dropped everywhere else.** jovi-mall narrows
 * the same stored block through `publicAdminSnapshot()` before a customer,
 * vendor, agency or agent sees it, dropping `id`, `source` and above all `tier`.
 * This is the administrator's own dashboard, so the whole block travels — the
 * tier is what the queue screen groups and filters by, and hiding it would hide
 * the thing the scope rules are about.
 *
 * One stored block, narrowed at one boundary and not at the other. Not two
 * stored blocks that could disagree.
 */
export interface TicketAdminSnapshot {
    id: string;
    name: string | null;
    /** 1 Developer · 2 Admin · 3 Support. **Lower is more privileged.** */
    tier: number;
    jobTitle: string | null;
    department: string | null;
    /**
     * ⚠ **Reserved, and `null` on every response today, for every
     * administrator.** A decision, not a gap: `admin_accounts` stores no avatar
     * and wi-admin has no write-side file surface at all.
     *
     * **Render the initials fallback from `name`, and do not branch on this
     * field.** The day an avatar exists, one line changes server-side and this
     * starts carrying a URL — no wire change, no version bump.
     */
    avatarUrl: string | null;
}

/**
 * ⚠ **`null` means the unassigned pool — a real state, not missing data.**
 *
 * The pool is actionable by **every** tier: that is what makes a queue move, and
 * every system ticket (payout request, dispute, booking refund) starts there.
 */
export interface TicketAssignment {
    admin: TicketAdminSnapshot;
    /**
     * ⚠ **`null` when the ticket was CLAIMED rather than handed over, and that
     * absence is meaningful** — the tier-2 assignment rule reads `assignedBy.tier`
     * to decide where a ticket may go next.
     */
    assignedBy: TicketAdminSnapshot | null;
    assignedAt: string;
}

/**
 * ⚠ **What THIS caller may do**, derived server-side from the same authority
 * table the service enforces with.
 *
 * **Render from this and nothing else.** The assignment rules are genuinely
 * intricate — a tier-2 Admin may assign to tiers 1 and 3, *except* on a ticket a
 * Developer handed them, which may only go to 3 — and a second copy in the
 * dashboard is how a button appears for a verb the API refuses.
 */
export interface TicketAvailableActions {
    /** Whether the claim button should be offered at all. */
    claim: boolean;
    /** Which tiers this caller may hand this ticket to. Empty means nobody. */
    assignableTiers: number[];
}

// ─── The ticket ───────────────────────────────────────────────────────────────

/**
 * What a ticket is **about**, and — on the detail read only — enough to open it.
 *
 * ── ⚠ The list and the detail carry the same KEYS and not the same DATA ──────
 * `vendorId` and `label` are **always `null` on `GET /support/tickets`** and are
 * resolved only by `GET /support/tickets/:ticketId`. They are one shape rather
 * than two because the keys are present on both — a hundred-row page would be a
 * hundred lookups across three collections to decorate a column that shows an
 * id, so the backend resolves at most **one** query, dispatched on the type, and
 * only on the detail.
 *
 * The consequence for this dashboard is concrete and easy to get wrong: **the
 * `about` link belongs on the ticket detail screen and nowhere else.** A queue
 * column built on `label` would render blank on every row, and one built on
 * `vendorId` would drop the product link on every row, and both would look like
 * a bug in the join rather than the documented shape.
 *
 * Granted at [BR-016 § 7](../../api-doc/admin/dashboard/backend-requests/BR-016-names-on-reference-rows.md).
 */
export interface TicketEntityRef {
    /**
     * A 1–60 token. {@link TICKET_ENTITY_TYPES} is jovi-mall's closed eleven and
     * a client may rely on it for **routing**; wi-admin still validates by shape
     * rather than membership, so render an unrecognised token as plain text.
     */
    type: TicketToken;
    id: string | null;
    /**
     * ⚠ **Set for `type: "PRODUCT"` only** — `null` on every other type, which
     * are not products rather than products with an unknown vendor.
     *
     * It is what makes the product link possible at all: a product's detail
     * route is `/vendors/:vendorId/products/:productId` and needs **two** ids
     * where the ticket carries one, and there is no vendor-agnostic product read
     * anywhere on this service.
     *
     * ⚠ `null` on a `PRODUCT` **whose record is gone**, too. The lookup
     * deliberately does not filter `deletedAt`, so a soft-deleted listing still
     * resolves — but a hard-deleted one is served with no link rather than a
     * fabricated one, and a catalogue complaint is exactly the ticket that tends
     * to end in a deletion.
     */
    vendorId: string | null;
    /**
     * Something an operator recognises: the **order number** for `ORDER`, the
     * **tracking number** for `SHIPMENT`, the **title** for `PRODUCT`. `null`
     * for every other type and for a missing record.
     *
     * ⚠ **A convenience, never a substitute for the id.** The contract says so
     * outright, and the reason is that an order number and a tracking number are
     * both searchable strings an operator may need to copy — so the id keeps its
     * own render rather than being replaced by a prettier one.
     */
    label: string | null;
}

export interface Ticket {
    id: string;
    subject: string;
    type: TicketToken;
    status: TicketToken;
    priority: TicketToken;
    /**
     * jovi-mall's own flag: once an administrator sets a priority, the requester
     * can no longer change it. ⚠ **Read this before offering the priority
     * control** — changing it is one-way in effect.
     */
    priorityLocked: boolean;
    importance: TicketToken;
    entity: TicketEntityRef | null;
    trackingNumber: string | null;
    createdBy: {
        role: string;
        userId: string | null;
        /**
         * The **full** admin snapshot when an administrator opened the ticket on
         * somebody's behalf, `null` otherwise.
         */
        administrator: TicketAdminSnapshot | null;
    };
    /**
     * ⚠ **The platform actor the ticket was ROUTED to** — a vendor, agency or
     * agent. **This is not the administrator handling it.** That is `assignment`.
     * Never render one under a heading meant for the other.
     */
    assignedTo: { role: string; userId: string } | null;
    /** `null` is the unassigned pool. */
    assignment: TicketAssignment | null;
    availableActions: TicketAvailableActions;
    /** When the ticket reached a terminal status. Drives jovi-mall's attachment-cleanup clock. */
    terminalAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * `GET /support/tickets/:ticketId` — the list item **plus `description`**.
 * Nothing else differs: same mapper, same projection.
 *
 * `description` is absent from the list deliberately — up to 700 characters of
 * customer free text, a hundred of them per page.
 */
export interface TicketDetail extends Ticket {
    description: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * ⚠ **`all` | `mine` | `unassigned` narrows INSIDE your scope; it can never
 * widen it.** Both are already subsets of every scope this service produces, so
 * the intersection is the point — an Admin asking for `unassigned` and a Support
 * administrator asking for the same get the same pool.
 */
export const TICKET_QUEUES = ['all', 'mine', 'unassigned'] as const;
export type TicketQueue = (typeof TICKET_QUEUES)[number];

/**
 * ⚠ **There is no `assignedTo` parameter.** Whose queue you may read is the
 * scope's decision, and a parameter that could contradict it would be the one
 * place the two disagree. The query schema is non-strict, so sending one is
 * **stripped, not refused** — it does not `400`, and it does not reach the query
 * either.
 */
export interface TicketListQuery {
    /** 1–120. Matches the **subject**; a **24-hex** term is read as a ticket id instead. */
    search?: string;
    status?: TicketToken;
    type?: TicketToken;
    priority?: TicketToken;
    importance?: TicketToken;
    /** `ORDER`, `PRODUCT`, `SHIPMENT`, `OTHER`, … */
    entityType?: TicketToken;
    entityId?: string;
    queue?: TicketQueue;
    /** ISO-8601 instants. **Max span 366 days.** */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: string;
}

/**
 * ⚠ **`assignedAt` is deliberately NOT sortable.** It lives inside the
 * assignment block, which is `null` for every unassigned ticket — and unassigned
 * is not a rare edge here, it is the entire pool. Sorting a list whose commonest
 * state has no value for the sort key puts the queue in an order nobody can
 * predict.
 */
export const TICKET_SORT_KEYS = ['createdAt', 'updatedAt', 'status', 'priority'] as const;
export const TICKET_SORT_DEFAULT = '-createdAt';
export const TICKET_MAX_RANGE_DAYS = 366;

// ─── Write bodies ─────────────────────────────────────────────────────────────

/**
 * ⚠ **The creating administrator is NOT in the body.** It is read from your own
 * `admin_accounts` row and sent to jovi-mall as the snapshot, so "opened by"
 * renders to the customer as a person rather than a placeholder. A
 * client-supplied name would let an administrator record somebody else as
 * handling a ticket; a client-supplied tier would decide who may subsequently
 * see it.
 *
 * ⚠ **The vocabularies are bounded strings here and enums at jovi-mall.** An
 * unknown `type` passes this validator and comes back as a
 * `PLATFORM_OPERATION_REJECTED` naming jovi-mall's code — the D-17 trade, on the
 * grounds that a filter silently matching nothing is worse than a create refused
 * with a reason.
 */
export interface CreateTicketBody {
    /** 1–200. */
    subject: string;
    /** 1–700. */
    description: string;
    type: TicketToken;
    importance: TicketToken;
    entityType: TicketToken;
    /** 1–120. **Required by jovi-mall unless `entityType` is `OTHER`.** */
    entityId?: string;
    trackingNumber?: string;
    /** 24-hex file ids, **max 5**. */
    attachments?: string[];
}

/**
 * ⚠ **At least one field is required.** An empty body is a `400`, not an
 * accepted no-op — a no-op that writes an audit row is a lie in the trail.
 */
export interface UpdateTicketBody {
    subject?: string;
    description?: string;
}

/**
 * ⚠ **A wi-admin `admin_accounts` id — NOT a platform `users` id.**
 *
 * The body names the target and nothing else: who is assigning is the
 * authenticated caller, and the target's **tier is read from their own record**,
 * never from the request. An inactive or unknown administrator answers
 * `404 TICKET_NOT_FOUND` — the same code and message as an out-of-scope ticket,
 * so this endpoint cannot be used to enumerate administrator ids.
 */
export interface AssignTicketBody {
    administratorId: string;
}

export interface AddFollowerBody {
    /** A platform `users` id, 24-hex. */
    userId: string;
    role: FollowerRole;
}

/**
 * ⚠ **`isPublic` is the customer-visibility switch, and `false` is the safe
 * default.**
 *
 * `false` files the note **private**: the author, every administrator following
 * the ticket, and nobody else. `true` shows it to every follower — **which means
 * the customer**. The default is the safety property: these are staff notes on
 * somebody's support case, and the failure direction of a missing flag must be
 * "the customer does not see it".
 *
 * ⚠ **This was not true before 2026-08-20.** jovi-mall names the field
 * `visibility` (`'public' | 'private'`, defaulting to **public**) and its schema
 * is non-strict, so `isPublic` was *stripped in transit* and **every note this
 * service created was filed public** — a `201`, no warning, the customer reading
 * staff commentary. Fixed by translating at the gateway; the wire name stays
 * `isPublic` because a boolean is the right shape for one choice.
 */
export interface CreateNoteBody {
    /** 1–**300**. jovi-mall's own limit, mirrored so the refusal is a local `400`. */
    content: string;
    /** Defaults to `false` — private. */
    isPublic?: boolean;
}

/** jovi-mall's own limit on a note. */
export const NOTE_MAX_LENGTH = 300;
export const TICKET_SUBJECT_MAX = 200;
export const TICKET_DESCRIPTION_MAX = 700;
/** Max file ids on a create. */
export const TICKET_ATTACHMENT_MAX = 5;

/**
 * ⚠ **This service accepts no multipart bodies anywhere.** The upload happens
 * against jovi-mall and this attaches the resulting id.
 */
export interface AttachFileBody {
    fileId: string;
}

// ─── Attachments ──────────────────────────────────────────────────────────────

/**
 * jovi-mall's attachment row — passed through, plus one field wi-admin adds.
 *
 * ⚠ **It stopped being verbatim on 2026-08-26**, and the exception is the whole
 * reason this row is usable: `fileId` is **not** in jovi-mall's payload.
 * wi-admin reads it off the attachment record in the shared database and stamps
 * it onto each row, because a plain reference needs none of the machinery `url`
 * needs (ADR-018 D-4 — delegate the projection that needs jovi-mall, read the
 * record directly). Everything else here is still jovi-mall's own shape,
 * `uploadedByActor`'s snake_case included.
 *
 * 🔴 **`url` NEVER EXPIRES, and this file said the opposite until 2026-08-24.**
 *
 * It read *"do not cache it past its expiry"* — copied in good faith from
 * `support.md`, which asserted the same thing. The backend checked the source at
 * BR-012 and the page was wrong **in the reassuring direction**: the value is
 * `storage.getPublicUrl(key)` — a permanent, unauthenticated public URL, no
 * signature, no expiry, no session needed. The wording invited a reader to treat
 * the link as self-limiting when nothing limits it.
 *
 * Attachments land in `documents/` or `images/`, both **public** trees, so
 * unlike a delivery proof they resolve with a real working URL. That is a
 * property of how they are stored rather than a decision made about them:
 * `storage/ticket-attachments/` is classified private but nothing writes it.
 *
 * ⚠ **Treat an attachment URL as a shareable secret.** Anyone it reaches can
 * fetch the file, indefinitely, for as long as the file exists — so do not paste
 * one into a channel that outlives the ticket. There is nothing to refetch on a
 * timer and no reason to decline to persist it; both would be wrong.
 *
 * ⚠ **This row is NOT a `FileDetail`.** It is the attachment row's own shape:
 * `url` is a plain `string` and there is no `access` field. Do not type it as
 * one. A `FileDetail` resolved from the same underlying file would report
 * `access: "public"` and the same URL.
 */
export interface TicketAttachment {
    /**
     * ⚠ **The ATTACHMENT's id, and not the file's.** It is what the delete route
     * takes; it resolves to nothing in `/files`. See `fileId`.
     */
    id: string;
    /**
     * The jovi-mall **File** behind this attachment — the same id `POST` takes,
     * and the only thing on this row that addresses the file itself.
     *
     * ⚠ **`id` and `fileId` are both 24-hex and sit on the same object**, so
     * confusing them is a one-character mistake that resolves the wrong record.
     * The delete takes `id`; everything in `/files` takes `fileId`.
     *
     * `null` only in a race — the attachment was deleted between jovi-mall
     * answering and wi-admin reading the row. **The key is always present**, so
     * read it unconditionally rather than guarding on its existence.
     *
     * ⚠ **Not stamped on the `POST` response**, deliberately: you already hold
     * it there, because it is what you sent.
     */
    fileId: string | null;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    url: string | null;
    /** The uploader's id. Same value as `uploadedByActor.user_id`. */
    uploadedBy: string | null;
    /** The uploader's role. Same value as `uploadedByActor.role`. */
    uploadedByRole: string | null;
    /**
     * The uploader as a person. `null` is "unknown", never an error.
     *
     * ⚠ **Read `.user_id`, not `.userId`** — see `TicketActorSummary`, and read
     * its placeholder note before rendering `.name`.
     */
    uploadedByActor: TicketActorSummary | null;
    createdAt: string;
}

/**
 * jovi-mall's resolved actor summary — the uploader of an attachment, and the
 * author of a note.
 *
 * ⚠ **This is snake_case inside, unlike every ticket field around it**, and the
 * reason is worth knowing rather than working around: the ticket rows on this
 * surface are *wi-admin's* projection (`createdBy.userId`), while the attachment
 * list is jovi-mall's own payload passed through, and its inner objects were
 * never renamed.
 *
 * ⚠ **Not `ActorStamp`.** That is wi-admin's actor shape, from a different
 * service, with different fields and different nullability. Two services'
 * records of "who did this"; do not unify them.
 *
 * ── 🔴 `name` is a PLACEHOLDER more often than it looks ──────────────────────
 * For `role: "admin"` it is the literal string `"Admin"` — never the
 * administrator's name, and that is exactly the case a dashboard most wants.
 * An administrator has no `users` row and no `admins` row in `jovi_mall`
 * (ADR-004 D-1, the synthetic actor): the id jovi-mall stores is the
 * `X-Actor-Id` wi-admin sent, an `admin_accounts._id` out of *wi-admin's* own
 * database. jovi-mall looks it up in its own `admins` collection, matches
 * nothing, and falls back to the capitalised role.
 *
 * The same fallback yields `"Customer"` / `"Vendor"` / `"Agency"` / `"Agent"`
 * for a **deleted profile**. So **a `name` equal to the capitalised `role` is
 * the signal that nothing resolved, and it is the only signal there is** —
 * `avatar` is `null` in that case too. Use `isRolePlaceholderName` from
 * `lib/party.ts`; never render `name` raw.
 */
export interface TicketActorSummary {
    /**
     * ⚠ **Snake_case, and it is not always a `users._id`.** For every role but
     * `admin` it is one, and routes to `/users/:userId` behind `users.read`.
     * For `admin` it is an `admin_accounts._id` — a different database — and
     * routes to `/administrators/:adminId` behind `administrators.read`, which
     * **Support does not hold**.
     */
    user_id: string;
    role: TicketActorRole;
    /** ⚠ Read the placeholder note above before rendering this. */
    name: string;
    /**
     * Their picture, or the business's logo. A full `FileDetail`, so its own
     * `url` may be `null` on a private tree — check `isDisplayableImage` before
     * building an `<img>` around it.
     */
    avatar: FileDetail | null;
}

/**
 * Who uploaded or wrote it.
 *
 * `string`-widened like every enum on this client: adding a member upstream is
 * an additive, non-breaking change, so a closed `switch` would break on a
 * routine deploy. ⚠ **`admin` is the odd one** — it names an actor in a
 * different database from the other four.
 */
export type TicketActorRole =
    | 'customer'
    | 'vendor'
    | 'agency'
    | 'agent'
    | 'admin'
    | (string & {});

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * 404. ⚠ **"No such ticket" and "outside your scope" are one answer by design**,
 * and so is "no active administrator with that id" on `/assign` and "no such
 * attachment" on the attachment delete. Two 404s differing only in `error.code`
 * would still be an existence oracle.
 */
export const CODE_TICKET_NOT_FOUND = 'TICKET_NOT_FOUND';

/** 409 — somebody already holds it. Check `availableActions.claim` first. */
export const CODE_TICKET_ALREADY_ASSIGNED = 'TICKET_ALREADY_ASSIGNED';
