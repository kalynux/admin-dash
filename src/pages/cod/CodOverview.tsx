import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Coins, Users, Wallet } from 'lucide-react';

import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { getCodOverview } from '@/services/cod.service';
import { useCan } from '@/store';
import { isCodOverview, type CodOverview as CodOverviewShape } from '@/types/cod.types';

/**
 * `GET /cod/overview` · `cod.overview.read` · **delegated**.
 *
 * The platform-wide cash position: what agents are holding, what agencies owe,
 * and what has been collected but never physically arrived.
 *
 * ── ⚠ No currency, anywhere on this screen ────────────────────────────────────
 * These are grouped sums: jovi-mall's aggregation groups on `$balance` and drops
 * the currency, so there is none to render. `formatCount` throughout, never
 * `formatMoney` — painting `XAF` onto a figure the platform declined to
 * denominate would be inventing a fact.
 *
 * ── The shape is checked before it renders ────────────────────────────────────
 * wi-admin types this `Promise<unknown>` and passes jovi-mall's object through
 * verbatim, so `isCodOverview` is the boundary. If the shape moves, the screen
 * says so rather than showing fabricated zeroes.
 */
export function CodOverview() {
    const overview = useAsyncData('/cod/overview', (signal) => getCodOverview({ signal }));

    if (overview.isLoading) {
        return (
            <PageContainer title="Cash on delivery">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    const position = isCodOverview(overview.data) ? overview.data : null;

    if (!position) {
        return (
            <PageContainer title="Cash on delivery">
                <ErrorState
                    error={overview.error}
                    onRetry={overview.reload}
                    deniedTitle="Not available to you"
                />
            </PageContainer>
        );
    }

    return (
        <PageContainer
            title="Cash on delivery"
            description="Where the platform's cash is, and what has not come back."
        >
            <div className="space-y-4">
                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    Liability flows upward in two layers — an agent owes their agency, an agency
                    owes the platform.
                    <InfoHint label="About these totals">
                        Grouped sums across every cash account. The platform reports them without a
                        currency — it groups on the balances alone — so they are shown as plain
                        figures rather than amounts. There is no platform holder: the platform is
                        the creditor at the top of the chain and does not owe itself.
                    </InfoHint>
                </p>

                <div className="grid gap-4 md:grid-cols-3">
                    <PositionCard
                        icon={<Wallet className="size-4" />}
                        title="Held by agents"
                        total={position.cashHeldByAgents.total}
                        detail={`${formatCount(position.cashHeldByAgents.agentsHoldingCash)} agents holding cash`}
                        explanation="Cash agents have collected and not yet handed on."
                    />

                    <PositionCard
                        icon={<Coins className="size-4" />}
                        title="Owed by agencies"
                        total={position.agencyLiabilities.total}
                        detail={`${formatCount(position.agencyLiabilities.agenciesOwing)} agencies owing`}
                        explanation="The second layer: what agencies owe the platform once agents have handed cash up."
                    />

                    <PositionCard
                        icon={<AlertTriangle className="size-4" />}
                        title="Unsettled collections"
                        total={position.unsettledCollections.amount}
                        detail={`${formatCount(position.unsettledCollections.count)} collections`}
                        explanation="Sales whose cash the platform has not physically received. This is what blocks an earnings release."
                        emphasis
                    />
                </div>

                <CrossLinks />
            </div>
        </PageContainer>
    );
}

function PositionCard({
    icon,
    title,
    total,
    detail,
    explanation,
    emphasis = false,
}: {
    icon: React.ReactNode;
    title: string;
    total: number;
    detail: string;
    explanation: string;
    emphasis?: boolean;
}) {
    return (
        <Card className={emphasis && total > 0 ? 'border-warning/40' : undefined}>
            <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                    {icon}
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
                {/* No currency: the aggregation dropped it. */}
                <p className="text-2xl font-semibold tabular-nums">{formatCount(total)}</p>
                <p className="text-muted-foreground text-xs">{detail}</p>
                <p className="text-muted-foreground text-xs">{explanation}</p>
            </CardContent>
        </Card>
    );
}

/**
 * Where to go next.
 *
 * Each link is gated on the permission its destination needs — a link to a screen
 * that will refuse is a trap, and the four COD reads are separately granted.
 */
function CrossLinks() {
    const can = useCan();

    const destinations = [
        {
            to: '/dashboard/cod/holders',
            label: 'Who is holding cash',
            permission: 'cod.holders.read' as const,
            icon: <Users className="size-4" />,
        },
        {
            to: '/dashboard/cod/remittances',
            label: 'Agency remittances',
            permission: 'cod.remittances.read' as const,
            icon: <Coins className="size-4" />,
        },
        {
            to: '/dashboard/cod/deposits',
            label: 'Agent deposits',
            permission: 'cod.deposits.read' as const,
            icon: <Wallet className="size-4" />,
        },
        {
            to: '/dashboard/cod/discrepancies',
            label: 'Discrepancies',
            permission: 'cod.discrepancies.read' as const,
            icon: <AlertTriangle className="size-4" />,
        },
    ].filter((destination) => can(destination.permission));

    if (destinations.length === 0) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Work the cash chain</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
                {destinations.map((destination) => (
                    <Link
                        key={destination.to}
                        to={destination.to}
                        className="hover:bg-muted/50 flex items-center justify-between rounded-lg border p-3 text-sm transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            {destination.icon}
                            {destination.label}
                        </span>
                        <ArrowRight className="text-muted-foreground size-4" />
                    </Link>
                ))}
            </CardContent>
        </Card>
    );
}

export type { CodOverviewShape };
