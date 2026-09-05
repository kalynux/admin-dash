import { useState } from 'react';
import { Route as RouteIcon, RotateCw } from 'lucide-react';

import { Definition, DefinitionList } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { OpenInGoogleMaps } from '@/components/tracking/OpenInGoogleMaps';
import { RevealPositionDialog } from '@/components/tracking/RevealPositionDialog';
import { TrackingDoorNotice } from '@/components/tracking/TrackingDoorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { googleMapsUrl } from '@/lib/geo';
import {
    getShipmentTrackingEvents,
    getShipmentTrackingTrail,
} from '@/services/tracking.service';
import { useCan } from '@/store';
import type { ShipmentTrackingTrail, TrackingSession } from '@/types/tracking.types';

/**
 * The geo-tracker data door, shipment side — the GPS trail and the event log.
 *
 * ── One permission, two very different reads ──────────────────────────────────
 * `shipments.tracking.read` grants both, but geo-tracker grants
 * `shipment:trail` and `shipment:events` as **separate scopes** — and only the
 * trail emits coordinates, so only the trail requires a reason and writes an
 * audit row. A deployment can serve the events and refuse the trail; each half
 * renders its own outcome.
 *
 * ── Sessions are plural, and that is the reading trap ─────────────────────────
 * **A reassigned delivery has one session per agent who carried it** — two
 * agents, two sets of checkpoints, one shipment. Each checkpoint names its
 * `agentId`, so a trail must be read **per session**, never as one polyline.
 * This panel groups by session for that reason.
 *
 * ── Several connections on one session is not several deliveries ──────────────
 * It is one delivery whose agent's phone dropped and came back. The events card
 * says so rather than leaving the count to be misread.
 *
 * ── There is no map here, and that is not an omission ─────────────────────────
 * There is no realtime on this door — no WebSocket, no SSE — and no agent-scoped
 * history of any kind. What exists is a completed delivery's record, and it is
 * rendered as one: a table of points, not a drawn route.
 *
 * ⚠ **Each row does link out to Google Maps**, which is a different thing from
 * drawing the route — the trail is per *session* and merging two couriers'
 * points into one polyline is the reading trap named above, whereas one point
 * in one window cannot be misread that way. It is behind the same audited
 * reveal as the coordinates it opens.
 */
