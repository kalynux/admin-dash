import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import {
    listAdministratorActivity,
    listAdministratorHistory,
} from '@/services/administrators.service';
import {
    ADMINISTRATOR_ACTION_LABELS,
    ADMINISTRATOR_ACTIVITY_ACTIONS,
    ADMINISTRATOR_HISTORY_ACTIONS,
    ADMINISTRATOR_MAX_RANGE_DAYS,
} from '@/types/administrators.types';

/**
 * The two audit feeds on an administrator, and the difference between them.
 *
 * Both read the same audit collection through the same read scope. They differ
 * only in **which side of the row they key on** — which is exactly why every
 * audit row records an actor *and* a target. The prose in each panel is most of
 * the value here: an operator who confuses the two will read "nothing" as
 * "nothing happened" when they are looking at the wrong half.
 */

interface PanelProps {
    adminId: string;
    displayName: string;
    timeZone: string;
    reloadToken: number;
}

/**
 * `GET /:adminId/activity` — what this administrator **did**, anywhere on the
 * platform. The actor half; it answers oversight.
 *
 * ── The filter this panel could not have until now ────────────────────────────
 * `ADMINISTRATOR_ACTIVITY_ACTIONS` is empty and stays empty: this feed spans all
 * 21 permission families, so an `administrators.*` list could never express
 * *"they refunded an order"*, which is exactly the question it exists to answer.
 * Hand-writing all eighty names would have been a list nobody could keep
 * complete.
 *
 * The catalog answers it instead. The prefix is `''` — **the whole vocabulary**
 * — because this route validates against the full `ListAuditQuerySchema` rather
 * than a prefix-derived enum, so every catalogued action is a legal filter here.
 */
export function AdministratorActivityPanel({
    adminId,
    displayName,
    timeZone,
    reloadToken,
}: PanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listAdministratorActivity(adminId, query, options)}
            basePath={`/administrators/${adminId}/activity`}
            actions={ADMINISTRATOR_ACTIVITY_ACTIONS}
            actionLabels={ADMINISTRATOR_ACTION_LABELS}
            actionPrefix=""
            maxRangeDays={ADMINISTRATOR_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption={`What ${displayName} has done`}
            emptyTitle="Nothing on record"
            emptyDescription="What this administrator did, anywhere on the platform. It is not what was done to their account — that is the History tab."
        />
    );
}

/**
 * `GET /:adminId/history` — what was done **to** this account. The target half;
 * it answers account review.
 *
 * Created by whom, promoted when, suspended why, including changes that went
 * through four eyes. **The only place a lifted suspension survives**, because
 * reinstating clears the reason, the timestamp and the actor from the record
 * itself.
 */
export function AdministratorHistoryPanel({
    adminId,
    displayName,
    timeZone,
    reloadToken,
}: PanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listAdministratorHistory(adminId, query, options)}
            basePath={`/administrators/${adminId}/history`}
            actions={ADMINISTRATOR_HISTORY_ACTIONS}
            actionLabels={ADMINISTRATOR_ACTION_LABELS}
            // `target`, not a prefix: "things done to an administrator" spans
            // several families — the ten management actions plus the thirteen
            // `administrators.auth.*` observations — and no prefix can express
            // that. Legal here only because this route validates against the
            // whole catalog rather than a prefix-derived enum.
            actionTarget="administrator"
            maxRangeDays={ADMINISTRATOR_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption={`What has been done to ${displayName}`}
            emptyTitle="Nothing has been done to this account"
            emptyDescription="Created by whom, promoted when, suspended why — including changes that went through four eyes. This is the only place a lifted suspension survives; reinstating erases it from the record itself."
        />
    );
}
