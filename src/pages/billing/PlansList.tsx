import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { PlanFormDialog } from '@/components/billing/PlanFormDialog';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { formatCount, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listPlans } from '@/services/billing.service';
import {
    PLAN_ROLES,
    PLAN_SORT_DEFAULT,
    type Plan,
    type PlanListQuery,
} from '@/types/billing.types';

/**
 * `GET /billing/plans` · `billing.plans.read` — the subscription catalog.
 *
 * ── Sorted by `sortOrder`, ascending, by default ──────────────────────────────
 * Not `-createdAt` like every other list on this service. `sortOrder` is the
 * field the platform put there to say what order these tiers belong in, and a
 * catalog listed newest-first shows them in whatever order somebody happened to
 * create them.
 *
 * ── Archived tiers are excluded, not gone ─────────────────────────────────────
 * Existing subscribers keep running on an archived tier, so "which plan is this
 * vendor on" can legitimately name a row this list hides by default. The toggle
 * brings them back, and an archived row is marked — because **an archived tier
 * can be neither edited nor archived again**, and those affordances disappear
 * with it.
 */

const FILTER_KEYS = ['search', 'role', 'isActive', 'includeArchived', 'sort'] as const;
const FILTER_DEFAULTS = { sort: PLAN_SORT_DEFAULT } as const;

const ANY = 'any';

