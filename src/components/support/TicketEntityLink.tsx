import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { NotSet } from '@/components/common/DefinitionList';
import { humaniseEnum } from '@/lib/format';
import { accountSearchPath } from '@/lib/id-search';
import { useCan } from '@/store';
import type { RoutedPermissionName } from '@/types/permissions.types';
import type { TicketEntityRef } from '@/types/support.types';

/**
 * What the ticket is about, opened where this dashboard can open it.
 *
 * The sibling of `AuditTargetLink` and deliberately built the same way: a
 * vocabulary this client does not own, a table from token to route, a permission
 * per destination, and plain text wherever there is no screen. Sharing one
 * component between the two was considered and rejected — the vocabularies are
 * different sizes from different services, and the audit row carries a `label`
 * on every type where a ticket carries one on three.
 *
 * ── ⚠ Eight of eleven link, and the three that do not are DIFFERENT facts ─────
 * `BOOKING` and `DELIVERY` have no administrative surface on this service at
 * all. `OTHER` names nothing by definition — it is the one type jovi-mall lets
 * `entityId` be omitted for. And `CUSTOMER` links, but not like the rest: see
 * below.
 *
 * ── ⚠ `CUSTOMER` opens a SEARCH, never a record ───────────────────────────────
 * Three states, and the history is why the third is shaped as it is.
 * `support.md` first put `CUSTOMER` in the ✅ row beside `VENDOR`, `AGENT`,
 * `AGENCY` and `USER`; this component refused to follow it and the backend
 * corrected the page to ❌ on 2026-08-26. Since **2026-10-12 (BR-028 § 1)** the
 * row reads *"by search, not by link"*.
 *
 * What has not changed: there is no `/customers` module here and no route group
 * on the service, and a customer id is a `customers._id`, **not** a `users._id`
 * — so `/dashboard/users/<customerId>` is still a `404` on every ticket while
 * looking like a working link. **Do not route it there.**
 *
 * What changed: `GET /users?search=<24hex>` now tries the term as a user id
 * **and** as a customer, vendor, agency or agent id, and answers with the
 * account that owns it. That suits this case exactly, because of the second
 * problem — ⚠ **nothing guarantees which of the two ids a ticket even
 * carries.** jovi-mall resolves `entityId` for `ORDER`, `BOOKING` and `PRODUCT`
 * only; every other type is stored unread after an ObjectId *shape* check. The
 * search does not need to know: it tries both, and an id that is neither
 * returns an empty page, which is the honest answer.
 *
 * So `CUSTOMER` goes to `accountSearchPath()` — a list of one row, or none.
 * ⚠ Against a wi-admin older than BR-028 that list is empty for a customer id.
 *
 * ── A link is also a permission claim ─────────────────────────────────────────
 * Each destination is gated on what its module actually requires and degrades to
 * plain text without it. The id still shows: it is already in the row the
 * operator is reading, and only the navigation is withheld.
 */

interface EntityRoute {
    /**
     * `undefined` when this particular row cannot be addressed even though its
     * type can be — a `PRODUCT` whose `vendorId` did not resolve is the only
     * case, and it is an ordinary one rather than a fault.
     */
    path: (entity: TicketEntityRef, id: string) => string | undefined;
    /** What the destination module requires. */
    permission: RoutedPermissionName;
}

/**
 * `entity.type` → where that record lives.
 *
 * Paths verified against each module's own `<Routes>` rather than guessed. Keyed
 * on jovi-mall's `SCREAMING_SNAKE` tokens, which is the casing the wire uses —
 * ⚠ **the casing is not uniform on this surface**: types and entity types are
 * upper, statuses and priorities are lower.
 */
const ENTITY_ROUTES: Record<string, EntityRoute> = {
    ORDER: { path: (_, id) => `/dashboard/orders/${id}`, permission: 'orders.read' },
    SHIPMENT: { path: (_, id) => `/dashboard/shipments/${id}`, permission: 'shipments.read' },
    PRODUCT: {
        // ⚠ The two-id path, and the whole reason BR-016 § 7 was raised. No
        // `vendorId` means no address — not a broken link and not a guess.
        path: (entity, id) =>
            entity.vendorId
                ? `/dashboard/vendors/${encodeURIComponent(entity.vendorId)}/products/${id}`
                : undefined,
        permission: 'vendors.read',
    },
    VENDOR: { path: (_, id) => `/dashboard/vendors/${id}`, permission: 'vendors.read' },
    AGENCY: { path: (_, id) => `/dashboard/agencies/${id}`, permission: 'agencies.read' },
    AGENT: { path: (_, id) => `/dashboard/agents/${id}`, permission: 'agents.read' },
    USER: { path: (_, id) => `/dashboard/users/${id}`, permission: 'users.read' },
    // ⚠ The search, not the record — see the note above. `entity.id` rather than
    // the pre-encoded `id`: `accountSearchPath` encodes for a query string itself.
    CUSTOMER: { path: (entity) => accountSearchPath(entity.id ?? ''), permission: 'users.read' },
};

export function TicketEntityLink({ entity }: { entity: TicketEntityRef | null }) {
    const can = useCan();

    if (!entity) return <NotSet>This ticket is not about a specific record</NotSet>;

    const typeLabel = humaniseEnum(entity.type) ?? entity.type;

    /*
      ⚠ `OTHER` with no id is the documented shape, not missing data: jovi-mall
      requires `entityId` for every type except that one. Rendering `<NotSet />`
      here would file a deliberate answer under "not recorded".
    */
    if (!entity.id) {
        return (
            <div className="min-w-0">
                <p className="font-medium">{typeLabel}</p>
                <p className="text-muted-foreground text-xs">
                    Nothing in particular — this type names no record.
                </p>
            </div>
        );
    }

    const route = ENTITY_ROUTES[entity.type];
    // Resolved once. Both branches below ask the same question, and a second
    // lookup could answer it differently from this one.
    const href =
        route && can(route.permission)
            ? route.path(entity, encodeURIComponent(entity.id))
            : undefined;

    return (
        <div className="min-w-0 space-y-0.5">
            {/*
              No label, so the slot *is* the id — a value, and it keeps whatever
              navigation it had. `to` leaves the copy button a button rather than
              wrapping it in the link.
            */}
            {entity.label ? (
                href ? (
                    <Link to={href} className="font-medium break-words hover:underline">
                        {entity.label}
                    </Link>
                ) : (
                    <span className="font-medium break-words">{entity.label}</span>
                )
            ) : (
                <CopyableValue
                    variant="id"
                    value={entity.id}
                    label={`${typeLabel.toLowerCase()} ID`}
                    truncate={false}
                    to={href}
                    className="font-medium"
                />
            )}

            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                {/* The raw type, humanised — an unrecognised one renders as
                    itself rather than being swallowed. The vocabulary is closed
                    at jovi-mall and validated by shape here, so a twelfth value
                    would be a wire change, not a rendering bug. */}
                <span>{typeLabel}</span>
                {/*
                  ⚠ The id keeps its own render even when a label is shown. An
                  order number and a tracking number are both searchable strings
                  an operator copies, and the contract is explicit that the label
                  is "never a substitute for the id".
                */}
                {entity.label ? (
                    <CopyableValue
                        variant="id"
                        value={entity.id}
                        label={`${typeLabel.toLowerCase()} ID`}
                        // Whole, like the no-label branch above. This sits in a
                        // definition-list cell with room for it, and the id is
                        // what gets pasted into a search box — the head-and-tail
                        // form is for the dense tables, not for one value here.
                        truncate={false}
                    />
                ) : null}
            </p>
        </div>
    );
}
