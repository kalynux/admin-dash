import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, Store } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { VendorKycBadge } from '@/components/vendors/VendorKycBadge';
import { VendorStatusBadge } from '@/components/vendors/VendorStatusBadge';
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
import { listVendors } from '@/services/vendors.service';
import { useAdmin } from '@/store';
import {
    VENDOR_KYC_STATUSES,
    VENDOR_MAX_RANGE_DAYS,
    VENDOR_ONBOARDING_FILTERS,
    VENDOR_SORT_DEFAULT,
    VENDOR_STATUSES,
    vendorDisplayName,
    vendorOnboardingLabel,
    type Vendor,
    type VendorListQuery,
} from '@/types/vendors.types';

/**
 * The vendor directory.
 *
 * ── Everything the list can be narrowed by is in the URL ──────────────────────
 * `?search&status&kycStatus&onboarding&country&sort&createdFrom&createdTo&page`.
 * These screens are used by people who paste ids to each other and open records in
 * tabs, and local state serves none of that. It also means the request path *is*
 * the component key, so `useAsyncData` cannot be handed a key that disagrees with
 * what it fetches.
 *
 * **`createdFrom`/`createdTo` are calendar days, not instants**, and they are
 * named differently from the wire parameters for exactly that reason: the service
 * refuses a date-only value, so a day here is resolved against the operator's own
 * timezone at request time. Putting a resolved instant in the URL instead would
 * carry one operator's zone into another's screen.
 *
 * ── Two things this screen has to be honest about ─────────────────────────────
 * **Business name is not sortable.** It lives on `stores` rather than on the
 * vendor row, so ordering by it would need a lookup before the sort — which cannot
 * use an index and cannot keep paging stable. The column says so rather than
 * offering a control that would 400.
 *
 * **A business-name search can be incomplete.** The store pre-match is capped, and
 * when it bites the response says so in `meta.businessNameMatchesTruncated`. A
 * silent cap would produce a short list that reads as complete — which is the same
 * as telling an operator the vendor they are looking for does not exist.
 */