export function PlansList() {
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<Plan | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const includeArchived = values.includeArchived === 'true';

    const query: PlanListQuery = {
        search: values.search || undefined,
        role: values.role || undefined,
        isActive: values.isActive === '' ? undefined : values.isActive === 'true' ? true : undefined,
        ...(includeArchived ? { includeArchived: true } : {}),
        sort: values.sort || undefined,
        page,
    };

    const path = withQuery('/billing/plans', { ...query });
    const plans = useAsyncData(`${path}#${reloadToken}`, (signal) => listPlans(query, { signal }));

    function reconcile() {
        setReloadToken((token) => token + 1);
        setCreating(false);
        setEditing(null);
    }

    const columns = useMemo<Column<Plan>[]>(
        () => [
            {
                id: 'name',
                header: 'Plan',
                sortKey: 'name',
                className: 'align-top',
                cell: (plan) => (
                    <div className="min-w-0 space-y-1">
                        <Link
                            to={`/dashboard/billing/${plan.id}`}
                            className="font-medium hover:underline"
                        >
                            {plan.name}
                        </Link>
                        <p className="text-muted-foreground font-mono text-xs">{plan.code}</p>
                    </div>
                ),
            },
            {
                id: 'role',
                header: 'Role',
                className: 'align-top',
                cell: (plan) => (
                    <Badge variant="outline" className="capitalize">
                        {plan.role}
                    </Badge>
                ),
            },
            {
                id: 'price',
                numeric: true,
                header: 'Price',
                sortKey: 'price',
                className: 'align-top',
                cell: (plan) => (
                    <div className="space-y-0.5">
                        <p className="font-medium tabular-nums">
                            {formatMoney(plan.price, plan.currency)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                            {/* null term = never expires, not "unknown". */}
                            {plan.termDays === null
                                ? 'Never expires'
                                : `per ${formatCount(plan.termDays)} days`}
                        </p>
                    </div>
                ),
            },
            {
                id: 'commission',
                header: 'Commission',
                className: 'align-top tabular-nums',
                cell: (plan) =>
                    plan.limits.commissionPercent === null ? (
                        <NotSet>Not set</NotSet>
                    ) : (
                        `${plan.limits.commissionPercent}%`
                    ),
            },
            {
                id: 'state',
                header: 'State',
                className: 'align-top',
                cell: (plan) => <PlanStateBadges plan={plan} />,
            },
            {
                id: 'sortOrder',
                header: 'Order',
                sortKey: 'sortOrder',
                className: 'text-muted-foreground align-top tabular-nums',
                cell: (plan) => plan.sortOrder,
            },
            {
                id: 'actions',
                header: 'Actions',
                className: 'align-top',
                cell: (plan) =>
                    /*
                      Hidden on an archived tier, not disabled — the platform's
                      write queries filter archived rows, so editing one is a
                      guaranteed 404. Offering a button that always fails is worse
                      than offering none.
                    */
                    plan.archivedAt === null ? (
                        <Can permission="billing.plans.manage">
                            <Button variant="ghost" size="sm" onClick={() => setEditing(plan)}>
                                Edit
                            </Button>
                        </Can>
                    ) : (
                        <span className="text-muted-foreground text-xs">Archived</span>
                    ),
            },
        ],
        [],
    );

    const meta = plans.data?.meta;

    return (
        <PageContainer
            title="Plans"
            description="The subscription catalog — one tier per role, with the limits that role uses."
            actions={
                <Can permission="billing.plans.manage">
                    <Button onClick={() => setCreating(true)}>
                        <Plus className="size-4" />
                        New plan
                    </Button>
                </Can>
            }
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <SearchInput
                        value={values.search}
                        onChange={(next) => set({ search: next || null }, { replace: true })}
                        label="Search plans"
                        placeholder="Code, name or id"
                    />

                    <div className="space-y-1.5">
                        <Label htmlFor="plan-role-filter">Role</Label>
                        <Select
                            value={values.role || ANY}
                            onValueChange={(next) => set({ role: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="plan-role-filter" className="w-[150px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any role</SelectItem>
                                {PLAN_ROLES.map((role) => (
                                    <SelectItem key={role} value={role} className="capitalize">
                                        {role}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-end gap-2 pb-1.5">
                        <Switch
                            id="plan-archived"
                            checked={includeArchived}
                            onCheckedChange={(next) =>
                                set({ includeArchived: next ? 'true' : null })
                            }
                        />
                        <Label htmlFor="plan-archived" className="flex items-center gap-1 pb-0.5">
                            Include archived
                            <InfoHint label="About archived plans">
                                Archiving a tier removes it from the catalog but not from the
                                database — everyone already on it keeps it until their term ends.
                                So a subscription can name a tier this list otherwise hides.
                            </InfoHint>
                        </Label>
                    </div>
                </FilterBar>

                {meta ? (
                    <p className="text-muted-foreground text-sm">{formatCount(meta.total)} plans</p>
                ) : null}

                <DataTable
                    caption="Subscription plans"
                    columns={columns}
                    rows={plans.data?.data ?? []}
                    rowKey={(plan) => plan.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={plans.isLoading}
                    isRefreshing={plans.isRefreshing}
                    error={plans.error}
                    onRetry={plans.reload}
                    empty={
                        <EmptyState
                            icon={CreditCard}
                            title="No plans match"
                            description={
                                isFiltered
                                    ? 'No tier matches these filters.'
                                    : 'No pricing tier has been created yet.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="plans"
                        isBusy={plans.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {creating ? (
                <PlanFormDialog open onOpenChange={setCreating} onSaved={reconcile} />
            ) : null}

            {editing ? (
                <PlanFormDialog
                    plan={editing}
                    open
                    onOpenChange={(open) => !open && setEditing(null)}
                    onSaved={reconcile}
                />
            ) : null}
        </PageContainer>
    );
}

/**
 * A tier's two independent states.
 *
 * `isActive: false` is **defined but not purchasable** — a real, reversible
 * state. `archivedAt` is the soft delete. They are not the same thing and a tier
 * can be both.
 */
export function PlanStateBadges({ plan }: { plan: Plan }) {
    return (
        <div className="flex flex-wrap gap-1">
            {plan.archivedAt !== null ? <Badge variant="secondary">Archived</Badge> : null}
            {plan.isActive ? (
                <Badge variant="outline">Purchasable</Badge>
            ) : (
                <Badge variant="outline" className="text-muted-foreground">
                    Not purchasable
                </Badge>
            )}
        </div>
    );
}
