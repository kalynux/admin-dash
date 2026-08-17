import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ShipmentAssignmentState, ShipmentStatus } from '@/types/shipments.types';

/**
 * The two shipment axes, and they are **not** the same question.
 *
 * `status` is where the parcel is in its life. `assignmentState` is the assignment
 * mirror — whether an agent has been found — and the API refuses to collapse them
 * because they answer different things: a shipment can be `assigned` with an
 * `offered` assignment (out on offer, nobody has accepted) or `in_transit` with an
 * `accepted` one.
 *
 * Neither badge maps its value through a closed lookup. The status enum is a
 * **cross-service contract duplicated in geo-tracker's Go**, and the platform
 * extends it without asking — `handing_over` was added for post-pickup
 * reassignment — so an unrecognised value renders as itself in the neutral tone.
 * A closed reading would blank a badge the day a tenth status ships.
 */

const STATUS_TONE: Record<string, string> = {
    delivered: 'border-success/30 bg-success/10 text-success',
    agent_delivered: 'border-success/30 bg-success/10 text-success',
    failed: 'border-destructive/30 bg-destructive/10 text-destructive',
    rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
    returned: 'border-warning/30 bg-warning/10 text-warning',
    pending_agency_reassignment: 'border-warning/30 bg-warning/10 text-warning',
    handing_over: 'border-warning/30 bg-warning/10 text-warning',
};

const ASSIGNMENT_TONE: Record<string, string> = {
    accepted: 'border-success/30 bg-success/10 text-success',
    unassigned: 'border-warning/30 bg-warning/10 text-warning',
};

export function ShipmentStatusBadge({
    status,
    className,
}: {
    status: ShipmentStatus | null | undefined;
    className?: string;
}) {
    const label = humaniseEnum(status);
    if (label === null) return <NotSet>Unknown</NotSet>;

    return (
        <Badge
            variant="outline"
            className={cn('capitalize', STATUS_TONE[status as string], className)}
            title={status as string}
        >
            {label}
        </Badge>
    );
}

export function AssignmentStateBadge({
    state,
    className,
}: {
    state: ShipmentAssignmentState | null;
    className?: string;
}) {
    // `null` is a real answer here — the mirror has never been written.
    const value = state ?? 'unknown';

    return (
        <Badge
            variant="outline"
            className={cn('capitalize', ASSIGNMENT_TONE[value], className)}
            title={value}
        >
            {value.replace(/_/g, ' ')}
        </Badge>
    );
}