/** Every key this screen owns. `page` is managed separately by the hook. */
const FILTER_KEYS = [
    'search',
    'status',
    'kycStatus',
    'onboarding',
    'country',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: VENDOR_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function VendorsList() {
    const admin = useAdmin();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    /**
     * The operator's zone, not the browser's — the reason `timezone` is on the
     * profile at all. `resolveTimeZone` falls back rather than refusing, because
     * an administrator who never set one still has to be able to run a report.
     */
    const timeZone = resolveTimeZone(admin.timezone);

    /**
     * An over-cap span is a `400`. Catching it here means the request is never
     * made, so the table keeps showing the last good page while the picker
     * explains itself, instead of flashing an error panel over it.
     */
    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, VENDOR_MAX_RANGE_DAYS);

    const query = useMemo<VendorListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            // `buildQuery` drops `''`, which is what makes clearing the box safe:
            // an empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            status: values.status || undefined,
            kycStatus: values.kycStatus || undefined,
            onboarding: values.onboarding || undefined,
            // The service upper-cases it too; doing it here keeps the URL and the
            // request identical, and a half-typed single letter is a 400 either way.
            country: values.country ? values.country.toUpperCase() : undefined,
            sort: values.sort || VENDOR_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/vendors', { ...query });
    const vendors = useAsyncData(path, (signal) => listVendors(query, { signal }));

    const rows = vendors.data?.data ?? [];
    const meta = vendors.data?.meta;

    const columns = useMemo<Column<Vendor>[]>(
        () => [
            {
                id: 'business',
                header: 'Business',
                cell: (vendor) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/vendors/${vendor.id}`}
                            className="font-medium hover:underline"
                        >
                            {vendorDisplayName(vendor)}
                        </Link>
                        {/*
                          ⚠ The link above is a *heading*, not a value, even though
                          `vendorDisplayName` falls through to the email and then
                          the phone: it is what the row is called and it is already
                          the route into the record. The contact column beside it
                          renders the same two fields as values, and that is where
                          the copy buttons belong.
                        */}
                        {vendor.storeSlug ? (
                            <p className="text-muted-foreground text-xs">
                                {/*
                                  `plain`, so it survives whole — the slug is the
                                  storefront address, and the CSS `truncate` that
                                  used to clip it is exactly the hiding this
                                  variant refuses.
                                */}
                                <CopyableValue
                                    variant="plain"
                                    mono
                                    value={vendor.storeSlug}
                                    label="store slug"
                                />
                            </p>
                        ) : (
                            <p className="text-muted-foreground truncate text-xs">No store yet</p>
                        )}
                    </div>
                ),
            },
            {
                id: 'contact',
                header: 'Contact',
                sortKey: 'email',
                // The column the ask is about: an operator ringing a vendor back
                // retyped this off the screen. ⚠ The `—` fallback stays rather than
                // `CopyableValue`'s own `NotSet`: an empty cell on this page reads
                // as a dash in six other columns, and "Not set" in one of them
                // would look like a different kind of nothing.
                cell: (vendor) => (
                    <div className="min-w-0">
                        <p className="text-sm">
                            {vendor.email ? (
                                <CopyableValue
                                    variant="email"
                                    value={vendor.email}
                                    label="vendor email"
                                />
                            ) : (
                                '—'
                            )}
                        </p>
                        {vendor.phone ? (
                            <p className="text-muted-foreground text-xs">
                                <CopyableValue
                                    variant="phone"
                                    value={vendor.phone}
                                    label="vendor phone"
                                />
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'country',
                header: 'Country',
                className: 'text-muted-foreground text-sm',
                cell: (vendor) => vendor.country ?? '—',
            },
            {
                id: 'status',
                header: 'Status',
                cell: (vendor) => <VendorStatusBadge status={vendor.status} />,
            },
            {
                id: 'kyc',
                header: 'Verification',
                cell: (vendor) => <VendorKycBadge status={vendor.kycStatus} />,
            },
            {
                id: 'onboarding',
                header: 'Onboarding',
                className: 'text-muted-foreground text-sm',
                cell: (vendor) => vendorOnboardingLabel(vendor),
            },
            {
                id: 'createdAt',
                header: 'Registered',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (vendor) => formatInstantInZone(vendor.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                sortKey: 'updatedAt',
                className: 'text-muted-foreground text-sm',
                cell: (vendor) => formatInstantInZone(vendor.updatedAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer
            title="Vendors"
            description="Every shop on the platform. A vendor's trading status, their sign-in account and their shop's opening hours are three separate things."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={vendors.reload}
                    disabled={vendors.isLoading || vendors.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search vendors"
                    // The id branches are documented features: an id copied out of an
                    // order, a ticket or an audit row is the obvious thing to paste,
                    // and every other admin screen names this person by their user id.
                    placeholder="Business name, email, phone, vendor id or user id"
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
                            {VENDOR_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                    {status === 'pending_verification' ? 'Pending verification' : status}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Verification" htmlFor="filter-verification">
                    <Select
                        value={values.kycStatus || ANY}
                        onValueChange={(value) => set({ kycStatus: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-verification" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any verification</SelectItem>
                            {VENDOR_KYC_STATUSES.map((status) => (
                                <SelectItem key={status} value={status} className="capitalize">
                                    {status}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Onboarding" htmlFor="filter-onboarding">
                    <Select
                        value={values.onboarding || ANY}
                        onValueChange={(value) => set({ onboarding: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-onboarding" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any onboarding</SelectItem>
                            {VENDOR_ONBOARDING_FILTERS.map((value) => (
                                <SelectItem key={value} value={value} className="capitalize">
                                    {value}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                {/*
                  A plain input, not a picker. No endpoint on this service enumerates
                  countries, so a dropdown here would be a list this client invented —
                  and one that could disagree with what the data actually holds.
                */}
                <FilterField label="Country" htmlFor="vendor-country">
                    <Input
                        id="vendor-country"
                        className="w-24 uppercase"
                        maxLength={2}
                        placeholder="CM"
                        autoComplete="off"
                        value={values.country}
                        onChange={(event) =>
                            set(
                                { country: event.target.value.toUpperCase() },
                                { replace: true },
                            )
                        }
                    />
                </FilterField>

                <DateRangeFilter
                    label="Registered"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={VENDOR_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {meta && !vendors.isLoading ? (
                <div className="space-y-2">
                    <p className="text-muted-foreground flex items-center gap-1 text-sm" aria-live="polite">
                        {formatCount(meta.total)} {meta.total === 1 ? 'vendor' : 'vendors'}
                        {isFiltered ? ' match these filters' : ''}
                        <InfoHint label="About sorting by business name">
                            The business name cannot be sorted on. It lives on the vendor&apos;s
                            store rather than on the vendor record, so ordering by it would mean
                            sorting without an index and paging that skips rows. Registration date,
                            last update and email are sortable.
                        </InfoHint>
                    </p>

                    {/* The cap bit. Never rendered unless the server set it. */}
                    {meta.businessNameMatchesTruncated ? (
                        <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs">
                            These results may be incomplete. That term matched more business names
                            than could be looked up at once — narrow the search, or find the vendor
                            by email, phone or id instead.
                        </p>
                    ) : null}
                </div>
            ) : null}

            <DataTable
                caption="Platform vendors"
                columns={columns}
                rows={rows}
                rowKey={(vendor) => vendor.id}
                sort={values.sort || VENDOR_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={vendors.isLoading}
                isRefreshing={vendors.isRefreshing}
                error={vendors.error}
                onRetry={vendors.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={Store}
                        title={isFiltered ? 'No vendors match these filters' : 'No vendors yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches a business name, an email, a phone number, a vendor id or a user id.'
                                : 'Shops appear here as vendors register on the platform.'
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
                    noun="vendors"
                    isBusy={vendors.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
