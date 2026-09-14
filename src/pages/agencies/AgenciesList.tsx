import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Building2, RotateCw } from 'lucide-react';

import { AgencyStatusBadge } from '@/components/agencies/AgencyStatusBadge';
import { AgencyVerificationBadge } from '@/components/agencies/AgencyVerificationBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
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
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAgencies } from '@/services/agencies.service';
import { useAdmin } from '@/store';
import {
    AGENCY_MAX_RANGE_DAYS,
    AGENCY_SORT_DEFAULT,
    AGENCY_STATUSES,
    agencyDisplayName,
    type Agency,
    type AgencyListQuery,
} from '@/types/agencies.types';

/**
 * The filters this screen owns, and therefore the query keys in the URL.
 *
 * `createdFrom` / `createdTo` are deliberately named differently from the wire's
 * `from` / `to`: they hold **calendar days**, not instants. The contract refuses a
 * date-only value, so the day is resolved in the operator's own timezone at
 * request time — which means a shared link says the same *days* to each reader
 * rather than the same absolute moment. Same rule as `/users` and `/vendors`.
 */
const FILTER_KEYS = [
    'search',
    'status',
    'verified',
    'autoAssign',
    'country',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: AGENCY_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * Read a tri-state boolean filter out of the URL.
 *
 * `''` means no filter, `'true'` / `'false'` mean the two real values. **`false`
 * has to survive** — the contract is explicit that `false` means false and is not
 * a synonym for "unset", and "which agencies have auto-assign off?" is a question
 * only a real `false` can ask.
 */
function boolFilter(value: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

export function AgenciesList() {
    const admin = useAdmin();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    /**
     * The operator's zone, not the browser's — the reason `timezone` is on the
     * profile at all.
     */
    const timeZone = resolveTimeZone(admin.timezone);

    /**
     * An over-cap span is a `400`. Catching it here means the request is never
     * made, so the table keeps showing the last good page while the picker
     * explains itself, instead of flashing an error panel over it.
     */
    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, AGENCY_MAX_RANGE_DAYS);

    const query = useMemo<AgencyListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            // `buildQuery` drops `''`, which is what makes clearing the box safe:
            // an empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            status: values.status || undefined,
            verified: boolFilter(values.verified),
            autoAssign: boolFilter(values.autoAssign),
            country: values.country ? values.country.toUpperCase() : undefined,
            sort: values.sort || AGENCY_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/agencies', { ...query });
    const agencies = useAsyncData(path, (signal) => listAgencies(query, { signal }));

    const rows = agencies.data?.data ?? [];
    const meta = agencies.data?.meta;

    const columns = useMemo<Column<Agency>[]>(
        () => [
            {
                id: 'business',
                header: 'Agency',
                cell: (agency) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/agencies/${agency.id}`}
                            className="font-medium hover:underline"
                        >
                            {agencyDisplayName(agency)}
                        </Link>
                        {/*
                          The contact person, not the business — and only when it is
                          not already what the link is showing, which happens while an
                          agency is mid-onboarding and has no Magazin yet.
                        */}
                        {agency.contactName && agency.businessName ? (
                            <p className="text-muted-foreground truncate text-xs">
                                {agency.contactName}
                            </p>
                        ) : null}
                        {!agency.businessName ? (
                            <p className="text-muted-foreground truncate text-xs">
                                No business name yet
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                sortKey: 'status',
                cell: (agency) => <AgencyStatusBadge status={agency.status} />,
            },
            {
                id: 'verification',
                header: 'Verification',
                cell: (agency) => <AgencyVerificationBadge agency={agency} />,
            },
            {
                id: 'country',
                header: 'Country',
                className: 'text-muted-foreground text-sm',
                cell: (agency) => agency.country ?? '—',
            },
            {
                id: 'autoAssign',
                header: 'Auto-assign',
                className: 'text-muted-foreground text-sm',
                // Opt-in, and off by default — so "Off" is the ordinary state and is
                // written plainly rather than badged as though it were a problem.
                cell: (agency) => (agency.autoAssignEnabled ? 'On' : 'Off'),
            },
            {
                id: 'onboarding',
                header: 'Onboarding',
                className: 'text-muted-foreground text-sm',
                cell: (agency) => (agency.onboardingComplete ? 'Complete' : 'In progress'),
            },
            {
                id: 'createdAt',
                header: 'Registered',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (agency) => formatInstantInZone(agency.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                sortKey: 'updatedAt',
                className: 'text-muted-foreground text-sm',
                cell: (agency) => formatInstantInZone(agency.updatedAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer
            title="Agencies"
            description="The delivery network. Whether an agency may operate and whether its business is verified are two separate facts, and they can disagree."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={agencies.reload}
                    disabled={agencies.isLoading || agencies.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search agencies"
                    // Every branch here is a documented feature of the endpoint. The id
                    // branch matters most: an agency id copied out of a shipment, an
                    // order or an audit row is the obvious thing to paste.
                    placeholder="Business name, contact, email, phone or agency id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <FilterField label="Status" htmlFor="filter-status">
                    <Select
                        value={values.status || ANY}
                        onValueChange={(value) => set({ status: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-status" className="w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any status</SelectItem>
                            {AGENCY_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                    {status === 'pending_verification' ? 'Pending verification' : status}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                {/*
                  Its own filter beside `status`, and that is the point: the two can
                  disagree, nothing enforces verification today, and finding the
                  `active` agencies that were never verified is precisely why this
                  parameter exists.
                */}
                <FilterField label="Verification" htmlFor="filter-verification">
                    <Select
                        value={values.verified || ANY}
                        onValueChange={(value) => set({ verified: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-verification" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any verification</SelectItem>
                            <SelectItem value="true">Verified</SelectItem>
                            <SelectItem value="false">Unverified</SelectItem>
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Auto-assignment" htmlFor="filter-auto-assignment">
                    <Select
                        value={values.autoAssign || ANY}
                        onValueChange={(value) => set({ autoAssign: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-auto-assignment" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any auto-assign</SelectItem>
                            <SelectItem value="true">Auto-assign on</SelectItem>
                            <SelectItem value="false">Auto-assign off</SelectItem>
                        </SelectContent>
                    </Select>
                </FilterField>

                {/*
                  A plain input, not a picker. No endpoint on this service enumerates
                  countries, so a dropdown here would be a list this client invented.
                */}
                <FilterField label="Country" htmlFor="agency-country">
                    <Input
                        id="agency-country"
                        className="w-24 uppercase"
                        maxLength={2}
                        placeholder="CM"
                        autoComplete="off"
                        value={values.country}
                        onChange={(event) =>
                            set({ country: event.target.value.toUpperCase() }, { replace: true })
                        }
                    />
                </FilterField>

                <DateRangeFilter
                    label="Registered"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={AGENCY_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {meta && !agencies.isLoading ? (
                <p
                    className="text-muted-foreground flex items-center gap-1 text-sm"
                    aria-live="polite"
                >
                    {formatCount(meta.total)} {meta.total === 1 ? 'agency' : 'agencies'}
                    {isFiltered ? ' match these filters' : ''}
                    <InfoHint label="About sorting by agency name">
                        The agency name cannot be sorted on. It lives on the agency&apos;s business
                        record rather than on the agency itself, so ordering by it would mean
                        sorting without an index and paging that skips rows. Status, registration
                        date and last update are sortable.
                    </InfoHint>
                </p>
            ) : null}

            <DataTable
                caption="Delivery agencies"
                columns={columns}
                rows={rows}
                rowKey={(agency) => agency.id}
                sort={values.sort || AGENCY_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={agencies.isLoading}
                isRefreshing={agencies.isRefreshing}
                error={agencies.error}
                onRetry={agencies.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={Building2}
                        title={isFiltered ? 'No agencies match these filters' : 'No agencies yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches a business name, a contact name, an email, a phone number or an agency id.'
                                : 'Delivery agencies appear here as they register on the platform.'
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
                    noun="agencies"
                    isBusy={agencies.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
