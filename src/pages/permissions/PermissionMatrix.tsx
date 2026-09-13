import { useMemo } from 'react';
import { Check, Minus, RotateCw, ShieldCheck } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { isAccessDenial, resolveErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { fetchPermissionCatalog, fetchTierMatrix } from '@/services/permissions.service';
import { usePermissions } from '@/store';
import {
    UNROUTED_PERMISSION_NAMES,
    type PermissionCatalogEntry,
} from '@/types/permissions.types';

const UNROUTED = new Set<string>(UNROUTED_PERMISSION_NAMES);

const FILTER_KEYS = ['search', 'family', 'action', 'flag'] as const;

/** Radix refuses an empty `<SelectItem value>`, so "no filter" needs a sentinel. */
const ANY = 'any';

const FLAG_FILTERS = [
    { value: 'financial', label: 'Financial' },
    { value: 'escalation', label: 'Escalation' },
    { value: 'destructive', label: 'Destructive' },
    { value: 'dualControl', label: 'Dual control' },
    { value: 'scoped', label: 'Row-scoped' },
    { value: 'unrouted', label: 'No endpoint yet' },
] as const;

function hasFlag(entry: PermissionCatalogEntry, flag: string): boolean {
    switch (flag) {
        case 'financial':
            return entry.financial;
        case 'escalation':
            return entry.escalation;
        case 'destructive':
            return entry.destructive;
        case 'dualControl':
            return entry.dualControl;
        case 'scoped':
            return entry.scoped;
        case 'unrouted':
            return UNROUTED.has(entry.name);
        default:
            return true;
    }
}

/** The five sensitivity flags, as badges. Order matches the doc's own table. */
function Flags({ entry }: { entry: PermissionCatalogEntry }) {
    const flags: string[] = [];
    if (entry.financial) flags.push('financial');
    if (entry.escalation) flags.push('escalation');
    if (entry.destructive) flags.push('destructive');
    if (entry.dualControl) flags.push('dual-control');
    if (entry.scoped) flags.push('scoped');

    if (flags.length === 0) return null;

    return (
        <span className="flex flex-wrap gap-1">
            {flags.map((flag) => (
                <Badge key={flag} variant="outline" className="text-[10px] font-normal">
                    {flag}
                </Badge>
            ))}
        </span>
    );
}

function Holds({ held, label }: { held: boolean; label: string }) {
    return held ? (
        <Check className="text-success mx-auto size-4" aria-label={`${label}: granted`} />
    ) : (
        <Minus className="text-muted-foreground/40 mx-auto size-4" aria-label={`${label}: not granted`} />
    );
}

/**
 * Which level holds what — the whole catalogue against the whole grant table.
 *
 * ── Why this screen has to exist, and why it may not be hard-coded ────────────
 * Hard-coding the permission **vocabulary** is correct, and `types/permissions.types.ts` does it:
 * the 118 names are literal types, and a test diffs them against the policy document so a
 * backend change fails the suite rather than drifting silently. Hard-coding **which level holds
 * what** is not, and there is deliberately no tier → permission table anywhere in `src/`. The
 * tier sets in `src/test/fixtures.ts` exist for tests and are the one thing app code must never
 * import.
 *
 * So the matrix comes from `GET /permissions/tiers` and nowhere else, and this screen is the
 * only place it is rendered.
 *
 * ── Two reads that fail independently ────────────────────────────────────────
 * `GET /permissions/catalog` needs no permission — "an administrator who cannot discover what
 * they may do cannot use the service". `GET /permissions/tiers` is the only route in the group
 * behind one (`permissions.read`), and Support does not hold it. So the tier columns are allowed
 * to be refused while the catalogue still renders: a screen that failed whole because half of it
 * was denied would tell an operator the vocabulary was unavailable, which is not true.
 *
 * ── ⚠ The mono strings here are the vocabulary, not values ───────────────────
 * `entry.name` and `entry.family` are `font-mono` and neither gets a copy affordance, which is
 * the same judgement stated three paragraphs up from the other side: this screen *is* the
 * vocabulary, rendered as a table of a hundred-odd rows. A permission name is read against the
 * ticks beside it and never pasted — the filters above it are a search box and two selects
 * already populated from the same catalogue, so there is nothing to paste it into. A hundred
 * copy buttons down the leftmost column would be a hundred controls competing with the six real
 * ones on the row.
 */
export function PermissionMatrix() {
    const { held, tierLabel } = usePermissions();
    const { token, refresh } = useRefreshToken();
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS);

    const catalog = useAsyncData(`/permissions/catalog#${token}`, (signal) =>
        fetchPermissionCatalog({ signal }),
    );
    const matrix = useAsyncData(`/permissions/tiers#${token}`, (signal) =>
        fetchTierMatrix({ signal }),
    );

    /**
     * The three `?? []`-style fallbacks are memoised rather than inlined.
     *
     * A fresh `[]` or `new Set()` on every render is a new reference, which would make every
     * `useMemo` below it recompute on every render — i.e. the memos would be doing nothing while
     * looking as though they were.
     */
    const heldNames = useMemo(() => held ?? new Set<string>(), [held]);
    const tiers = useMemo(() => matrix.data?.tiers ?? [], [matrix.data]);
    const entries = useMemo(() => catalog.data?.permissions ?? [], [catalog.data]);

    /** `tier → the names it holds`, resolved once per response rather than per cell. */
    const byTier = useMemo(() => {
        const map = new Map<number, ReadonlySet<string>>();
        for (const tier of tiers) {
            map.set(tier.tier, new Set(tier.permissions));
        }
        return map;
    }, [tiers]);

    /** Denied is a legitimate steady state here; any other failure is worth a retry. */
    const matrixDenied = isAccessDenial(matrix.error);

    const families = useMemo(
        () => [...new Set(entries.map((entry) => entry.family))].sort(),
        [entries],
    );
    const actions = useMemo(
        () => [...new Set(entries.map((entry) => entry.action))].sort(),
        [entries],
    );

    const rows = useMemo(() => {
        const term = values.search.trim().toLowerCase();
        return entries.filter((entry) => {
            if (values.family && entry.family !== values.family) return false;
            if (values.action && entry.action !== values.action) return false;
            if (values.flag && !hasFlag(entry, values.flag)) return false;
            if (!term) return true;
            return (
                entry.name.toLowerCase().includes(term) ||
                entry.summary.toLowerCase().includes(term)
            );
        });
    }, [entries, values]);

    const columns = useMemo<Column<PermissionCatalogEntry>[]>(() => {
        const base: Column<PermissionCatalogEntry>[] = [
            {
                id: 'name',
                header: 'Permission',
                cell: (entry) => (
                    <div className="min-w-0 space-y-0.5">
                        <p className="font-mono text-xs break-all">
                            {entry.name}
                            {UNROUTED.has(entry.name) ? (
                                <span className="text-muted-foreground ml-2 font-sans">
                                    no endpoint yet
                                </span>
                            ) : null}
                        </p>
                        <p className="text-muted-foreground text-sm">{entry.summary}</p>
                    </div>
                ),
            },
            {
                id: 'family',
                header: 'Family',
                cell: (entry) => <span className="font-mono text-xs">{entry.family}</span>,
                className: 'whitespace-nowrap',
            },
            {
                id: 'flags',
                header: 'Flags',
                cell: (entry) => (
                    <div className="flex flex-wrap items-center gap-1">
                        {/* Rendered raw, never switched on — a new action value is an
                            additive backend change. */}
                        <Badge variant="outline" className="text-[10px] font-normal">
                            {entry.action}
                        </Badge>
                        <Flags entry={entry} />
                    </div>
                ),
            },
        ];

        for (const tier of tiers) {
            base.push({
                id: `tier-${tier.tier}`,
                header: `${tier.tier} ${tier.label}`,
                cell: (entry) => (
                    <Holds
                        held={byTier.get(tier.tier)?.has(entry.name) ?? false}
                        label={tier.label}
                    />
                ),
                className: 'text-center',
                headClassName: 'text-center whitespace-nowrap',
            });
        }

        base.push({
            id: 'you',
            header: 'You',
            cell: (entry) => <Holds held={heldNames.has(entry.name)} label="You" />,
            className: 'text-center',
            headClassName: 'text-center',
        });

        return base;
    }, [tiers, byTier, heldNames]);

    return (
        <PageContainer
            title="Permission matrix"
            description={
                catalog.data
                    ? `${catalog.data.total} permissions across ${families.length} families. ${
                          UNROUTED.size
                      } are catalogued policy with no endpoint yet.`
                    : 'Every permission that exists, and which level holds it.'
            }
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={refresh}
                    disabled={catalog.isLoading || catalog.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        This is the only source of the matrix
                    </CardTitle>
                    <CardDescription>
                        The permission <em>names</em> are compiled into this dashboard and checked
                        against the policy document by a test. Which level holds which is not — it
                        comes from the service on every load, and both <code>tier</code> and{' '}
                        <code>status</code> are re-read from the database on every request, so a
                        demotion applies on the next call rather than at token expiry.{' '}
                        <strong>Holding a permission is necessary, never sufficient:</strong>{' '}
                        escalation rules, row scope and dual control each refuse independently.
                        Permissions marked <em>destructive</em> can never be granted by family
                        expansion — a human has to type the name.
                    </CardDescription>
                </CardHeader>
                {matrixDenied ? (
                    <CardContent>
                        <p className="text-muted-foreground text-sm">
                            The level columns are hidden because your account does not hold{' '}
                            <code>permissions.read</code>
                            {tierLabel ? ` (${tierLabel})` : ''}. The catalogue below is complete;
                            only the comparison between levels is withheld. Your own grants are on{' '}
                            <strong>Your access</strong>.
                        </p>
                    </CardContent>
                ) : matrix.error ? (
                    <CardContent className="flex flex-wrap items-center gap-3">
                        <p className="text-muted-foreground text-sm">
                            The level columns could not be loaded: {resolveErrorMessage(matrix.error)}
                        </p>
                        <Button variant="outline" size="sm" onClick={matrix.reload}>
                            Try again
                        </Button>
                    </CardContent>
                ) : null}
            </Card>

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                    label="Search permissions"
                    placeholder="Search name or summary"
                />

                <Select
                    value={values.family || ANY}
                    onValueChange={(next) => set({ family: next === ANY ? null : next })}
                >
                    <SelectTrigger className="w-[190px]" aria-label="Family">
                        <SelectValue placeholder="Any family" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any family</SelectItem>
                        {families.map((family) => (
                            <SelectItem key={family} value={family}>
                                {family}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.action || ANY}
                    onValueChange={(next) => set({ action: next === ANY ? null : next })}
                >
                    <SelectTrigger className="w-[150px]" aria-label="Action">
                        <SelectValue placeholder="Any action" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any action</SelectItem>
                        {actions.map((action) => (
                            <SelectItem key={action} value={action}>
                                {action}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.flag || ANY}
                    onValueChange={(next) => set({ flag: next === ANY ? null : next })}
                >
                    <SelectTrigger className="w-[180px]" aria-label="Sensitivity">
                        <SelectValue placeholder="Any sensitivity" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any sensitivity</SelectItem>
                        {FLAG_FILTERS.map((flag) => (
                            <SelectItem key={flag.value} value={flag.value}>
                                {flag.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FilterBar>

            {catalog.data && !catalog.isLoading ? (
                <p className={cn('text-muted-foreground text-sm')} aria-live="polite">
                    {rows.length} {rows.length === 1 ? 'permission' : 'permissions'}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            <DataTable
                caption="Permissions by administrator level"
                columns={columns}
                rows={rows}
                rowKey={(entry) => entry.name}
                isLoading={catalog.isLoading}
                isRefreshing={catalog.isRefreshing}
                error={catalog.error}
                onRetry={catalog.reload}
                loadingRows={10}
                empty={
                    <EmptyState
                        icon={ShieldCheck}
                        title={
                            isFiltered
                                ? 'No permissions match these filters'
                                : 'The catalogue is empty'
                        }
                        description={
                            isFiltered
                                ? 'Clear the filters to see the whole catalogue.'
                                : 'The service returned no permissions, which should not happen.'
                        }
                    />
                }
            />
        </PageContainer>
    );
}
