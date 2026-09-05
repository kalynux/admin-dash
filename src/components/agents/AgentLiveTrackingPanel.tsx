import { useState } from 'react';
import { MapPin, RotateCw } from 'lucide-react';

import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { OpenInGoogleMaps } from '@/components/tracking/OpenInGoogleMaps';
import { RevealPositionDialog } from '@/components/tracking/RevealPositionDialog';
import { TrackingDoorNotice } from '@/components/tracking/TrackingDoorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone, formatRelative, humaniseEnum } from '@/lib/format';
import { googleMapsUrl } from '@/lib/geo';
import {
    getAgentLivePosition,
    getAgentTrackingPresence,
    isPositionStale,
} from '@/services/tracking.service';
import { useCan } from '@/store';
import type { AgentLivePosition } from '@/types/tracking.types';

/**
 * The geo-tracker data door, agent side — presence and, on request, the live
 * position.
 *
 * ── Two reads, handled independently ──────────────────────────────────────────
 * geo-tracker grants `agent:presence` and `agent:position` **separately**, and
 * an unset scope list grants presence alone. So a deployment can serve the top
 * half of this panel and refuse the bottom, and each renders its own outcome.
 * Do not infer one from the other.
 *
 * ── Presence answers a different question from the detail read ────────────────
 * `tracking.lastKnown` on the agent detail is jovi-mall's **stale business
 * mirror** and answers *where were they last seen*. Presence answers *is the
 * device reporting right now*, and carries **no coordinates** at all —
 * `positionKnown` says a position exists without saying what it is, which is why
 * it needs no reason and writes no audit row.
 *
 * The authoritative answer to *may they be dispatched* is neither: that is
 * `GET /agents/:agentId/tracking-policy`, on the panel beside this one.
 *
 * ── The position is behind an explicit action, and stays there ────────────────
 * Reading it is 🔴 audited fail-closed and requires an operator-written reason.
 * It is deliberately **not** fetched on mount: every read is an audit row, and a
 * panel that discloses a person's location merely because somebody opened a tab
 * would make the record meaningless. Same shape as revealing a payout
 * destination.
 *
 * ── Rendered as a timestamped reading, never as a map marker ──────────────────
 * There is no realtime here — no WebSocket, no SSE — and the wire ships
 * `ageSeconds` with **no `stale` verdict**, deliberately. A marker that stops
 * moving tells nobody it has stopped; a reading labelled "as of four minutes
 * ago" does.
 */
