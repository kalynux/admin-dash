import { ClipboardCheck } from 'lucide-react';

import { StatTile } from '@/components/overview/StatTile';
import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatRelative } from '@/lib/format';
import { listApprovals } from '@/services/approvals.service';

/** Enough to recognise the queue without turning the tile into the screen. */
const PREVIEW_ROWS = 3;

/**
 * `GET /approvals?status=pending` — what is waiting for a second signature.
 *
 * Shows `meta.total` as the figure and the first few rows' `description`,
 * because `description` is *"one line, written for the approver"* and is the
 * only field that makes a queued action legible without opening it.
 *
 * **Seeing the queue is not being able to act on it.** There is no
 * `approvals.approve` permission, deliberately — an approver must hold the
 * permission the queued action itself names, checked per request, so nobody can
 * commit an action they could not have performed themselves. That is why this
 * tile links to the queue and offers no buttons: whether a given row is
 * actionable is a question only the approve request can answer.
 *
 * **Dual control covers exactly three actions**, all in the irreversible
 * direction: promoting an administrator to tier 1, suspending or reinstating a
 * tier-1 administrator, and marking a payout ≥ 2 000 000 XAF as paid.
 */
export function ApprovalsTile({ refreshToken }: { refreshToken: number }) {
    const query = useAsyncData(`/approvals?status=pending#${refreshToken}`, (signal) =>
        listApprovals({ status: 'pending', limit: PREVIEW_ROWS }, { signal }),
    );

    return (
        <TileCard
            title="Waiting for approval"
            icon={ClipboardCheck}
            to="/dashboard/approvals"
            query={query}
        >
            {(page) => (
                <div className="space-y-2">
                    {/*
                      The figure is `meta.total`, never `data.length` — the list
                      is capped at three rows and an empty list reports
                      `pages: 0`, so neither is a count.
                    */}
                    <StatTile value={page.meta.total} tone="attention" />

                    {page.data.length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                            Nothing is waiting for a second administrator.
                        </p>
                    ) : (
                        <ul className="space-y-1.5 border-t pt-2">
                            {page.data.map((approval) => {
                                const expires = formatRelative(approval.expiresAt);
                                return (
                                    <li key={approval.id} className="space-y-0.5">
                                        <p className="text-xs leading-snug">
                                            {approval.description}
                                        </p>
                                        <p className="text-muted-foreground text-[11px]">
                                            {approval.requestedByTierLabel}
                                            {expires ? ` · expires ${expires}` : null}
                                        </p>
                                    </li>
                                );
                            })}
                            {page.meta.total > page.data.length ? (
                                <li className="text-muted-foreground text-[11px]">
                                    and {formatCount(page.meta.total - page.data.length)} more
                                </li>
                            ) : null}
                        </ul>
                    )}
                </div>
            )}
        </TileCard>
    );
}
