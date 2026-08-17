import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listUserActivity } from '@/services/users.service';
import {
    USER_AUDIT_ACTIONS,
    USER_AUDIT_ACTION_LABELS,
    USER_MAX_RANGE_DAYS,
} from '@/types/users.types';

interface UserActivityPanelProps {
    userId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /users/:userId/activity` — **what administrators have done to this
 * account**.
 *
 * The rendering, the filters and the retention footer are
 * `components/common/AuditActivityPanel`'s, shared with every other `/:id/activity`
 * feed on the service. What stays here is what is actually about users: the
 * request, the action vocabulary, and the two paragraphs below.
 *
 * ── What it is not ────────────────────────────────────────────────────────────
 * Not the person's own platform activity. Their orders, shipments and tickets
 * live in other domains behind `orders.read`, `shipments.read` and
 * `support.tickets.read`, and assembling them here would let `users.read` alone
 * reach data those permissions exist to gate. The empty state says as much, so
 * nobody reads "no activity" as "this person has done nothing".
 *
 * ── Why this is also the suspension history ───────────────────────────────────
 * Reinstating an account **clears the reason, the timestamp and the actor** off
 * the record. These rows are therefore the only surviving evidence that a
 * suspension ever happened — which is why the panel is worth its own tab rather
 * than a collapsed section.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * The endpoint needs `users.read` **and** `audit.read` in `all` mode. This
 * component does not check it; `UserDetail` refuses to render the tab at all
 * without both, which is the honest shape — a tab that only ever shows a refusal
 * is worse than no tab.
 *
 * Note the span caps at **366 days here**, not the 92 `GET /audit` enforces.
 */
export function UserActivityPanel({ userId, timeZone, reloadToken }: UserActivityPanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listUserActivity(userId, query, options)}
            basePath={`/users/${userId}/activity`}
            actions={USER_AUDIT_ACTIONS}
            actionLabels={USER_AUDIT_ACTION_LABELS}
            actionPrefix="users."
            maxRangeDays={USER_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this account"
            emptyTitle="No administrator has acted on this account"
            emptyDescription="This feed records suspensions, reinstatements and identifier changes made by administrators. It is not the person's own platform activity — their orders, shipments and tickets live behind their own permissions."
        />
    );
}