export function AgentLiveTrackingPanel({
    agentId,
    timeZone,
}: {
    agentId: string;
    timeZone: string;
}) {
    const can = useCan();
    const [revealing, setRevealing] = useState(false);
    const [position, setPosition] = useState<AgentLivePosition | null>(null);
    const [readAt, setReadAt] = useState<string | null>(null);

    const presence = useAsyncData(`/agents/${agentId}/tracking-presence`, (signal) =>
        getAgentTrackingPresence(agentId, { signal }),
    );

    // Gated here as well as by the route: this panel sits inside a tab an agent
    // reader can reach, and `agents.tracking.read` is a narrower grant than
    // `agents.read`.
    if (!can('agents.tracking.read')) return null;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Is the device reporting?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        Live device state from the tracking service. This carries no coordinates —
                        it answers whether the phone is streaming, not where it is.
                    </p>

                    {presence.isLoading ? (
                        <InlineLoader />
                    ) : presence.error ? (
                        <TrackingDoorNotice
                            error={presence.error}
                            onRetry={presence.reload}
                            subject="this agent's presence"
                        />
                    ) : presence.data ? (
                        <DefinitionList>
                            <Definition label="Connected">
                                <Badge variant={presence.data.connected ? 'default' : 'outline'}>
                                    {presence.data.connected ? 'Connected' : 'Not connected'}
                                </Badge>
                            </Definition>
                            <Definition
                                label="Position known"
                                hint={
                                    <InfoHint label="About this">
                                        Whether the service holds a position for this agent — not
                                        what it is. Reading the position itself is a separate,
                                        recorded action below.
                                    </InfoHint>
                                }
                            >
                                {presence.data.positionKnown ? 'Yes' : 'No'}
                                {typeof presence.data.positionAgeSeconds === 'number' ? (
                                    <span className="text-muted-foreground text-xs">
                                        {' '}
                                        · last reported {presence.data.positionAgeSeconds}s ago
                                    </span>
                                ) : null}
                            </Definition>
                            <Definition label="Tracking Allow">
                                <Badge variant="outline">
                                    {presence.data.trackingAllow ? 'Granted' : 'Not granted'}
                                </Badge>
                            </Definition>
                            <Definition label="Last heartbeat">
                                {formatInstantInZone(
                                    presence.data.lastHeartbeatAt ?? null,
                                    timeZone,
                                ) ?? <NotSet />}
                            </Definition>
                            <Definition label="Device">
                                {presence.data.device ? (
                                    <ul className="text-sm">
                                        <li>
                                            Location services:{' '}
                                            {presence.data.device.locationEnabled ? 'on' : 'off'}
                                        </li>
                                        <li>
                                            Permission:{' '}
                                            {presence.data.device.locationPermissionGranted
                                                ? 'granted'
                                                : 'not granted'}
                                        </li>
                                        <li>
                                            Tracking:{' '}
                                            {presence.data.device.trackingEnabled ? 'on' : 'off'}
                                        </li>
                                    </ul>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition
                                label="Deliveries in progress"
                                hint={
                                    <InfoHint label="About sessions">
                                        One tracking session per shipment, all fed by the same GPS
                                        stream. An agent carrying three deliveries has three.
                                    </InfoHint>
                                }
                            >
                                {presence.data.sessions.length === 0 ? (
                                    <NotSet>None</NotSet>
                                ) : (
                                    <ul className="space-y-1 text-sm">
                                        {presence.data.sessions.map((session) => (
                                            <li key={session.sessionId}>
                                                {session.shipmentId ?? session.sessionId}
                                                {session.state ? (
                                                    <span className="text-muted-foreground">
                                                        {' '}
                                                        · {humaniseEnum(session.state)}
                                                    </span>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Definition>
                        </DefinitionList>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Where are they now?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        A person&rsquo;s current location. Reading it is recorded against your name
                        with the reason you give, and the reading is a point in time — it does not
                        update itself.
                    </p>

                    {position ? (
                        <PositionReading
                            position={position}
                            readAt={readAt}
                            timeZone={timeZone}
                            onAgain={() => setRevealing(true)}
                        />
                    ) : (
                        <Button variant="outline" size="sm" onClick={() => setRevealing(true)}>
                            <MapPin className="size-4" />
                            Reveal current position
                        </Button>
                    )}
                </CardContent>
            </Card>

            <RevealPositionDialog
                open={revealing}
                onOpenChange={setRevealing}
                title="Reveal this agent’s current position?"
                subject="this agent's position"
                disclosure="This shows where a named person is right now, as last reported by their device."
                onConfirm={async (reason) => {
                    const result = await getAgentLivePosition(agentId, reason);
                    setPosition(result);
                    // Stamped client-side: the wire carries when the *device*
                    // reported, not when we asked, and an operator needs both to
                    // judge the reading.
                    setReadAt(new Date().toISOString());
                }}
            />
        </div>
    );
}

/**
 * One position reading.
 *
 * ⚠ **`position: null` with `withheld` set is a normal, common answer** — the
 * agent has not granted device-level Tracking Allow and geo-tracker refuses.
 * `recordedAt` is null then too, not merely the coordinates: that the agent is
 * streaming at all is part of what the opt-out withholds. So this renders an
 * explanation, never an error.
 *
 * **An unknown `withheld` value is treated as withheld and shows nothing.**
 */
function PositionReading({
    position,
    readAt,
    timeZone,
    onAgain,
}: {
    position: AgentLivePosition;
    readAt: string | null;
    timeZone: string;
    onAgain: () => void;
}) {
    // Withheld is signalled two ways and either is sufficient: the flag, or a
    // null position. Reading both means an unrecognised `withheld` value still
    // lands here rather than rendering an empty coordinate pair.
    if (position.withheld || position.position === null) {
        return (
            <div className="space-y-3">
                <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
                    <p className="text-foreground font-medium">
                        This agent has not enabled tracking
                    </p>
                    <p>
                        They have not granted location sharing on their device, so the tracking
                        service withholds their position — and whether they are streaming at all.
                        This is their choice, not a fault.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={onAgain}>
                    <RotateCw className="size-4" />
                    Check again
                </Button>
            </div>
        );
    }

    const stale = isPositionStale(position.ageSeconds);
    // Already latitude-first on this wire, unlike the last-known block's
    // GeoJSON — so this does no inversion. Named because the two panels sit side
    // by side and the difference between their payloads is invisible here.
    const mapUrl = googleMapsUrl(position.position.latitude, position.position.longitude);

    return (
        <div className="space-y-3">
            <DefinitionList>
                <Definition label="Latitude">{position.position.latitude}</Definition>
                <Definition label="Longitude">{position.position.longitude}</Definition>
                <Definition
                    label="Reported"
                    hint={
                        <InfoHint label="About the age">
                            When the device reported this position, not when you asked. A reading
                            more than two minutes old is marked, because a coordinate with no age
                            beside it reads as current.
                        </InfoHint>
                    }
                >
                    {formatInstantInZone(position.recordedAt, timeZone) ?? <NotSet />}
                    {typeof position.ageSeconds === 'number' ? (
                        <Badge variant={stale ? 'outline' : 'default'} className="ml-2">
                            {stale ? 'stale · ' : ''}
                            {position.ageSeconds}s old when read
                        </Badge>
                    ) : null}
                </Definition>
                <Definition label="You read this">
                    {readAt ? formatRelative(readAt) : <NotSet />}
                </Definition>
            </DefinitionList>

            <p className="text-muted-foreground text-xs">
                A point in time, not a live feed. Nothing updates until you check again — and each
                check is recorded.
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onAgain}>
                    <RotateCw className="size-4" />
                    Check again
                </Button>
                <OpenInGoogleMaps url={mapUrl} />
            </div>

            {mapUrl ? (
                <p className="text-muted-foreground text-xs">
                    The map opens in a small window and names the place. The coordinates travel to
                    Google in the address bar — a second disclosure, on top of the one already
                    recorded against your name.
                </p>
            ) : null}
        </div>
    );
}
