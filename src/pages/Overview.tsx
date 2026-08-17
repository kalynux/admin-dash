import type { ReactNode } from 'react';
import {
    Building2,
    PackageSearch,
    RotateCw,
    ShoppingCart,
    Store,
    Truck,
    Users,
} from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { PageContainer } from '@/components/layout/PageContainer';
import { ActivityFeedTile, OwnActivityTile } from '@/components/overview/ActivityFeedTile';
import { ApprovalsTile } from '@/components/overview/ApprovalsTile';
import { CodPositionTile } from '@/components/overview/CodPositionTile';
import { CountTile } from '@/components/overview/CountTile';
import { MaintenanceBanner } from '@/components/overview/MaintenanceBanner';
import { ModuleGrid } from '@/components/overview/ModuleGrid';
import { NotificationsTile } from '@/components/overview/NotificationsTile';
import { OutboxTile } from '@/components/overview/OutboxTile';
import { PlatformEarningsTile } from '@/components/overview/PlatformEarningsTile';
import { ReadinessTile, SystemStatusTile } from '@/components/overview/SystemStatusTile';
import { Button } from '@/components/ui/button';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import {
    calendarDayInZone,
    dayRangeToInstants,
    resolveTimeZone,
    type InstantRange,
} from '@/lib/datetime';
import {
    countAgencies,
    countAgents,
    countDisputedOrders,
    countHeldShipments,
    countOrdersCreated,
    countShipmentsCreated,
    countUnassignedShipments,
    countUsers,
    countVendors,
} from '@/services/counts';
import { useAuth, useCan } from '@/store';
import type { CanPredicate } from '@/store';
import type { RoutedPermissionName } from '@/types/permissions.types';

/**
 * One tile on the overview.
 *
 * `permission` is what makes the tile exist at all. A tile the caller does not
 * hold is **never rendered**, and therefore never fires its request — capability
 * on this dashboard is read from `GET /permissions/me`, never discovered by
 * collecting 403s. Typed `RoutedPermissionName`, so naming one of the twenty-
 * eight catalogued-but-unrouted permissions here does not compile.
 *
 * A tile with no `permission` is one every administrator may see. Two of them
 * choose their own source from `can` instead, because the *tile* is universal
 * even though the better of its two endpoints is not.
 */
interface OverviewTile {
    id: string;
    permission?: RoutedPermissionName;
    render: (can: CanPredicate) => ReactNode;
}

/**
 * One scale for every section of stat tiles.
 *
 * Each section used to declare its own (`xl:grid-cols-5`, `lg:grid-cols-4`,
 * `sm:grid-cols-2`, `lg:grid-cols-3`), so the same visual object appeared at four
 * different widths as you read down one page. A tile is now the same size
 * wherever it sits, which is what makes the page scan as a grid rather than as
 * four unrelated bands.
 *
 * The composite tiles keep their own, wider scale — see `WIDE_COLUMNS`.
 */
const STAT_COLUMNS = 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/**
 * The platform row, whose three tiles are lists and definition blocks rather
 * than a number and a hint. They need the width; squeezing them into the stat
 * scale would wrap every row of every one of them.
 */
const WIDE_COLUMNS = 'sm:grid-cols-2 lg:grid-cols-3';

interface OverviewSection {
    id: string;
    label: string;
    /** Column count for this row's grid. `STAT_COLUMNS` unless the tiles are composite. */
    columns: string;
    tiles: OverviewTile[];
}

/**
 * The overview, as data.
 *
 * A registry rather than sixteen `<Can>` wrappers in the JSX, for one reason
 * that markup cannot express: **a section whose every tile is hidden must not
 * render its heading**. `<Can>` with no fallback renders nothing, which would
 * leave a Support administrator looking at the word "Money" over empty space.
 * This is the same move `permittedSections` already makes for the sidebar.
 *
 * It is also the one object a test can assert the whole gating story against.
 */
