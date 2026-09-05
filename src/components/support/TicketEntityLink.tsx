import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { NotSet } from '@/components/common/DefinitionList';
import { humaniseEnum } from '@/lib/format';
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
 * ── ⚠ Seven of eleven link, and the four that do not are four DIFFERENT facts ─
 * `BOOKING` and `DELIVERY` have no administrative surface on this service at
 * all. `OTHER` names nothing by definition — it is the one type jovi-mall lets
 * `entityId` be omitted for. And `CUSTOMER` is the interesting one: see below.
 *
 * ── ⚠ `CUSTOMER` does not route, and the reason outlived the disagreement ─────
 * `support.md`'s routability table put `CUSTOMER` in the ✅ row — *"each maps to
 * a directory, the id is the parameter"* — alongside `VENDOR`, `AGENT`,
 * `AGENCY` and `USER`. This component refused to follow it, and **the backend
 * agreed and corrected the page on 2026-08-26**; the row now reads ❌ and
 * carries the reasoning, and the same claim was corrected in their source where
 * it would otherwise have re-propagated. So this is no longer a disagreement —
 * it is the contract, and the note stays because the *reason* is what stops it
 * being re-derived:
 *
 * There is no `/customers` module here and no `/customers` route group on the
 * service (the permission family was deleted upstream at the 2026-08-24 resync).
 * A customer id is a `customers._id` and **not** a `users._id` — different
 * collections, and `GET /users/:userId` keys on the second — so routing it into
 * the user directory returns an empty page rather than an error, on every
 * ticket, while looking like a working link.
 *
 * ⚠ **And nothing guarantees which of the two a ticket even carries.** jovi-mall
 * resolves `entityId` for `ORDER`, `BOOKING` and `PRODUCT` only; every other
 * type falls through its validator's default branch after an ObjectId *shape*
 * check and is stored unread. So a customer screen would still not make this id
 * safe to route. `createdBy.userId` and the ticket's `ORDER` / `SHIPMENT` are
 * the destinations that usually are what the operator wanted.
 *
 * A link that can never resolve is worse than no link, so `CUSTOMER` renders as
 * a copyable id.
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
