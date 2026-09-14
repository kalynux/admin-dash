import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';

import { ChangePlanDialog } from '@/components/billing/ChangePlanDialog';
import { subscriptionColumns } from '@/components/billing/subscriptionColumns';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listSubscriptions } from '@/services/billing.service';
import { useAdmin, useCan } from '@/store';
import {
    BILLING_MAX_RANGE_DAYS,
    PLAN_ROLES,
    SUBSCRIPTION_SORT_DEFAULT,
    SUBSCRIPTION_STATUSES,
    type Subscription,
    type SubscriptionListQuery,
} from '@/types/billing.types';

/**
 * `GET /billing/subscriptions` · `billing.plans.read` — every term, across every
 * owner kind.
 *
 * ── The one place a dangling plan reference shows ─────────────────────────────
 * `plan.code` is denormalised onto the subscription row while `plan.name` comes
 * from a lookup, so a term whose tier has been hard-removed answers with a code
 * and no name. That cannot happen on a plan's own subscriber tab, where the plan
 * is fixed by the path — this is the only screen where it surfaces.
 */

const FILTER_KEYS = [
    'status',
    'ownerType',
    'planCode',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: SUBSCRIPTION_SORT_DEFAULT } as const;

const ANY = 'any';

function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function SubscriptionsList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, BILLING_MAX_RANGE_DAYS) : false;

    const query: SubscriptionListQuery = {
        status: values.status || undefined,
        ownerType: values.ownerType || undefined,
        planCode: values.planCode || undefined,
        sort: values.sort || undefined,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/billing/subscriptions', { ...query });
    const subscriptions = useAsyncData(path, (signal) => listSubscriptions(query, { signal }));

    /**
     * The owner whose plan is being changed.
     *
     * `assignSubscription` and its dialog have existed since the billing phase
     * and were **reachable from nowhere** — `AssignPlanDialog` was imported by no
     * file, so a subscription could be listed and never assigned from the UI.
     * This row is the natural door: it already knows the owner, and
     * `ChangePlanDialog` supplies the half that was missing.
     */
    const [changing, setChanging] = useState<Subscription | null>(null);

    const canAssign = can('billing.subscriptions.assign');

    const columns = useMemo(
        () =>
            subscriptionColumns({
                timeZone,
                can,
                detailLink: true,
                rowAction: canAssign
                    ? (row) => (
                          <RowActions>
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setChanging(row)}
                              >
                                  Change plan
                              </Button>
                          </RowActions>
                      )
                    : undefined,
            }),
        [timeZone, can, canAssign],
    );

    const meta = subscriptions.data?.meta;

    return (
        <PageContainer
            title="Subscriptions"
            description="Who is on which tier, and when their term ends."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Status" htmlFor="subscription-status">
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="subscription-status" className="w-[190px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(SUBSCRIPTION_STATUSES, values.status || ANY).map(
                                    (value) => (
                                        <SelectItem
                                            key={value}
                                            value={value}
                                            className="capitalize"
                                        >
                                            {value.replace(/_/g, ' ')}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Owner kind" htmlFor="subscription-owner">
                        <Select
                            value={values.ownerType || ANY}
                            onValueChange={(next) => set({ ownerType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="subscription-owner" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any owner</SelectItem>
                                {PLAN_ROLES.map((role) => (
                                    <SelectItem key={role} value={role} className="capitalize">
                                        {role}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <DateRangeFilter
                        label="Created"
                        from={values.createdFrom}
                        to={values.createdTo}
                        onChange={(next) =>
                            set({ createdFrom: next.from || null, createdTo: next.to || null })
                        }
                        timeZone={timeZone}
                        maxDays={BILLING_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    {meta ? `${formatCount(meta.total)} subscriptions` : 'Subscriptions'}
                    <InfoHint label="About terms">
                        A term that never expires is the free default rather than an unknown end
                        date — which is also why filtering by an expiry date never returns one.
                    </InfoHint>
                </p>

                <DataTable
                    caption="Subscriptions across every owner"
                    columns={columns}
                    rows={subscriptions.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={subscriptions.isLoading}
                    isRefreshing={subscriptions.isRefreshing}
                    error={subscriptions.error}
                    onRetry={subscriptions.reload}
                    empty={
                        <EmptyState
                            icon={Users}
                            title="No subscriptions match"
                            description={
                                isFiltered
                                    ? 'No term matches these filters.'
                                    : 'Nobody is on a plan yet.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="subscriptions"
                        isBusy={subscriptions.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {/*
              Mounted only while open — `ChangePlanDialog` reads the plan
              catalogue on mount, and a permanently-mounted copy would fetch it on
              every page load for a control most visits never touch.
            */}
            {changing ? (
                <ChangePlanDialog
                    ownerType={changing.owner.type}
                    ownerId={changing.owner.id}
                    ownerName={changing.owner.name}
                    open
                    onOpenChange={(open) => !open && setChanging(null)}
                    onAssigned={() => {
                        setChanging(null);
                        subscriptions.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
