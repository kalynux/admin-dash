import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Pencil, Users } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ArchivePlanDialog } from '@/components/billing/BillingWriteDialogs';
import { PlanFormDialog } from '@/components/billing/PlanFormDialog';
import { PlanLimitsPanel } from '@/components/billing/PlanLimitsPanel';
import { subscriptionColumns } from '@/components/billing/subscriptionColumns';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { PlanStateBadges } from '@/pages/billing/PlansList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { getPlan, listPlanSubscribers } from '@/services/billing.service';
import { useAdmin, useCan } from '@/store';
import { SUBSCRIPTION_SORT_DEFAULT, type Plan } from '@/types/billing.types';

/**
 * `GET /billing/plans/:planId` · `billing.plans.read`.
 *
 * ── This read returns archived tiers, deliberately ────────────────────────────
 * There is no `deletedAt` filter on it, so an archived plan opens and explains
 * itself rather than 404ing. That matters because an existing subscription can
 * still name one.
 *
 * ── And an archived tier can be neither edited nor archived again ─────────────
 * wi-admin's read sees archived rows; jovi-mall's writes filter them out. So both
 * affordances are **hidden** on one, with a sentence saying why — offering a
 * button whose only outcome is a platform refusal teaches an operator to distrust
 * the screen.
 */
export function PlanDetail() {
    const { planId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [editing, setEditing] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const plan = useAsyncData(`/billing/plans/${planId}#${reloadToken}`, (signal) =>
        getPlan(planId, { signal }),
    );

    function reconcile() {
        setReloadToken((token) => token + 1);
        setEditing(false);
        setArchiving(false);
    }

    if (plan.isLoading) {
        return (
            <PageContainer title="Plan">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!plan.data) {
        return (
            <PageContainer title="Plan">
                <div className="space-y-4">
                    <ErrorState
                        error={plan.error}
                        onRetry={plan.reload}
                        deniedTitle="No such plan"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = plan.data;
    const archived = record.archivedAt !== null;

    return (
        <PageContainer
            title={record.name}
            description={`${record.role} · ${record.code}`}
            actions={
                // Hidden on an archived tier: the platform's writes cannot see it.
                archived ? undefined : (
                    <div className="flex flex-wrap gap-2">
                        <Can permission="billing.plans.delete">
                            <Button variant="outline" onClick={() => setArchiving(true)}>
                                <Archive className="size-4" />
                                Archive
                            </Button>
                        </Can>
                        <Can permission="billing.plans.manage">
                            <Button onClick={() => setEditing(true)}>
                                <Pencil className="size-4" />
                                Edit
                            </Button>
                        </Can>
                    </div>
                )
            }
        >
            <div className="space-y-4">
                <BackLink />

                {archived ? <ArchivedNotice plan={record} timeZone={timeZone} /> : null}

                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="subscribers">Subscribers</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>The tier</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <DefinitionList>
                                    <Definition label="State">
                                        <PlanStateBadges plan={record} />
                                    </Definition>

                                    <Definition label="Price">
                                        <span className="font-medium tabular-nums">
                                            {formatMoney(record.price, record.currency)}
                                        </span>
                                    </Definition>

                                    <Definition label="Term">
                                        {record.termDays === null ? (
                                            /* Not "unknown" — this tier runs forever. */
                                            <span>Never expires</span>
                                        ) : (
                                            `${formatCount(record.termDays)} days`
                                        )}
                                    </Definition>

                                    <Definition label="Role">
                                        <Badge variant="outline" className="capitalize">
                                            {record.role}
                                        </Badge>
                                    </Definition>

                                    <Definition label="Catalog order">{record.sortOrder}</Definition>

                                    <Definition label="Created">
                                        {formatInstantInZone(record.createdAt, timeZone) ?? (
                                            <NotSet />
                                        )}
                                    </Definition>
                                </DefinitionList>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>What it allows</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <PlanLimitsPanel plan={record} />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="subscribers">
                        <SubscribersPanel planId={planId} timeZone={timeZone} can={can} />
                    </TabsContent>
                </Tabs>
            </div>

            {editing ? (
                <PlanFormDialog
                    plan={record}
                    open
                    onOpenChange={setEditing}
                    onSaved={reconcile}
                />
            ) : null}

            {archiving ? (
                <ArchivePlanDialog
                    plan={record}
                    open
                    onOpenChange={setArchiving}
                    onArchived={reconcile}
                />
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/billing"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to plans
        </Link>
    );
}

/**
 * Why the write affordances are absent.
 *
 * Stated rather than left to inference: two missing buttons look like a
 * permission problem, and this is not one.
 */
function ArchivedNotice({ plan, timeZone }: { plan: Plan; timeZone: string }) {
    return (
        <div className="bg-muted/40 space-y-2 rounded-lg border p-4 text-sm">
            <p className="font-medium">
                This tier was archived {formatInstantInZone(plan.archivedAt, timeZone) ?? ''}.
            </p>
            <p className="text-muted-foreground">
                It is no longer in the catalog and cannot be assigned. Everyone already on it keeps
                it until their term ends, which is why the row and its subscribers are still here.
            </p>
            <p className="text-muted-foreground">
                An archived tier cannot be edited or archived again — the platform&rsquo;s writes do
                not see it — so those actions are not offered.
            </p>
        </div>
    );
}

/** `GET /billing/plans/:planId/subscribers` — everyone on this tier. */
function SubscribersPanel({
    planId,
    timeZone,
    can,
}: {
    planId: string;
    timeZone: string;
    can: ReturnType<typeof useCan>;
}) {
    const [page, setPage] = useState(1);

    const query = { sort: SUBSCRIPTION_SORT_DEFAULT, page };
    const path = withQuery(`/billing/plans/${planId}/subscribers`, { ...query });
    const subscribers = useAsyncData(path, (signal) =>
        listPlanSubscribers(planId, query, { signal }),
    );

    // The plan is the subject of the page, so it needs no column of its own.
    const columns = useMemo(
        () => subscriptionColumns({ timeZone, can, showPlan: false }),
        [timeZone, can],
    );

    const meta = subscribers.data?.meta;

    return (
        <div className="space-y-4">
            <DataTable
                caption="Everyone on this tier"
                columns={columns}
                rows={subscribers.data?.data ?? []}
                rowKey={(row) => row.id}
                isLoading={subscribers.isLoading}
                isRefreshing={subscribers.isRefreshing}
                error={subscribers.error}
                onRetry={subscribers.reload}
                empty={
                    <EmptyState
                        icon={Users}
                        title="Nobody is on this tier"
                        description="No vendor, agency or agent holds a term on this plan."
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="subscribers"
                    isBusy={subscribers.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
