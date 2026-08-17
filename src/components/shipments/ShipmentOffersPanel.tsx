import { useMemo, useState } from 'react';
import { RotateCw, UserSearch } from 'lucide-react';

import { AgentRef } from '@/components/shipments/ShipmentProfilePanels';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import { listShipmentOffers } from '@/services/shipments.service';
import type { CanPredicate } from '@/store';
import {
    SHIPMENT_OFFER_CAP,
    offersAreCapped,
    type ShipmentDetail,
    type ShipmentOffer,
} from '@/types/shipments.types';

/**
 * The offer trail — everyone who was asked, in which round, and how they answered.
 *
 * ── Seeded from the detail, refreshed on demand ───────────────────────────────
 * The shipment detail already embeds `offers` from the same read, so opening this
 * tab costs nothing. `GET /:shipmentId/offers` is called only when somebody
 * refreshes — after a reassignment, typically — which is one collection instead of
 * the five the whole detail would re-read.
 *
 * ── Capped at fifty, and the cap is silent on the wire ────────────────────────
 * Both reads are `findForShipment(shipmentId, limit = 50)`, and
 * `assignment.offerCount` is that same capped length. No `meta` reports the
 * truncation, so this panel says it: at the cap the count means "at least fifty",
 * not a total.
 *
 * ── What is deliberately absent ───────────────────────────────────────────────
 * `candidate_pool` — the entire ranked list of every agent the auto-assigner
 * considered, each with a trust score — is not projected. A twenty-offer page
 * would fan out hundreds of agents' scores to a screen that renders one, and an
 * agent's trust score is not a fact the shipments surface is entitled to
 * broadcast. The offer rows already tell the whole sequence.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * `shipments.read` **+** `agents.read`, `all` mode: the rows name agents, their
 * round and their refusal reasons, so gating on `shipments.read` alone would make
 * this a second door onto the agent directory. `ShipmentDetail` omits the tab
 * without both.
 */

const OFFER_TONE: Record<string, string> = {
    accepted: 'border-success/30 bg-success/10 text-success',
    rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
    expired: 'border-warning/30 bg-warning/10 text-warning',
    cancelled: 'border-muted-foreground/30 bg-muted text-muted-foreground',
};

export function ShipmentOffersPanel({
    shipment,
    timeZone,
    can,
}: {
    shipment: ShipmentDetail;
    timeZone: string;
    can: CanPredicate;
}) {
    /** Bumped by Refresh. Zero means "use what the detail already gave us". */
    const [refreshToken, setRefreshToken] = useState(0);

    const refreshed = useAsyncData(
        refreshToken === 0 ? '' : `/shipments/${shipment.id}/offers#${refreshToken}`,
        (signal) => listShipmentOffers(shipment.id, { signal }),
    );

    const rows = refreshToken === 0 ? shipment.offers : (refreshed.data ?? shipment.offers);
    const capped = offersAreCapped(rows.length);

    const columns = useMemo<Column<ShipmentOffer>[]>(
        () => [
            {
                id: 'agent',
                header: 'Agent',
                cell: (offer) => (
                    <AgentRef id={offer.agentId} name={offer.agentName} can={can} />
                ),
            },
            {
                id: 'status',
                header: 'Answer',
                cell: (offer) => (
                    <div className="space-y-1">
                        <Badge
                            variant="outline"
                            className={`capitalize ${OFFER_TONE[offer.status] ?? ''}`}
                        >
                            {humaniseEnum(offer.status) ?? '—'}
                        </Badge>
                        {offer.rejectionReason ? (
                            <p className="text-muted-foreground text-xs capitalize">
                                {humaniseEnum(offer.rejectionReason) ?? '—'}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'round',
                header: 'Round',
                className: 'text-muted-foreground text-sm tabular-nums',
                cell: (offer) => offer.round ?? '—',
            },
            {
                id: 'origin',
                header: 'Origin',
                className: 'text-sm',
                cell: (offer) => (
                    <div className="space-y-1">
                        <span className="capitalize">
                            {(offer.origin ?? 'unknown').replace(/_/g, ' ')}
                        </span>
                        {/*
                          `sessionId: null` means a manual offer — somebody chose this
                          agent rather than the auto-assigner reaching them.
                        */}
                        {offer.sessionId === null ? (
                            <p className="text-muted-foreground text-xs">Created by hand</p>
                        ) : null}
                        {offer.createdBy ? (
                            <p className="text-muted-foreground text-xs">
                                {offer.createdBy.name ?? offer.createdBy.role ?? 'unknown'}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'timing',
                header: 'Timing',
                className: 'text-muted-foreground text-sm',
                cell: (offer) => (
                    <div className="space-y-0.5 text-xs">
                        <p>Offered {formatInstantInZone(offer.createdAt, timeZone) ?? '—'}</p>
                        <p>
                            {offer.respondedAt
                                ? `Answered ${formatInstantInZone(offer.respondedAt, timeZone)}`
                                : `Expires ${formatInstantInZone(offer.expiresAt, timeZone) ?? '—'}`}
                        </p>
                    </div>
                ),
            },
        ],
        [timeZone, can],
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    Everyone this shipment was offered to.
                    <InfoHint label="About the offer trail">
                        Rows are what the assignment rounds produced, newest first. The ranked pool
                        the auto-assigner considered is deliberately not served — an agent&apos;s
                        trust score is not a fact this surface broadcasts, and the rows already tell
                        the sequence.
                    </InfoHint>
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRefreshToken((current) => current + 1)}
                    disabled={refreshed.isLoading || refreshed.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            </div>

            {capped ? (
                <p className="text-muted-foreground rounded-lg border px-3 py-2 text-xs">
                    Showing the {SHIPMENT_OFFER_CAP} most recent offers — the platform caps this
                    read there. The offer count on the Overview tab is the same capped number, so
                    read it as &ldquo;at least {SHIPMENT_OFFER_CAP}&rdquo; rather than as a total.
                </p>
            ) : null}

            <DataTable
                caption="Agents this shipment was offered to"
                columns={columns}
                rows={rows}
                rowKey={(offer) => offer.id}
                isLoading={refreshed.isLoading}
                isRefreshing={refreshed.isRefreshing}
                error={refreshed.error}
                onRetry={refreshed.reload}
                loadingRows={4}
                empty={
                    <EmptyState
                        icon={UserSearch}
                        title="Nobody has been offered this shipment"
                        description="An offer appears once the agency dispatches it and the assignment ranking runs, or once somebody offers it to an agent by hand."
                    />
                }
            />
        </div>
    );
}
