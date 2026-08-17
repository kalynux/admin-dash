import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listAgencyActivity } from '@/services/agencies.service';
import {
    AGENCY_AUDIT_ACTIONS,
    AGENCY_AUDIT_ACTION_LABELS,
    AGENCY_MAX_RANGE_DAYS,
} from '@/types/agencies.types';

interface AgencyActivityPanelProps {
    agencyId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /agencies/:agencyId/activity` — **what administrators have done to this
 * agency**: verification decisions, deactivations and reactivations.
 *
 * The rendering is `components/common/AuditActivityPanel`'s. What stays here is
 * the request, the three-action vocabulary, and the note below.
 *
 * ── This is not the agency's business activity ────────────────────────────────
 * Their shipments, their agents' deliveries and their COD remittances live in
 * other domains behind `shipments.read`, `agents.read` and `cod.*`, and there is
 * no endpoint that assembles them. Reading "no activity" here as "this agency has
 * done nothing" would be wrong by a wide margin, so the empty state says so.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * The endpoint needs `agencies.read` **and** `audit.read` in `all` mode.
 * `AgencyDetail` refuses to render the tab at all without both.
 *
 * Note the span caps at **366 days here**, not the 92 `GET /audit` enforces.
 */
export function AgencyActivityPanel({
    agencyId,
    timeZone,
    reloadToken,
}: AgencyActivityPanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listAgencyActivity(agencyId, query, options)}
            basePath={`/agencies/${agencyId}/activity`}
            actions={AGENCY_AUDIT_ACTIONS}
            actionLabels={AGENCY_AUDIT_ACTION_LABELS}
            actionPrefix="agencies."
            maxRangeDays={AGENCY_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this agency"
            emptyTitle="No administrator has acted on this agency"
            emptyDescription="This feed records verification decisions, deactivations and reactivations made by administrators. It is not the agency's own business activity — their shipments, agents and cash remittances live behind their own permissions, and no endpoint assembles them."
        />
    );
}
