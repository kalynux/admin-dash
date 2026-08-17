import { useState } from 'react';

import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatCount, formatInstantInZone, formatRelative } from '@/lib/format';
import { getTrackingPolicy } from '@/services/agents.service';
import { isPlatformActor } from '@/types/actor.types';
import type { AgentDetail, AgentLastKnown, TrackingDenyReason } from '@/types/agents.types';

/**
 * Tracking Allow: the stored flag, the authoritative verdict, and the position.
 *
 * ── Three different things, deliberately not merged ───────────────────────────
 * 1. `agent.tracking.allowed` is the **stored flag** an administrator or an agency
 *    wrote. It is not the verdict.
 * 2. `GET /agents/:agentId/tracking-policy` is the **verdict** — it folds in the
 *    account status and whether an approved contract exists. A screen reading the
 *    flag alone will disagree with dispatch.
 * 3. `tracking.lastKnown` is a **stale business mirror** written best-effort by
 *    geo-tracker. No assignment rule reads it, and the live position lives in
 *    geo-tracker, which this dashboard cannot reach at all.
 *
 * ── The reveal, and why it is not gated on the verdict ────────────────────────
 * `lastKnown.position` ships **unconditionally** — regardless of the flag,
 * regardless of the verdict, under plain `agents.read` which **tier-3 Support
 * holds**, and unaudited. That is a backend exposure question, written up in
 * `docs/dashboard/DATA-EXPOSURE-REGISTER.md`. What this screen does about it is
 * put the coordinates behind an explicit action, the way a payout destination is
 * revealed rather than printed.
 *
 * The reveal is **not** conditioned on `trackingAllowed`. A denied verdict means
 * "do not track them now"; it does not erase where they were last seen, and
 * withholding that is harmful in exactly the situation an operator opens this
 * screen for. That is a product decision, recorded so it can be overruled.
 *
 * Rendered as text, never as a map marker: a marker that stops moving tells nobody
 * it stopped.
 */

/** The fourth value is undocumented — `agents.md` lists only three. */
const DENY_REASON_COPY: Record<string, string> = {
    tracking_disabled: 'The Tracking Allow flag is off for this agent.',
    agent_not_active: 'The agent’s account is not active.',
    agent_not_found: 'The platform does not recognise this agent.',
    no_approved_agency: 'The agent holds no approved agency contract.',
};

