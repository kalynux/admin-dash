import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, UserCog, UserPlus } from 'lucide-react';

import {
    AdministratorStatusBadge,
    MfaEnrolmentBadge,
} from '@/components/administrators/AdministratorBadges';
import { CreateAdministratorDialog } from '@/components/administrators/CreateAdministratorDialog';
import { Can } from '@/components/auth/Can';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { TierBadge } from '@/components/layout/TierBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { assignableTiers } from '@/lib/admin-escalation';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAdministrators } from '@/services/administrators.service';
import { useAdmin } from '@/store';
import { tierLabel } from '@/types/auth.types';
import {
    ADMINISTRATOR_STATUSES,
    ADMINISTRATOR_TIERS,
    administratorDisplayName,
    type Administrator,
    type AdministratorListQuery,
    type AdminTier,
} from '@/types/administrators.types';

/**
 * The administrator directory.
 *
 * ── There is no sort, and the description says so ─────────────────────────────
 * `GET /administrators` offers **no `sort` at all**: the order is a fixed
 * compound — by level, then newest first within a level — which is the directory
 * an administrator actually reads and which a single sort key cannot express. So
 * no column carries a `sortKey` and `DataTable` gets no `sort`/`onSortChange`.
 * Missing sort arrows read as a bug unless something says otherwise, which is
 * what the page description is for.
 *
 * ── Filters live in the URL, like every other directory ───────────────────────
 * `?search&tier&status&page`. These screens are used by people who paste links
 * to each other, and it means the request path *is* the component key, so
 * `useAsyncData` cannot be handed a key that disagrees with what it fetches.
 */

/** Every key this screen owns. `page` is managed separately by the hook. */
const FILTER_KEYS = ['search', 'tier', 'status'] as const;

const FILTER_DEFAULTS = {} as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function AdministratorsList() {
    const admin = useAdmin();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );
    const [creating, setCreating] = useState(false);

    const timeZone = resolveTimeZone(admin.timezone);

    const query = useMemo<AdministratorListQuery>(
        () => ({
            // `buildQuery` drops `''`, which is what makes clearing the box safe:
            // an empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            // ⚠ Out of the URL this is a string; the wire wants a number and the
            // type says so, so the conversion belongs here rather than in the
            // service, which should never have to guess.
            tier: values.tier ? (Number(values.tier) as AdminTier) : undefined,
            status: values.status || undefined,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [values, page],
    );

    const path = withQuery('/administrators', { ...query });
    const administrators = useAsyncData(path, (signal) => listAdministrators(query, { signal }));

    const rows = administrators.data?.data ?? [];
    const meta = administrators.data?.meta;

    /*
     * Holding `administrators.create` is not enough — an actor with no level
     * below their own has nothing to assign, and `assignableTiers` is empty for
     * them. Offering the form would open a dialog with an empty select.
     */
    const canAssignALevel = assignableTiers(admin.tier, 'create').length > 0;

    const columns = useMemo<Column<Administrator>[]>(
        () => [
            {
                id: 'identity',
                header: 'Administrator',
                cell: (row) => (
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                to={`/dashboard/administrators/${row.id}`}
                                className="font-medium hover:underline"
                            >
                                {administratorDisplayName(row)}
                            </Link>
                            {/* The one row where a self-action can be attempted. */}
                            {row.id === admin.id ? <Badge variant="secondary">You</Badge> : null}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">{row.email}</p>
                    </div>
                ),
            },
            {
                id: 'tier',
                header: 'Level',
                // The server sends the label, so an unknown level still reads.
                cell: (row) => <TierBadge tier={row.tier} />,
            },
            {
                id: 'status',
                header: 'Status',
                cell: (row) => <AdministratorStatusBadge status={row.status} />,
            },
            {
                id: 'mfa',
                header: 'Two-factor',
                // Worth a column: MFA is mandatory at Developer level, so a
                // tier-1 without it is an account that cannot finish a sign-in.
                cell: (row) => <MfaEnrolmentBadge enrolled={row.mfaEnrolled} />,
            },
            {
                id: 'lastLoginAt',
                header: 'Last signed in',
                className: 'text-muted-foreground text-sm',
                // `null` here means never — a fact about the account, not a gap.
                cell: (row) => formatInstantInZone(row.lastLoginAt, timeZone) ?? 'Never',
            },
            {
                id: 'createdAt',
                header: 'Created',
                className: 'text-muted-foreground text-sm',
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
        ],
        [timeZone, admin.id],
    );

    return (
        <PageContainer
            title="Administrators"
            description="Who may use this service. Ordered by level, then newest first within a level — this directory offers no other ordering."
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={administrators.reload}
                        disabled={administrators.isLoading || administrators.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    <Can permission="administrators.create">
                        {canAssignALevel ? (
                            <Button size="sm" onClick={() => setCreating(true)}>
                                <UserPlus className="size-4" />
                                New administrator
                            </Button>
                        ) : null}
                    </Can>
                </>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search administrators"
                    // ⚠ Not "or id" — unlike `/users`, this search matches only
                    // email and display name, so promising otherwise would make
                    // a pasted id look like a missing record.
                    placeholder="Email or display name"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.tier || ANY}
                    onValueChange={(value) => set({ tier: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Level">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any level</SelectItem>
                        {ADMINISTRATOR_TIERS.map((tier) => (
                            <SelectItem key={tier} value={String(tier)}>
                                {tierLabel(tier)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.status || ANY}
                    onValueChange={(value) => set({ status: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-36" aria-label="Status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any status</SelectItem>
                        {ADMINISTRATOR_STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="capitalize">
                                {status}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {/* No date range: `/administrators` accepts no `from`/`to`. */}
            </FilterBar>

            {meta && !administrators.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)}{' '}
                    {meta.total === 1 ? 'administrator' : 'administrators'}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            {/* ⚠ No `sort` and no `onSortChange`: the endpoint offers none. */}
            <DataTable
                caption="Administrators"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={administrators.isLoading}
                isRefreshing={administrators.isRefreshing}
                error={administrators.error}
                onRetry={administrators.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={UserCog}
                        title={
                            isFiltered ? 'No administrators match these filters' : 'No administrators'
                        }
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches an email or a display name — not an id.'
                                : 'Every administrator who can sign in to this service appears here.'
                        }
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={reset}>
                                    Clear filters
                                </Button>
                            ) : undefined
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="administrators"
                    isBusy={administrators.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            <CreateAdministratorDialog
                actorTier={admin.tier}
                open={creating}
                onOpenChange={setCreating}
                onCreated={administrators.reload}
            />
        </PageContainer>
    );
}
