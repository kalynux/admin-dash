import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { PayoutActivityPanel } from '@/components/money/PayoutActivityPanel';
import { PayoutOriginBadge, PayoutStatusBadge } from '@/components/money/PayoutBadges';
import { PayoutDestinationReveal } from '@/components/money/PayoutDestinationReveal';
import {
    MarkPaidDialog,
    MarkPaidQueuedNotice,
    RejectPayoutDialog,
} from '@/components/money/PayoutWriteDialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { getPayout, PAYOUT_ACTIVITY_PERMISSIONS } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import type { Approval } from '@/types/approvals.types';
import { isPlatformActor } from '@/types/actor.types';
import { ACCOUNT_READ_PERMISSIONS } from '@/services/accounts.service';
import type { Payout } from '@/types/money.types';

/**
 * `GET /money/payouts/:payoutId` · `money.payouts.read`.
 *
 * The screen where money is released or refused, and the only place on this
 * dashboard that can disclose a beneficiary's account number.
 *
 * ── Why the write buttons check `status` as well as the permission ────────────
 * This departs from `OrderDetail`, which always offers its actions and lets the
 * platform re-evaluate. There, the guards are jovi-mall's and invisible from the
 * row; here the status is on the record this page is rendering and wi-admin
 * pre-flights it, so offering "Mark paid" on a payout the screen shows as *paid*
 * is nonsense. The `409` is still handled — somebody else can resolve it between
 * load and click.
 */
