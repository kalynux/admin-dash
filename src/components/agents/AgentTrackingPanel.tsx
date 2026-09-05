import { useState } from 'react';

import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { OpenInGoogleMaps } from '@/components/tracking/OpenInGoogleMaps';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatCount, formatInstantInZone, formatRelative } from '@/lib/format';
import { googleMapsUrlFromGeoJson } from '@/lib/geo';
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
 *    geo-tracker. No assignment rule reads it.
 *
 * ⚠ **The live position is now reachable, and this file used to say it was not.**
 * That was true for three phases and ADR-020 falsified it on 2026-08-22: the
 * geo-tracker data door added `GET /agents/:agentId/{tracking-presence,live-position}`,
 * behind `agents.tracking.read` and 🔴 audited. `AgentLiveTrackingPanel` renders
 * them beside this one. The mirror below still answers a **different** question —
 * *where were they last seen* rather than *where are they now* — so both stay.
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
 * `isStale`, `reportedAt` and the relative age sit **above** the reveal and are
 * shown without disclosing anything — an operator can tell the record is four
 * hours old before deciding whether to look at it at all.
 *
 * ── Why `place` is behind the same button, not shown beside the badge ─────────
 * `agents.md` makes the argument and it is the right one: `[9.7043, 4.0511]`
 * needs a tool to read, and "Bonapriso, Douala" does not. The label is the
 * *more* revealing of the two, so gating the coordinates while printing the
 * street name above them would be a gate in name only. One reveal, both fields,
 * label first because it is the one an operator can actually use.
 *
 * ── Why there is still no map, and what ships instead ─────────────────────────
 * The refusal is of an **embedded** map and it stands. More right now than when
 * this was written: the pipe behind this field had never worked — every agent
 * carried the schema default — so the panel was rendering an empty record. It
 * carries real coordinates now, which means a pin would look live and simply
 * stop moving. An empty panel is obviously empty; a stationary marker is a lie.
 *
 * ⚠ **A link-out is not that, and BR-003 asked for one in as many words.** After
 * the reveal there is an *Open in Google Maps* button, which is where the
 * operator's "give it a name" comes from — this application has no geocoder, and
 * `place.label` is null whenever nothing resolved server-side. It is an act the
 * operator chooses, with the staleness badge already read, and it hands the
 * coordinates to a third party in a URL. All three of those are said on the
 * button.
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
    // 🔴 GeoJSON is [longitude, latitude] and Google is latitude-first. The
    // inversion is done once, in `lib/geo`, and never at a call site — read the
    // 'wrong hemisphere' warning there before touching this line.
    const mapUrl = googleMapsUrlFromGeoJson(position?.coordinates);

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
                    <div className="space-y-3 rounded-lg border p-3">
                        {/*
                          `place` is null when nothing resolved. That is a
                          geocoder outcome, not an operational fact, so it is
                          simply absent rather than labelled "unresolved" — the
                          position below is the record either way.
                        */}
                        {lastKnown.place ? (
                            <div className="space-y-1">
                                <p className="text-muted-foreground text-xs">Resolved place</p>
                                <p className="text-sm">{lastKnown.place.label}</p>
                                <p className="text-muted-foreground text-xs">
                                    {/*
                                      An open string naming the resolver. Rendered
                                      raw: a future "nearest landmark" resolver
                                      would be additive, so nothing switches on it.
                                    */}
                                    {lastKnown.place.source} ·{' '}
                                    {formatInstantInZone(lastKnown.place.resolvedAt, timeZone)}
                                </p>
                            </div>
                        ) : null}
                        <div className="space-y-1">
                            <p className="text-muted-foreground text-xs">
                                Longitude, latitude — GeoJSON order
                            </p>
                            {/*
                              ⚠ Mono, and deliberately **not** a `CopyableValue`.
                              A pair of coordinates is a reading, not an identifier
                              — nothing is looked up by it, and a one-press copy
                              button beside a stale position invites exactly the
                              thing this panel refuses to imply: pasting it
                              somewhere as though it were where the agent is. It
                              stays `select-all`, so the operator who genuinely
                              wants it still gets it in one click.
                            */}
                            <p className="font-mono text-sm select-all">
                                {position.coordinates.join(', ')}
                            </p>
                        </div>
                        {/*
                          The link-out BR-003 specified and this repository owed.
                          It is NOT the embedded map the panel above refuses: a
                          pin drawn on this screen would sit there implying
                          liveness, whereas a window the operator chose to open
                          is an act taken with the staleness badge already read.

                          `mapUrl` is null when the pair is not a place — and
                          then nothing renders, this explanation included.
                        */}
                        {mapUrl ? (
                            <div className="space-y-2 border-t pt-3">
                                <OpenInGoogleMaps url={mapUrl} />
                                <p className="text-muted-foreground text-xs">
                                    Opens a small window on Google&rsquo;s map, which names the
                                    place for you. Two things to know before pressing it: the
                                    coordinates travel to Google in the address bar, and this is
                                    where the agent was <em>last seen</em> &mdash; the pin will
                                    not move.
                                </p>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
                        {/*
                          The label names both fields, because the button
                          discloses both and an operator should know that before
                          pressing it.
                        */}
                        Show last known position and place
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

export type { TrackingDenyReason };
