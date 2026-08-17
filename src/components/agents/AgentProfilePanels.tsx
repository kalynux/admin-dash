import { useState } from 'react';

import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { isPlatformActor, type ActorStamp } from '@/types/actor.types';
import type { AgentDetail } from '@/types/agents.types';
import { CopyableId } from '@/components/common/CopyableId';

/**
 * The read-only panels of an agent's detail screen.
 *
 * ── Where the snake_case comes from ───────────────────────────────────────────
 * `vehicle`, `device` and `trustSignals` ship with **storage casing** — wi-admin's
 * controller assigns the Mongo sub-document whole rather than mapping it field by
 * field, so `README.md`'s camelCase promise leaks here. They are typed and read as
 * they actually ship; if the backend fixes the mapper these break loudly, which is
 * the right failure mode. Recorded in `docs/dashboard/DATA-EXPOSURE-REGISTER.md`.
 */

/** Identity, the reason for a status, and the two blocks that are state-keyed. */
export function AgentOverviewPanel({
    agent,
    timeZone,
}: {
    agent: AgentDetail;
    timeZone: string;
}) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Identity</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Name">{agent.name ?? <NotSet />}</Definition>
                        <Definition label="Email">
                            {agent.email ? (
                                <span className="flex flex-wrap items-center gap-2">
                                    {agent.email}
                                    {agent.emailVerified ? (
                                        <Badge variant="outline">Verified</Badge>
                                    ) : null}
                                </span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Phone">
                            {agent.phone ? (
                                <span className="flex flex-wrap items-center gap-2">
                                    {agent.phone}
                                    {agent.phoneVerified ? (
                                        <Badge variant="outline">Verified</Badge>
                                    ) : null}
                                </span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Agent id">
                            <CopyableId value={agent.id} label="agent ID" />
                        </Definition>
                        <Definition
                            label="Platform user id"
                            hint={
                                <InfoHint label="About the user id">
                                    An agent is a role on a platform user account. This is that
                                    account.
                                </InfoHint>
                            }
                        >
                            <CopyableId value={agent.userId} label="user ID" />
                        </Definition>
                        <Definition label="Onboarding">
                            {agent.onboardingComplete ? 'Complete' : 'In progress'}
                        </Definition>
                        <Definition label="Timezone">{agent.timezone ?? <NotSet />}</Definition>
                        <Definition label="Language">
                            {agent.preferredLanguage ?? <NotSet />}
                        </Definition>
                        <Definition label="Joined">
                            {formatInstantInZone(agent.createdAt, timeZone) ?? '—'}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Account status</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Status">
                            <span className="capitalize">{agent.status}</span>
                        </Definition>
                        <Definition label="Reason">{agent.statusReason ?? <NotSet />}</Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            {/*
              Present only while banned — the backend clears the block otherwise, and
              rendering a stale approver beside "not banned" would read as a
              contradiction rather than as history.
            */}
            <Card>
                <CardHeader>
                    <CardTitle>Platform ban</CardTitle>
                </CardHeader>
                <CardContent>
                    {agent.ban.banned ? (
                        <DefinitionList>
                            <Definition label="Reason">
                                {agent.ban.reason ?? <NotSet />}
                            </Definition>
                            <Definition label="Banned at">
                                {formatInstantInZone(agent.ban.bannedAt, timeZone) ?? '—'}
                            </Definition>
                            <Definition label="By">
                                <ActorLine actor={agent.ban.by} />
                            </Definition>
                        </DefinitionList>
                    ) : (
                        <p className="text-sm">
                            Not banned. A ban outranks every other axis — while one stands, the
                            agent is unusable even if a contract reads active.
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Identity documents</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="State">
                            <span className="capitalize">{agent.kyc.status ?? 'unverified'}</span>
                        </Definition>
                        <Definition
                            label="Reference"
                            hint={
                                <InfoHint label="About the reference">
                                    A free-form pointer to whatever document set was checked
                                    off-platform. This service stores no documents.
                                </InfoHint>
                            }
                        >
                            {agent.kyc.reference ?? <NotSet />}
                        </Definition>
                        <Definition label="Rejection reason">
                            {agent.kyc.rejectionReason ?? <NotSet />}
                        </Definition>
                        {/*
                          `verifiedAt` and `verifiedBy` are present only while the state
                          is `verified`. Keyed on the status rather than on the field so
                          a rejected agent carrying a stale approver cannot read as
                          approved.
                        */}
                        {agent.kyc.status === 'verified' ? (
                            <>
                                <Definition label="Verified at">
                                    {formatInstantInZone(agent.kyc.verifiedAt, timeZone) ?? '—'}
                                </Definition>
                                <Definition label="Verified by">
                                    <ActorLine actor={agent.kyc.verifiedBy} />
                                </Definition>
                            </>
                        ) : null}
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Where they work</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition
                            label="Home base"
                            hint={
                                <InfoHint label="About the home base">
                                    The area an agent works out of — a label only. The residence
                                    point behind it is never sent by the service, so there is
                                    nothing here to reveal.
                                </InfoHint>
                            }
                        >
                            {agent.homeBase.label ?? <NotSet />}
                        </Definition>
                        <Definition label="Service radius">
                            {agent.homeBase.serviceRadiusKm === null ? (
                                <NotSet />
                            ) : (
                                `${agent.homeBase.serviceRadiusKm} km`
                            )}
                        </Definition>
                        <Definition label="Vehicle">
                            {agent.vehicle ? (
                                [
                                    agent.vehicle.vehicle_type,
                                    agent.vehicle.color,
                                    agent.vehicle.plate_number,
                                ]
                                    .filter(Boolean)
                                    .join(' · ') || <NotSet />
                            ) : (
                                <NotSet>No vehicle on file</NotSet>
                            )}
                        </Definition>
                        <Definition label="Auto-accepts assignments">
                            {agent.settings.autoAcceptAssignments ? 'Yes' : 'No'}
                        </Definition>
                        <Definition label="Navigation app">
                            {agent.settings.navigationApp ?? <NotSet />}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * Capacity, the two agent-and-system axes, the conduct record, and the device.
 *
 * The device block is **collapsed by default and framed as dispatch diagnostics**,
 * because that is what it is for: an agent whose location services are off cannot
 * be offered work, and `device_location_disabled` is a real ineligibility reason.
 * It is still an eight-field fingerprint of a named person's phone, so it is not
 * something to open by accident.
 */
export function AgentOperationalPanel({
    agent,
    timeZone,
}: {
    agent: AgentDetail;
    timeZone: string;
}) {
    const [showDevice, setShowDevice] = useState(false);
    const signals = agent.trustSignals;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Capacity</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition
                            label="Active shipments"
                            hint={
                                <InfoHint label="About the active count">
                                    The authoritative count the accept path compare-and-sets on.
                                    The working state beside it is recomputed from a different
                                    input and can lag it by a moment — that is not a bug, and the
                                    two are shown separately rather than reconciled here.
                                </InfoHint>
                            }
                        >
                            {formatCount(agent.capacity.active)} of{' '}
                            {formatCount(agent.capacity.max)}
                        </Definition>
                        <Definition label="Reconciled at">
                            {formatInstantInZone(agent.capacity.reconciledAt, timeZone) ?? '—'}
                        </Definition>
                        <Definition label="Availability">
                            <span className="capitalize">
                                {agent.operational.availability ?? 'unknown'}
                            </span>
                        </Definition>
                        <Definition label="Availability changed">
                            {formatInstantInZone(
                                agent.operational.availabilityChangedAt,
                                timeZone,
                            ) ?? '—'}
                        </Definition>
                        <Definition label="Working state">
                            <span className="capitalize">
                                {(agent.operational.workingState ?? 'unknown').replace(/_/g, ' ')}
                            </span>
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Conduct record</CardTitle>
                </CardHeader>
                <CardContent>
                    {signals ? (
                        <DefinitionList>
                            <Definition label="On-time rate">
                                <Rate value={signals.on_time_rate} />
                            </Definition>
                            <Definition label="Assignment response rate">
                                <Rate value={signals.assignment_response_rate} />
                            </Definition>
                            <Definition label="Completed shipments">
                                <Count value={signals.completed_shipments} />
                            </Definition>
                            <Definition label="Customer rating">
                                <Rating
                                    average={signals.customer_rating_avg}
                                    count={signals.customer_rating_count}
                                />
                            </Definition>
                            <Definition label="Agency rating">
                                <Rating
                                    average={signals.agency_rating_avg}
                                    count={signals.agency_rating_count}
                                />
                            </Definition>
                            <Definition label="Vendor rating">
                                <Rating
                                    average={signals.vendor_rating_avg}
                                    count={signals.vendor_rating_count}
                                />
                            </Definition>
                            <Definition label="Clean cash returns">
                                <Count value={signals.cod_clean_return_count} />
                            </Definition>
                            <Definition label="Cash discrepancies">
                                <Count value={signals.cod_discrepancy_count} />
                            </Definition>
                            <Definition label="Cash volume returned">
                                {/* No currency accompanies this field anywhere — the
                                    number is printed without a symbol. */}
                                <Count value={signals.cod_volume_returned} />
                            </Definition>
                            <Definition label="Computed at">
                                {formatInstantInZone(signals.computed_at ?? null, timeZone) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    ) : (
                        <p className="text-sm">
                            <NotApplicable>
                                No conduct record has been computed for this agent yet.
                            </NotApplicable>
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Dispatch diagnostics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        Whether this agent&apos;s phone can be dispatched to. Location services
                        being off is a real reason an agent is refused work, which is why this is
                        here — but it is device telemetry about a named person, so it is not shown
                        by default.
                    </p>

                    {agent.device === null ? (
                        <p className="text-sm">
                            <NotSet>This agent&apos;s device has never reported in.</NotSet>
                        </p>
                    ) : showDevice ? (
                        <DefinitionList>
                            <Definition label="Platform">
                                {agent.device.platform ?? <NotSet />}
                            </Definition>
                            <Definition label="App version">
                                {agent.device.app_version ?? <NotSet />}
                            </Definition>
                            <Definition label="Location permission">
                                {agent.device.location_permission ?? <NotSet />}
                            </Definition>
                            <Definition label="Location services">
                                <YesNo value={agent.device.location_services_enabled} />
                            </Definition>
                            <Definition label="Background location">
                                <YesNo value={agent.device.background_location_enabled} />
                            </Definition>
                            <Definition label="Exempt from battery optimisation">
                                <YesNo value={agent.device.battery_optimization_exempt} />
                            </Definition>
                            <Definition label="Push notifications">
                                <YesNo value={agent.device.push_enabled} />
                            </Definition>
                            <Definition label="Reported at">
                                {formatInstantInZone(agent.device.reported_at ?? null, timeZone) ??
                                    '—'}
                            </Definition>
                        </DefinitionList>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowDevice(true)}
                        >
                            Show dispatch diagnostics
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * An actor stamp.
 *
 * An `'admin'` id resolves only in the wi-admin database — not in any platform
 * directory — so it is rendered as a name and never linked. The name is a
 * write-time snapshot and the only readable record of who acted.
 */
function ActorLine({ actor }: { actor: ActorStamp | null }) {
    if (!actor) return <NotSet />;

    return (
        <span className="flex flex-wrap items-center gap-2">
            {actor.name ?? 'Not recorded'}
            {isPlatformActor(actor) ? null : <Badge variant="outline">administrator</Badge>}
        </span>
    );
}

function Rate({ value }: { value: number | null | undefined }) {
    if (value === null || value === undefined) return <NotSet>Not computed</NotSet>;
    // Stored as a fraction; shown as a percentage without inventing precision.
    return <>{Math.round(value * 100)}%</>;
}

function Count({ value }: { value: number | null | undefined }) {
    if (value === null || value === undefined) return <NotSet>Not computed</NotSet>;
    return <>{formatCount(value)}</>;
}

function Rating({
    average,
    count,
}: {
    average: number | null | undefined;
    count: number | null | undefined;
}) {
    if (average === null || average === undefined) return <NotSet>No ratings</NotSet>;
    return (
        <>
            {average.toFixed(1)}
            {count ? (
                <span className="text-muted-foreground"> · {formatCount(count)} ratings</span>
            ) : null}
        </>
    );
}

function YesNo({ value }: { value: boolean | null | undefined }) {
    if (value === null || value === undefined) return <NotSet>Not reported</NotSet>;
    return <>{value ? 'Yes' : 'No'}</>;
}