export function AgentTrackingPanel({
    agent,
    timeZone,
    reloadToken,
}: {
    agent: AgentDetail;
    timeZone: string;
    reloadToken: number;
}) {
    const policy = useAsyncData(`/agents/${agent.id}/tracking-policy#${reloadToken}`, (signal) =>
        getTrackingPolicy(agent.id, { signal }),
    );

    const verdict = policy.data;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>The stored flag</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition
                            label="Tracking allowed"
                            hint={
                                <InfoHint label="About the flag">
                                    What an administrator or the agent’s agency last wrote. It is
                                    an input to the verdict below, not the verdict itself.
                                </InfoHint>
                            }
                        >
                            <Badge variant="outline">
                                {agent.tracking.allowed ? 'Allowed' : 'Not allowed'}
                            </Badge>
                        </Definition>
                        <Definition label="Reason">
                            {agent.tracking.reason ?? <NotSet />}
                        </Definition>
                        <Definition label="Changed">
                            {formatInstantInZone(agent.tracking.changedAt, timeZone) ?? '—'}
                        </Definition>
                        <Definition label="Changed by">
                            {agent.tracking.changedBy.name ? (
                                <span className="flex flex-wrap items-center gap-2">
                                    {agent.tracking.changedBy.name}
                                    {agent.tracking.changedBy.role ? (
                                        <Badge variant="outline" className="capitalize">
                                            {agent.tracking.changedBy.role}
                                        </Badge>
                                    ) : null}
                                    {isPlatformActor(agent.tracking.changedBy) ? null : (
                                        <Badge variant="outline">administrator</Badge>
                                    )}
                                </span>
                            ) : (
                                <NotSet>Never moved</NotSet>
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>The dispatch verdict</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        Authoritative. This is what dispatch actually asks, and it folds in the
                        account status and whether an approved contract exists — so it can refuse
                        an agent whose flag is on.
                    </p>

                    {policy.isLoading ? (
                        <InlineLoader label="Asking the platform…" />
                    ) : verdict ? (
                        <DefinitionList>
                            <Definition label="Verdict">
                                <Badge variant="outline">
                                    {verdict.trackingAllowed ? 'Allowed' : 'Refused'}
                                </Badge>
                            </Definition>
                            <Definition label="Why">
                                {verdict.denyReason ? (
                                    <span>
                                        {DENY_REASON_COPY[verdict.denyReason] ??
                                            verdict.denyReason}
                                    </span>
                                ) : (
                                    <NotApplicable>Nothing is refusing tracking</NotApplicable>
                                )}
                            </Definition>
                            <Definition label="Note">{verdict.note ?? <NotSet />}</Definition>
                            <Definition label="Account status seen by the platform">
                                <span className="capitalize">{verdict.agentStatus ?? '—'}</span>
                            </Definition>
                            <Definition label="Approved agencies">
                                {formatCount(verdict.approvedAgencyIds.length)}
                            </Definition>
                            <Definition label="Evaluated at">
                                {formatInstantInZone(verdict.evaluatedAt, timeZone) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    ) : (
                        /*
                          A dependency failure is "we could not ask", which is a
                          different statement from "not allowed" — and rendering it as
                          a refusal would be a refusal this dashboard invented. The
                          reveal below stays available either way.
                        */
                        <div className="space-y-2">
                            <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm">
                                Verdict unavailable — {resolveErrorMessage(policy.error)}. This is
                                not a refusal; the platform simply did not answer.
                            </p>
                            <Button variant="outline" size="sm" onClick={policy.reload}>
                                Ask again
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <LastKnownPositionReveal lastKnown={agent.tracking.lastKnown} timeZone={timeZone} />
        </div>
    );
}

/**
 * The last-known position, behind an explicit action.
 *
 * `isStale`, `reportedAt` and the relative age sit **above** the coordinates and
 * are shown without revealing anything — an operator can tell the record is four
 * hours old before deciding whether to look at it at all.
 */
export function LastKnownPositionReveal({
    lastKnown,
    timeZone,
}: {
    lastKnown: AgentLastKnown;
    timeZone: string;
}) {
    const [revealed, setRevealed] = useState(false);
    const position = lastKnown.position;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Last known position</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                    A business mirror written best-effort by geo-tracker. No assignment rule reads
                    it, and the live position lives in geo-tracker, which this dashboard cannot
                    reach. Treat this as <em>last seen</em>, not as where they are.
                </p>

                <DefinitionList>
                    <Definition label="Freshness">
                        {lastKnown.isStale ? (
                            <Badge
                                variant="outline"
                                className="border-warning/30 bg-warning/10 text-warning"
                            >
                                Stale
                            </Badge>
                        ) : (
                            <Badge variant="outline">Recent</Badge>
                        )}
                    </Definition>
                    <Definition label="Reported at">
                        {lastKnown.reportedAt ? (
                            <>
                                {formatInstantInZone(lastKnown.reportedAt, timeZone)}
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {formatRelative(lastKnown.reportedAt)}
                                </span>
                            </>
                        ) : (
                            <NotSet>Never reported</NotSet>
                        )}
                    </Definition>
                    <Definition label="Reported state">
                        {lastKnown.status || <NotSet />}
                    </Definition>
                    <Definition label="Source">{lastKnown.source ?? <NotSet />}</Definition>
                </DefinitionList>

                {position === null ? (
                    <p className="text-sm">
                        <NotSet>No position has ever been reported for this agent.</NotSet>
                    </p>
                ) : revealed ? (
                    <div className="space-y-1 rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">
                            Longitude, latitude — GeoJSON order
                        </p>
                        <p className="font-mono text-sm select-all">
                            {position.coordinates.join(', ')}
                        </p>
                    </div>
                ) : (
                    <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
                        Show last known position
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

export type { TrackingDenyReason };