function buildSections(refreshToken: number, timeZone: string, today: InstantRange): OverviewSection[] {
    return [
        {
            id: 'attention',
            label: 'Needs attention',
            columns: STAT_COLUMNS,
            tiles: [
                {
                    id: 'unread',
                    permission: 'notifications.read',
                    render: () => <NotificationsTile refreshToken={refreshToken} />,
                },
                {
                    id: 'approvals',
                    permission: 'approvals.read',
                    render: () => <ApprovalsTile refreshToken={refreshToken} />,
                },
                {
                    id: 'disputes',
                    permission: 'orders.disputes.read',
                    render: () => (
                        <CountTile
                            title="Orders in dispute"
                            icon={ShoppingCart}
                            to="/dashboard/orders/disputes"
                            hint="Open disputes across the platform"
                            tone="attention"
                            cacheKey="/orders/disputes"
                            refreshToken={refreshToken}
                            read={countDisputedOrders}
                        />
                    ),
                },
                {
                    id: 'unassigned',
                    permission: 'shipments.read',
                    render: () => (
                        <CountTile
                            title="Unassigned shipments"
                            icon={PackageSearch}
                            to="/dashboard/shipments"
                            hint="No agent bound yet — on offer, or never offered"
                            tone="attention"
                            cacheKey="/shipments?unassigned=true"
                            refreshToken={refreshToken}
                            read={countUnassignedShipments}
                        />
                    ),
                },
                {
                    id: 'held',
                    permission: 'shipments.read',
                    render: () => (
                        <CountTile
                            title="Held shipments"
                            icon={PackageSearch}
                            to="/dashboard/shipments"
                            hint="Frozen by the agency-deactivation cascade"
                            tone="attention"
                            cacheKey="/shipments?held=true"
                            refreshToken={refreshToken}
                            read={countHeldShipments}
                        />
                    ),
                },
            ],
        },
        {
            id: 'directories',
            label: 'Directories',
            columns: STAT_COLUMNS,
            tiles: [
                {
                    id: 'users',
                    permission: 'users.read',
                    render: () => (
                        <CountTile
                            title="Users"
                            icon={Users}
                            to="/dashboard/users"
                            hint="Sign-in identities across every role"
                            cacheKey="/users"
                            refreshToken={refreshToken}
                            read={countUsers}
                        />
                    ),
                },
                {
                    id: 'vendors',
                    permission: 'vendors.read',
                    render: () => (
                        <CountTile
                            title="Vendors"
                            icon={Store}
                            to="/dashboard/vendors"
                            // Every tile in this row carries a hint, or the ones
                            // without run a line shorter than their neighbours.
                            hint="Selling accounts, whatever their KYC state"
                            cacheKey="/vendors"
                            refreshToken={refreshToken}
                            read={countVendors}
                        />
                    ),
                },
                {
                    id: 'agencies',
                    permission: 'agencies.read',
                    render: () => (
                        <CountTile
                            title="Agencies"
                            icon={Building2}
                            to="/dashboard/agencies"
                            hint="Delivery agencies — never deleted, only deactivated"
                            cacheKey="/agencies"
                            refreshToken={refreshToken}
                            read={countAgencies}
                        />
                    ),
                },
                {
                    id: 'agents',
                    permission: 'agents.read',
                    render: () => (
                        <CountTile
                            title="Agents"
                            icon={Truck}
                            to="/dashboard/agents"
                            hint="Platform identities, not agency-owned rows"
                            cacheKey="/agents"
                            refreshToken={refreshToken}
                            read={countAgents}
                        />
                    ),
                },
            ],
        },
        {
            id: 'today',
            label: 'Today',
            columns: STAT_COLUMNS,
            tiles: [
                {
                    id: 'orders-today',
                    permission: 'orders.read',
                    render: () => (
                        <CountTile
                            title="Orders today"
                            icon={ShoppingCart}
                            to="/dashboard/orders"
                            hint="Created today, in your timezone"
                            cacheKey={`/orders?from=${today.from}&to=${today.to}`}
                            refreshToken={refreshToken}
                            read={(options) => countOrdersCreated(today, options)}
                        />
                    ),
                },
                {
                    id: 'shipments-today',
                    permission: 'shipments.read',
                    render: () => (
                        <CountTile
                            title="Shipments today"
                            icon={PackageSearch}
                            to="/dashboard/shipments"
                            hint="Created today, in your timezone"
                            cacheKey={`/shipments?from=${today.from}&to=${today.to}`}
                            refreshToken={refreshToken}
                            read={(options) => countShipmentsCreated(today, options)}
                        />
                    ),
                },
            ],
        },
        {
            id: 'money',
            label: 'Money',
            columns: STAT_COLUMNS,
            tiles: [
                {
                    id: 'cod',
                    permission: 'cod.overview.read',
                    render: () => <CodPositionTile refreshToken={refreshToken} />,
                },
                {
                    id: 'earnings',
                    permission: 'money.earnings.read',
                    render: () => <PlatformEarningsTile refreshToken={refreshToken} />,
                },
            ],
        },
        {
            id: 'platform',
            label: 'Platform',
            columns: WIDE_COLUMNS,
            tiles: [
                {
                    // No permission: every tier gets a system tile. The richer
                    // authenticated read needs `system.health.read`; the
                    // unversioned readiness probe needs nothing at all, and is
                    // what a Support administrator sees.
                    id: 'system',
                    render: (can) =>
                        can('system.health.read') ? (
                            <SystemStatusTile refreshToken={refreshToken} />
                        ) : (
                            <ReadinessTile refreshToken={refreshToken} />
                        ),
                },
                {
                    id: 'outbox',
                    permission: 'system.outbox.read',
                    render: () => <OutboxTile refreshToken={refreshToken} />,
                },
                {
                    // No permission either: `GET /administrators/me/activity`
                    // carries none, because an audit trail people cannot see
                    // their own entry in is one they cannot challenge.
                    id: 'activity',
                    render: (can) =>
                        can('audit.read') ? (
                            <ActivityFeedTile refreshToken={refreshToken} timeZone={timeZone} />
                        ) : (
                            <OwnActivityTile refreshToken={refreshToken} timeZone={timeZone} />
                        ),
                },
            ],
        },
    ];
}