export function PayoutDetail() {
    const { payoutId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [reloadToken, setReloadToken] = useState(0);
    const [markPaidOpen, setMarkPaidOpen] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [queued, setQueued] = useState<{ approval: Approval; message?: string } | null>(null);
    const [activityAction, setActivityAction] = useState<string | undefined>(undefined);

    const payout = useAsyncData(`/money/payouts/${payoutId}`, (signal) =>
        getPayout(payoutId, { signal }),
    );

    /** Re-read the record and bump the feed, rather than merging a delegated write's answer. */
    function reconcile() {
        payout.reload();
        setReloadToken((token) => token + 1);
        setMarkPaidOpen(false);
        setRejectOpen(false);
    }

    if (payout.isLoading) {
        return (
            <PageContainer title="Payout">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!payout.data) {
        return (
            <PageContainer title="Payout">
                <div className="space-y-4">
                    <ErrorState
                        error={payout.error}
                        onRetry={payout.reload}
                        deniedTitle="No such payout"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = payout.data;
    const isPending = record.status === 'pending';
    const canSeeActivity = can(PAYOUT_ACTIVITY_PERMISSIONS, 'all');

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`Payout to ${record.owner.name ?? record.owner.type}`}
            actions={
                isPending ? (
                    <div className="flex flex-wrap gap-2">
                        <Can permission="money.payouts.reject">
                            <Button variant="outline" onClick={() => setRejectOpen(true)}>
                                Reject
                            </Button>
                        </Can>
                        <Can permission="money.payouts.mark_paid">
                            <Button onClick={() => setMarkPaidOpen(true)}>Mark paid</Button>
                        </Can>
                    </div>
                ) : undefined
            }
        >
            <div className="space-y-4">
                <BackLink />

                {queued ? (
                    <MarkPaidQueuedNotice
                        approval={queued.approval}
                        message={queued.message}
                        timeZone={timeZone}
                    />
                ) : null}

                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        {/* A tab that could only ever show a refusal is not rendered. */}
                        {canSeeActivity ? (
                            <TabsTrigger value="activity">Activity</TabsTrigger>
                        ) : null}
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                        <RequestCard record={record} timeZone={timeZone} />

                        <PayoutDestinationReveal
                            payoutId={record.id}
                            destination={record.destination}
                            timeZone={timeZone}
                            onShowDisclosures={
                                canSeeActivity
                                    ? () => {
                                          setActivityAction('money.payouts.destination.read');
                                          setTab('activity');
                                      }
                                    : undefined
                            }
                        />

                        <ResolutionCard record={record} timeZone={timeZone} />
                    </TabsContent>

                    {canSeeActivity ? (
                        <TabsContent value="activity">
                            <PayoutActivityPanel
                                payoutId={record.id}
                                timeZone={timeZone}
                                reloadToken={reloadToken}
                                initialAction={activityAction}
                            />
                        </TabsContent>
                    ) : null}
                </Tabs>
            </div>

            {isPending ? (
                <>
                    <MarkPaidDialog
                        payout={record}
                        open={markPaidOpen}
                        onOpenChange={setMarkPaidOpen}
                        onPaid={reconcile}
                        onQueued={(approval, message) => {
                            setQueued({ approval, message });
                            // Still reconcile: nothing was paid, so the payout must
                            // re-read as pending rather than look acted upon.
                            reconcile();
                        }}
                    />
                    <RejectPayoutDialog
                        payout={record}
                        open={rejectOpen}
                        onOpenChange={setRejectOpen}
                        onRejected={reconcile}
                    />
                </>
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/money/payouts"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to payouts
        </Link>
    );
}

function RequestCard({ record, timeZone }: { record: Payout; timeZone: string }) {
    const can = useCan();
    const { owner } = record;

    const directory =
        owner.type === 'vendor' && can('vendors.read') && owner.id
            ? `/dashboard/vendors/${owner.id}`
            : owner.type === 'agency' && can('agencies.read') && owner.id
              ? `/dashboard/agencies/${owner.id}`
              : owner.type === 'agent' && can('agents.read') && owner.id
                ? `/dashboard/agents/${owner.id}`
                : null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Amount">
                        <span className="font-medium tabular-nums">
                            {formatMoney(record.amount, record.currency)}
                        </span>
                    </Definition>

                    <Definition label="Status">
                        <PayoutStatusBadge status={record.status} />
                    </Definition>

                    <Definition
                        label="Opened by"
                        hint={
                            <InfoHint label="About payout origin">
                                A request the owner made, versus one the platform opened
                                automatically once their available balance reached the payout
                                threshold — in which case nobody asked for it.
                            </InfoHint>
                        }
                    >
                        <PayoutOriginBadge origin={record.origin} />
                    </Definition>

                    <Definition label="Beneficiary">
                        <span className="flex flex-wrap items-center gap-2">
                            {directory ? (
                                <Link to={directory} className="font-medium hover:underline">
                                    {owner.name ?? owner.id}
                                </Link>
                            ) : (
                                <span className="font-medium">{owner.name ?? owner.id}</span>
                            )}
                            <span className="text-muted-foreground text-xs capitalize">
                                {owner.type}
                            </span>
                        </span>
                    </Definition>

                    <Definition label="Their account">
                        {/*
                          The composed account view needs three permissions; this
                          screen needs one. The link is offered only where it
                          leads somewhere.
                        */}
                        {owner.id && can(ACCOUNT_READ_PERMISSIONS, 'all') ? (
                            <Link
                                to={`/dashboard/accounts/${owner.type}/${owner.id}`}
                                className="hover:underline"
                            >
                                Open the account
                            </Link>
                        ) : (
                            <NotSet>Not available to you</NotSet>
                        )}
                    </Definition>

                    <Definition label="Requested">
                        {formatInstantInZone(record.createdAt, timeZone) ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function ResolutionCard({ record, timeZone }: { record: Payout; timeZone: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Resolution</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Resolved">
                        {record.resolvedAt ? (
                            formatInstantInZone(record.resolvedAt, timeZone)
                        ) : (
                            /* Nobody has resolved it — not the same as unknown. */
                            <NotSet>Not resolved</NotSet>
                        )}
                    </Definition>

                    <Definition label="Resolved by">
                        {record.resolvedBy ? (
                            <span>
                                {record.resolvedBy.name ?? 'Not recorded'}
                                {!isPlatformActor(record.resolvedBy) ? (
                                    <span className="text-muted-foreground"> · administrator</span>
                                ) : null}
                            </span>
                        ) : (
                            <NotSet>Nobody yet</NotSet>
                        )}
                    </Definition>

                    <Definition label="Transfer reference">
                        {record.paidReference ?? <NotSet />}
                    </Definition>

                    <Definition label="Rejection reason">
                        {record.rejectionReason ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}