export function ShipmentTrackingPanel({
    shipmentId,
    timeZone,
}: {
    shipmentId: string;
    timeZone: string;
}) {
    const can = useCan();
    const [revealing, setRevealing] = useState(false);
    const [trail, setTrail] = useState<ShipmentTrackingTrail | null>(null);

    const events = useAsyncData(`/shipments/${shipmentId}/tracking-events`, (signal) =>
        getShipmentTrackingEvents(shipmentId, undefined, { signal }),
    );

    // Narrower than `shipments.read`, which is what the tab itself needs.
    if (!can('shipments.tracking.read')) return null;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Where did it go?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        The GPS trail recorded while this delivery was carried. Reading it shows
                        where a named courier travelled, so it is recorded against your name with
                        the reason you give.
                    </p>

                    {trail ? (
                        <TrailReading trail={trail} timeZone={timeZone} onAgain={() => setRevealing(true)} />
                    ) : (
                        <Button variant="outline" size="sm" onClick={() => setRevealing(true)}>
                            <RouteIcon className="size-4" />
                            Reveal the GPS trail
                        </Button>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Tracking events</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        State changes and the connection log. No coordinates, so this needs no
                        reason and is not recorded.
                    </p>

                    {events.isLoading ? (
                        <InlineLoader />
                    ) : events.error ? (
                        <TrackingDoorNotice
                            error={events.error}
                            onRetry={events.reload}
                            subject="this delivery's tracking events"
                        />
                    ) : events.data ? (
                        <div className="space-y-4">
                            <SessionList sessions={events.data.sessions} timeZone={timeZone} />

                            <section className="space-y-2">
                                <h3 className="text-sm font-medium">State changes</h3>
                                {events.data.transitions.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No state changes recorded.
                                    </p>
                                ) : (
                                    <ul className="space-y-1 text-sm">
                                        {events.data.transitions.map((transition, index) => (
                                            <li
                                                key={`${transition.sessionId}:${transition.occurredAt}:${index}`}
                                                className="flex flex-wrap items-baseline gap-2"
                                            >
                                                <span className="text-muted-foreground">
                                                    {formatInstantInZone(
                                                        transition.occurredAt,
                                                        timeZone,
                                                    )}
                                                </span>
                                                <span>
                                                    {humaniseEnum(transition.from ?? '') ?? '—'} →{' '}
                                                    {humaniseEnum(transition.to ?? '') ?? '—'}
                                                </span>
                                                {transition.trigger ? (
                                                    <Badge variant="outline">
                                                        {humaniseEnum(transition.trigger)}
                                                    </Badge>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            <section className="space-y-2">
                                <h3 className="text-sm font-medium">Connections</h3>
                                {events.data.connections.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No connections recorded.
                                    </p>
                                ) : (
                                    <>
                                        {/*
                                          Several rows on ONE session means one
                                          delivery whose courier's phone dropped
                                          and came back — not several deliveries.
                                          Said here because the count reads the
                                          other way at a glance.
                                        */}
                                        <p className="text-muted-foreground text-xs">
                                            {formatCount(events.data.connections.length)}{' '}
                                            connection
                                            {events.data.connections.length === 1 ? '' : 's'} across{' '}
                                            {formatCount(events.data.sessions.length)} session
                                            {events.data.sessions.length === 1 ? '' : 's'}. More
                                            than one on a session means the courier&rsquo;s phone
                                            dropped and reconnected.
                                        </p>
                                        <ul className="space-y-1 text-sm">
                                            {events.data.connections.map((connection, index) => (
                                                <li
                                                    key={`${connection.sessionId}:${connection.connectedAt}:${index}`}
                                                    className="flex flex-wrap items-baseline gap-2"
                                                >
                                                    <span className="text-muted-foreground">
                                                        {formatInstantInZone(
                                                            connection.connectedAt,
                                                            timeZone,
                                                        )}
                                                    </span>
                                                    <span>
                                                        {connection.disconnectedAt
                                                            ? `until ${formatInstantInZone(connection.disconnectedAt, timeZone)}`
                                                            : 'still connected'}
                                                    </span>
                                                    {connection.endReason ? (
                                                        <Badge variant="outline">
                                                            {humaniseEnum(connection.endReason)}
                                                        </Badge>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </section>

                            {events.data.truncated ? (
                                <TruncatedNotice limit={events.data.limit} noun="events" />
                            ) : null}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <RevealPositionDialog
                open={revealing}
                onOpenChange={setRevealing}
                title="Reveal this delivery’s GPS trail?"
                subject="this delivery's trail"
                disclosure="This shows the route a named courier travelled while carrying this delivery."
                onConfirm={async (reason) => {
                    setTrail(await getShipmentTrackingTrail(shipmentId, reason));
                }}
            />
        </div>
    );
}

/**
 * The trail, grouped by session.
 *
 * **Per session, not as one polyline** — a reassigned delivery has one session
 * per agent who carried it, and merging them would draw a line between two
 * different couriers' positions.
 */
function TrailReading({
    trail,
    timeZone,
    onAgain,
}: {
    trail: ShipmentTrackingTrail;
    timeZone: string;
    onAgain: () => void;
}) {
    const bySession = new Map<string, typeof trail.checkpoints>();
    for (const checkpoint of trail.checkpoints) {
        const list = bySession.get(checkpoint.sessionId) ?? [];
        list.push(checkpoint);
        bySession.set(checkpoint.sessionId, list);
    }

    return (
        <div className="space-y-4">
            {/*
              Named BEFORE the points, not after: a truncated trail presented as
              complete reads to an operator as a gap in the record itself.
            */}
            {trail.truncated ? <TruncatedNotice limit={trail.limit} noun="points" /> : null}

            <SessionList sessions={trail.sessions} timeZone={timeZone} />

            {bySession.size > 0 ? (
                <p className="text-muted-foreground text-xs">
                    Each point opens on Google&rsquo;s map in a small window, which names the
                    place. The coordinates travel to Google in the address bar, and the window is
                    reused &mdash; a second point steers the one already open.
                </p>
            ) : null}

            {bySession.size === 0 ? (
                <p className="text-muted-foreground text-sm">
                    No positions were recorded for this delivery.
                </p>
            ) : (
                [...bySession.entries()].map(([sessionId, checkpoints]) => (
                    <section key={sessionId} className="space-y-2">
                        <h3 className="text-sm font-medium">
                            {formatCount(checkpoints.length)} point
                            {checkpoints.length === 1 ? '' : 's'}
                            {checkpoints[0]?.agentId ? ` · agent ${checkpoints[0].agentId}` : ''}
                        </h3>
                        <div className="max-h-64 overflow-y-auto rounded-lg border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50 sticky top-0">
                                    <tr>
                                        <th className="px-3 py-1.5 text-left font-medium">When</th>
                                        <th className="px-3 py-1.5 text-left font-medium">
                                            Latitude
                                        </th>
                                        <th className="px-3 py-1.5 text-left font-medium">
                                            Longitude
                                        </th>
                                        <th className="px-3 py-1.5 text-left font-medium">Speed</th>
                                        <th className="px-3 py-1.5 text-left font-medium">
                                            <span className="sr-only">Open on a map</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {checkpoints.map((checkpoint, index) => (
                                        <tr
                                            key={`${checkpoint.recordedAt}:${index}`}
                                            className="border-t"
                                        >
                                            <td className="text-muted-foreground px-3 py-1.5">
                                                {formatInstantInZone(
                                                    checkpoint.recordedAt,
                                                    timeZone,
                                                )}
                                            </td>
                                            <td className="px-3 py-1.5">{checkpoint.lat}</td>
                                            <td className="px-3 py-1.5">{checkpoint.lng}</td>
                                            <td className="px-3 py-1.5">
                                                {checkpoint.speed ?? '—'}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                {/*
                                                  Icon-only, because this column
                                                  can run to thousands of rows and
                                                  a labelled button on each would
                                                  be the loudest thing on the
                                                  screen. The accessible name
                                                  carries the timestamp, so the
                                                  forty links in view are not
                                                  forty identical "Open"s.

                                                  Already latitude-first here —
                                                  no GeoJSON inversion on this
                                                  payload.
                                                */}
                                                <OpenInGoogleMaps
                                                    url={googleMapsUrl(
                                                        checkpoint.lat,
                                                        checkpoint.lng,
                                                    )}
                                                    iconOnly
                                                    label={`Open the ${
                                                        formatInstantInZone(
                                                            checkpoint.recordedAt,
                                                            timeZone,
                                                        ) ?? checkpoint.recordedAt
                                                    } point in Google Maps`}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ))
            )}

            <Button variant="outline" size="sm" onClick={onAgain}>
                <RotateCw className="size-4" />
                Read again
            </Button>
        </div>
    );
}

/** Shared by both cards — the sessions block has the same shape on each. */
function SessionList({
    sessions,
    timeZone,
}: {
    sessions: TrackingSession[];
    timeZone: string;
}) {
    if (sessions.length === 0) return null;

    return (
        <DefinitionList>
            <Definition
                label="Carried by"
                hint={
                    <InfoHint label="About sessions">
                        One session per courier who carried this delivery. More than one means it
                        was reassigned partway.
                    </InfoHint>
                }
            >
                <ul className="space-y-1 text-sm">
                    {sessions.map((session) => (
                        <li key={session.sessionId}>
                            {session.agentId ?? session.sessionId}
                            <span className="text-muted-foreground">
                                {' '}
                                · {formatInstantInZone(session.startedAt ?? null, timeZone) ?? '—'}
                                {session.endedAt
                                    ? ` — ${formatInstantInZone(session.endedAt, timeZone)}`
                                    : ' — ongoing'}
                            </span>
                            {session.terminalStatus ? (
                                <Badge variant="outline" className="ml-2">
                                    {humaniseEnum(session.terminalStatus)}
                                </Badge>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </Definition>
        </DefinitionList>
    );
}

/**
 * ⚠ **Never present a truncated answer as complete.** A silent cut at `limit`
 * reads to an operator as a gap in the record itself — which is a very different
 * conclusion about a delivery.
 */
function TruncatedNotice({ limit, noun }: { limit: number; noun: string }) {
    return (
        <div className="border-warning/30 bg-warning/10 rounded-lg border px-3 py-2 text-sm">
            <p className="font-medium">This is not the whole record.</p>
            <p className="text-muted-foreground">
                The answer was cut at {formatCount(limit)} {noun}. What is missing is the rest of
                the recording, not a gap in it.
            </p>
        </div>
    );
}