/**
 * The dashboard home.
 *
 * **wi-admin has no aggregate, summary, KPI or stats endpoint** — not one, in
 * any of its eighteen route groups. That is verified in the api bundle, recorded
 * as gap D1 in `docs/dashboard/BACKEND-INTEGRATION-MATRIX.md`, and confirmed
 * against the service's own route table. So this page is composed, and the rule
 * every figure on it obeys is:
 *
 * > it is either a field the backend returned, or a `meta.total` the backend
 * > computed for a documented filter.
 *
 * Nothing is summed, divided, averaged or derived in the browser, and where the
 * service has no number there is no tile — the gap is recorded as a backend
 * dependency instead of being filled in with something plausible.
 *
 * **Sixteen tiles, sixteen independent reads, sixteen independent failures.**
 * Three of them are delegated to jovi-mall and can answer `502` while the rest
 * of the page is fine, which is why every tile owns its loading, error and empty
 * state rather than the page owning one of each.
 *
 * A Support administrator sees twelve of the sixteen. The Phase-0 matrix
 * predicted they would see one, which was true of the six-tile design it was
 * written against; reading `meta.total` off the directories they *can* read is
 * what changed it.
 */
export function Overview() {
    const can = useCan();
    const { admin } = useAuth();
    const { token, refresh } = useRefreshToken();

    /**
     * Today, in the operator's own day.
     *
     * The contract refuses date-only values — `2026-08-14` is not an instant —
     * so the client resolves the day against `admin.timezone` and sends ISO
     * instants. Resolving it against the *browser's* zone instead would silently
     * shift the count by hours for anyone travelling, or for a machine set to
     * UTC. `resolveTimeZone` falls back to the browser only when the profile
     * names no zone at all.
     */
    const timeZone = resolveTimeZone(admin?.timezone);
    const day = calendarDayInZone(new Date(), timeZone);
    const today = dayRangeToInstants(day, day, timeZone);

    const sections = buildSections(token, timeZone, today)
        .map((section) => ({
            ...section,
            tiles: section.tiles.filter((tile) => !tile.permission || can(tile.permission)),
        }))
        // A heading over nothing is worse than no heading. Support holds neither
        // money permission, so that whole row is absent for them by design.
        .filter((section) => section.tiles.length > 0);

    return (
        <>
            {/*
              Gated like every tile, and for the same reason: `system.maintenance.read`
              is tiers 1–2 only, so an ungated banner would have a Support
              administrator collecting a 403 on every page load — the exact
              anti-pattern the contract names when it says to build from
              `GET /permissions/me` rather than from the refusals you gather.
            */}
            <Can permission="system.maintenance.read">
                <MaintenanceBanner refreshToken={token} timeZone={timeZone} />
            </Can>

            <PageContainer
                title="Overview"
                description="Every figure here is one the platform computed. This service has no aggregate endpoint, so each tile is its own read, gated on its own permission."
                actions={
                    <Button variant="outline" size="sm" onClick={refresh}>
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                }
                contentClassName="space-y-8"
            >
                {sections.map((section) => (
                    <section key={section.id} className="space-y-3">
                        <h2 className="text-sm font-semibold">{section.label}</h2>
                        <div className={`grid gap-3 ${section.columns}`}>
                            {/*
                              `h-full` here AND on the Card inside `TileCard`.

                              The grid item already stretches to the row's tallest
                              cell, but the Card was a plain block sizing to its
                              own content, so it stopped short of the item it sat
                              in and every card in a row ended at a different
                              bottom edge. The item has to pass the height on for
                              the Card to have anything to fill.
                            */}
                            {section.tiles.map((tile) => (
                                <div key={tile.id} className="h-full">
                                    {tile.render(can)}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}

                <section className="space-y-3">
                    <h2 className="text-sm font-semibold">Modules</h2>
                    <ModuleGrid />
                </section>
            </PageContainer>
        </>
    );
}
