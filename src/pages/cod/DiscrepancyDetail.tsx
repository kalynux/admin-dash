import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import {
    CodSettlementStatusBadge,
    DepositRecipientBadge,
    DiscrepancyStatusBadge,
    RaisedByBadge,
} from '@/components/cod/CodBadges';
import { ResolveDiscrepancyDialog } from '@/components/cod/CodWriteDialogs';
import { trustEventColumns } from '@/components/cod/TrustEventsTable';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getDiscrepancy } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import {
    COD_EMBEDDED_LIMIT,
    DISCREPANCY_TYPE_DESCRIPTIONS,
    isUnresolved,
    type Deposit,
    type DiscrepancyDetail as Flag,
} from '@/types/cod.types';

/**
 * `GET /cod/discrepancies/:discrepancyId` · `cod.discrepancies.read`.
 *
 * The flag, the deposit it names, and the trust it cost.
 *
 * ── An empty trust list is the system working, not a gap ──────────────────────
 * `deposit_not_confirmed` is the **agency's** failure and deliberately carries no
 * agent penalty; `late_deposit` costs the agent **once**, however many agencies
 * are owed. So the empty state here says which of those is true rather than
 * leaving a blank that reads as a missing join.
 */
export function DiscrepancyDetail() {
    const { discrepancyId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [resolving, setResolving] = useState(false);

    const discrepancy = useAsyncData(`/cod/discrepancies/${discrepancyId}`, (signal) =>
        getDiscrepancy(discrepancyId, { signal }),
    );

    function reconcile() {
        discrepancy.reload();
        setResolving(false);
    }

    if (discrepancy.isLoading) {
        return (
            <PageContainer title="Discrepancy">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!discrepancy.data) {
        return (
            <PageContainer title="Discrepancy">
                <div className="space-y-4">
                    <ErrorState
                        error={discrepancy.error}
                        onRetry={discrepancy.reload}
                        deniedTitle="No such discrepancy"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = discrepancy.data;
    const open = isUnresolved(record);

    return (
        <PageContainer
            // `title` also names the tab and the route announcement, so it has
            // to be a string — an absent type falls back to the noun, never "—".
            title={humaniseEnum(record.type) ?? 'Discrepancy'}
            description={
                record.amount === null
                    ? 'A flag with no amount at stake.'
                    : `${formatMoney(record.amount, record.currency)} at stake.`
            }
            actions={
                open ? (
                    <Can permission="cod.discrepancies.resolve">
                        <Button onClick={() => setResolving(true)}>Close this flag</Button>
                    </Can>
                ) : undefined
            }
        >
            <div className="space-y-4">
                <BackLink />

                <FlagCard record={record} timeZone={timeZone} />

                {/*
                  Rendered only when there is one: `deposit` is null on a flag
                  that names none, which is most of them.
                */}
                {record.deposit ? (
                    <DepositCard deposit={record.deposit} timeZone={timeZone} />
                ) : null}

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-1">
                            Trust movements
                            <InfoHint label="About trust movements">
                                What this flag cost the agent&rsquo;s conduct score, which bounds
                                how much cash they may carry. Often none, and that is the system
                                working: an unconfirmed deposit is the agency&rsquo;s failure, and
                                a late deposit costs the agent once however many agencies are
                                owed. Oldest first, capped at {COD_EMBEDDED_LIMIT}.
                            </InfoHint>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <DataTable
                            caption="Trust score movements caused by this discrepancy"
                            columns={trustEventColumns({
                                timeZone,
                                can,
                                currentDiscrepancyId: record.id,
                            })}
                            rows={record.trustEvents}
                            rowKey={(row) => row.id}
                            isLoading={false}
                            empty={
                                <EmptyState
                                    title="No penalty was taken"
                                    description="This flag cost the agent nothing — which for an unconfirmed deposit is deliberate, since that is the agency's failure rather than theirs."
                                />
                            }
                        />

                        {record.trustEvents.length >= COD_EMBEDDED_LIMIT ? (
                            <p className="text-muted-foreground text-xs">
                                Showing the first {formatCount(COD_EMBEDDED_LIMIT)}. There may be
                                more.
                            </p>
                        ) : null}
                    </CardContent>
                </Card>
            </div>

            {open ? (
                <ResolveDiscrepancyDialog
                    discrepancy={record}
                    open={resolving}
                    onOpenChange={setResolving}
                    onDone={reconcile}
                />
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/cod/discrepancies"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All discrepancies
        </Link>
    );
}

function FlagCard({ record, timeZone }: { record: Flag; timeZone: string }) {
    const can = useCan();

    return (
        <Card>
            <CardHeader>
                <CardTitle>The flag</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/*
                  Rendered from a lookup with no fallback text: the vocabulary is
                  the platform's and has grown before, so an unrecognised kind
                  shows the raw value above and simply no explanation here.
                */}
                {DISCREPANCY_TYPE_DESCRIPTIONS[record.type] ? (
                    <p className="text-muted-foreground text-sm">
                        {DISCREPANCY_TYPE_DESCRIPTIONS[record.type]}
                    </p>
                ) : null}

                <DefinitionList>
                    <Definition label="Status">
                        <DiscrepancyStatusBadge status={record.status} />
                    </Definition>

                    <Definition
                        label="At stake"
                        hint={
                            <InfoHint label="About the amount">
                                A flag can be non-monetary — an unconfirmed hand-over, say — in
                                which case it names no amount at all. That is not the same as an
                                amount of zero.
                            </InfoHint>
                        }
                    >
                        {record.amount === null ? (
                            <NotApplicable>Nothing monetary</NotApplicable>
                        ) : (
                            <span className="font-medium tabular-nums">
                                {formatMoney(record.amount, record.currency)}
                            </span>
                        )}
                    </Definition>

                    <Definition
                        label="Raised by"
                        hint={
                            <InfoHint label="About who raised this">
                                Most are detected automatically. One raised by the{' '}
                                <strong>agent</strong> is a dispute — they are contesting
                                something, and it deserves reading differently from a
                                system-detected break.
                            </InfoHint>
                        }
                    >
                        <RaisedByBadge raisedBy={record.raisedBy} />
                    </Definition>

                    <Definition label="Agent">
                        <PartyValue
                            label="Agent"
                            name={record.agent.name}
                            id={record.agent.id}
                            to={can('agents.read') ? `/dashboard/agents/${record.agent.id}` : null}
                        />
                    </Definition>

                    <Definition label="Agency">
                        <PartyValue
                            label="Agency"
                            name={record.agency.name}
                            id={record.agency.id}
                            to={
                                can('agencies.read')
                                    ? `/dashboard/agencies/${record.agency.id}`
                                    : null
                            }
                        />
                    </Definition>

                    <Definition label="Note">{record.note ?? <NotSet />}</Definition>

                    <Definition label="Opened">
                        {formatInstantInZone(record.openedAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition label="Raised">
                        {formatInstantInZone(record.createdAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition label="Closed">
                        {formatInstantInZone(record.resolvedAt, timeZone) ?? (
                            <NotSet>Still open</NotSet>
                        )}
                    </Definition>

                    <Definition label="Closing note">
                        {record.resolutionNote ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/**
 * The deposit this flag is about.
 *
 * A summary rather than a second detail screen — the deposit has one of its own,
 * and this links to it where the caller may open it. `cod.discrepancies.read` does
 * not imply `cod.deposits.read`, so the link is conditional and the facts are not.
 */
function DepositCard({ deposit, timeZone }: { deposit: Deposit; timeZone: string }) {
    const can = useCan();

    return (
        <Card>
            <CardHeader>
                <CardTitle>The deposit at issue</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Amount">
                        <span className="font-medium tabular-nums">
                            {formatMoney(deposit.amount, deposit.currency)}
                        </span>
                    </Definition>

                    <Definition label="Status">
                        <CodSettlementStatusBadge status={deposit.status} />
                    </Definition>

                    <Definition label="Handed to">
                        <DepositRecipientBadge recipient={deposit.recipient} />
                    </Definition>

                    <Definition label="Reference">
                        {/* `plain` — reconciled against a statement, never shortened. */}
                        {deposit.reference ? (
                            <CopyableValue
                                variant="plain"
                                mono
                                value={deposit.reference}
                                label="deposit reference"
                            />
                        ) : (
                            <NotSet>None given</NotSet>
                        )}
                    </Definition>

                    <Definition label="Declared">
                        {formatInstantInZone(deposit.declaredAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition label="The record">
                        {can('cod.deposits.read') ? (
                            <Link
                                to={`/dashboard/cod/deposits/${deposit.id}`}
                                className="hover:underline"
                            >
                                Open the deposit
                            </Link>
                        ) : (
                            <NotSet>Not available to you</NotSet>
                        )}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/**
 * ⚠ Only the **no-name** branch becomes a `CopyableValue`. Where a name arrived
 * it is rendered exactly as before — pairing a name with its id belongs to
 * `partyName()`, not to this sweep.
 *
 * `truncate={false}` because this is a detail screen and the id is shown whole
 * today; only the list version of this shortens.
 */
function PartyValue({
    name,
    id,
    to,
    label,
}: {
    name: string | null;
    id: string;
    to: string | null;
    label: string;
}) {
    if (!name) {
        return (
            <CopyableValue
                value={id}
                label={`${label.toLowerCase()} ID`}
                to={to ?? undefined}
                truncate={false}
            />
        );
    }

    return to ? (
        <Link to={to} className="font-medium hover:underline">
            {name}
        </Link>
    ) : (
        <span className="font-medium">{name}</span>
    );
}
