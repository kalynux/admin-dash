import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { useCan } from '@/store';
import type { RoutedPermissionName } from '@/types/permissions.types';
import { humaniseEnum } from '@/lib/format';

/**
 * The record an audit row is about, linked where the dashboard can show it.
 *
 * ── Not every target has a screen ─────────────────────────────────────────────
 * Twenty-two `targetType` values exist; fourteen have a detail route in this
 * dashboard. The rest name records this client cannot open — `customer`,
 * `ticket` and `article` belong to surfaces the backend has **zero endpoints
 * for**; `admin_session`, `feature_flag`, `worker` and `maintenance_window` are
 * real but have no per-record screen; and `none` is a genuine member meaning the
 * action concerned no record at all. Those render as text, which is honest: a
 * link to a route that 404s is worse than no link.
 *
 * ── A link is also a permission claim ─────────────────────────────────────────
 * Each destination is gated on the permission its module actually requires, and
 * the link degrades to plain text without it. Otherwise the audit trail would be
 * full of links that land a Support administrator on a refusal — and, worse, the
 * *set* of things they could not open would itself describe the directory
 * `audit.read`'s row scope exists to withhold. The id still shows; only the
 * navigation is withheld, because the id is already in the row they are reading.
 *
 * ── Where the copy affordance lives, and why it lives here ────────────────────
 * The main line is a **name slot**: `label` when the row carries one, and the
 * raw id when it does not. Falling through to the id turns that slot into a
 * value — the only render of it on the trail table, and the only one anywhere
 * for a `relatedTarget` — so the affordance belongs to this component rather
 * than to each of the three call sites, which cannot see which branch ran.
 *
 * ⚠ It shortens, unlike most of this sweep. The slot sits in a table cell with
 * no `break-words` above it, so an un-shortened 24-hex id overflows the column
 * rather than wrapping; the whole value stays in the `title` and is what gets
 * copied. Where a name *is* present the id is a `showId` echo under it, and the
 * caller that asks for that echo renders the same id in full beside it — a
 * second copy button there would be two buttons for one value.
 */

interface TargetRoute {
    /** `:id` is substituted with the encoded target id. */
    path: (id: string) => string;
    /** What the destination module requires. */
    permission: RoutedPermissionName;
}

/**
 * `targetType` → where that record lives.
 *
 * Paths verified against each module's own `<Routes>` rather than guessed —
 * payouts sit under `money/`, the three COD records under `cod/`, and a plan is
 * `billing/:planId` with no `plans` segment.
 */
const TARGET_ROUTES: Record<string, TargetRoute> = {
    user: { path: (id) => `/dashboard/users/${id}`, permission: 'users.read' },
    vendor: { path: (id) => `/dashboard/vendors/${id}`, permission: 'vendors.read' },
    agency: { path: (id) => `/dashboard/agencies/${id}`, permission: 'agencies.read' },
    agent: { path: (id) => `/dashboard/agents/${id}`, permission: 'agents.read' },
    order: { path: (id) => `/dashboard/orders/${id}`, permission: 'orders.read' },
    shipment: { path: (id) => `/dashboard/shipments/${id}`, permission: 'shipments.read' },
    payout: { path: (id) => `/dashboard/money/payouts/${id}`, permission: 'money.payouts.read' },
    plan: { path: (id) => `/dashboard/billing/${id}`, permission: 'billing.plans.read' },
    remittance: {
        path: (id) => `/dashboard/cod/remittances/${id}`,
        permission: 'cod.remittances.read',
    },
    deposit: { path: (id) => `/dashboard/cod/deposits/${id}`, permission: 'cod.deposits.read' },
    discrepancy: {
        path: (id) => `/dashboard/cod/discrepancies/${id}`,
        permission: 'cod.discrepancies.read',
    },
    administrator: {
        path: (id) => `/dashboard/administrators/${id}`,
        permission: 'administrators.read',
    },
    approval_request: {
        path: (id) => `/dashboard/approvals/${id}`,
        permission: 'approvals.read',
    },
    audit_export: {
        path: (id) => `/dashboard/audit/exports/${id}`,
        permission: 'audit.export',
    },
};

interface AuditTargetLinkProps {
    type: string | null;
    id: string | null;
    /** A human name for the record, when the row carries one. */
    label?: string | null;
    /** Show the raw id under the label. The detail screen does; the table does not. */
    showId?: boolean;
}

export function AuditTargetLink({ type, id, label, showId }: AuditTargetLinkProps) {
    const can = useCan();

    // `none` is a real target type, not a missing one: the action concerned no
    // record. Saying "—" would read as data we failed to load.
    if (!type || type === 'none') {
        return <span className="text-muted-foreground">No record</span>;
    }

    const route = id ? TARGET_ROUTES[type] : undefined;
    const text = label ?? id ?? type;
    // Resolved once. Both branches below ask the same question, and a second
    // lookup could answer it differently from this one.
    const href =
        id && route && can(route.permission) ? route.path(encodeURIComponent(id)) : undefined;

    return (
        <div className="min-w-0">
            {/* No name, so the slot *is* the id — a value, and it keeps whatever
                navigation it had. `to` leaves the copy button a button. */}
            {id && !label ? (
                <CopyableValue value={id} label="record ID" to={href} className="font-medium" />
            ) : href ? (
                <Link to={href} className="font-medium break-all hover:underline">
                    {text}
                </Link>
            ) : (
                <span className="font-medium break-all">{text}</span>
            )}

            <p className="text-muted-foreground text-xs">
                {/* The raw type, always — an unknown one renders as itself rather
                    than being swallowed, because a new member is an additive change. */}
                {humaniseEnum(type) ?? '—'}
                {showId && id && label ? <span className="font-mono"> · {id}</span> : null}
            </p>
        </div>
    );
}
