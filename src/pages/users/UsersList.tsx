import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, Users as UsersIcon } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { RoleBadges } from '@/components/users/RoleBadges';
import { UserStatusBadge } from '@/components/users/UserStatusBadge';
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
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listUsers } from '@/services/users.service';
import { useAdmin } from '@/store';
import {
    USER_MAX_RANGE_DAYS,
    USER_ROLES,
    USER_SORT_DEFAULT,
    USER_STATUSES,
    userDisplayName,
    userSecondaryIdentifier,
    type User,
    type UserListQuery,
} from '@/types/users.types';

/**
 * The platform user directory.
 *
 * ── Everything the list can be narrowed by is in the URL ──────────────────────
 * `?search&role&status&sort&createdFrom&createdTo&page`. These screens are used
 * by people who paste ids to each other and open records in tabs, and local state
 * serves none of that. It also means the request path *is* the component key, so
 * `useAsyncData` cannot be handed a key that disagrees with what it fetches.
 *
 * **`createdFrom`/`createdTo` are calendar days, not instants**, and they are
 * named differently from the wire parameters for exactly that reason: the service
 * refuses a date-only value, so a day here is resolved against the operator's own
 * timezone at request time. Putting a resolved instant in the URL instead would
 * carry one operator's zone into another's screen.
 */

/** Every key this screen owns. `page` is managed separately by the hook. */
const FILTER_KEYS = ['search', 'role', 'status', 'sort', 'createdFrom', 'createdTo'] as const;

const FILTER_DEFAULTS = { sort: USER_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function UsersList() {
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
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, USER_MAX_RANGE_DAYS);

    const query = useMemo<UserListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            // `buildQuery` drops `''`, which is what makes clearing the box safe:
            // an empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            role: values.role || undefined,
            status: values.status || undefined,
            sort: values.sort || USER_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/users', { ...query });
    const users = useAsyncData(path, (signal) => listUsers(query, { signal }));

    const rows = users.data?.data ?? [];
    const meta = users.data?.meta;

    const columns = useMemo<Column<User>[]>(
        () => [
            {
                id: 'identity',
                header: 'User',
                sortKey: 'email',
                cell: (user) => {
                    const secondary = userSecondaryIdentifier(user);
                    return (
                        <div className="min-w-0">
                            <Link
                                to={`/dashboard/users/${user.id}`}
                                className="font-medium hover:underline"
                            >
                                {userDisplayName(user)}
                            </Link>
                            {/*
                              ⚠ `userSecondaryIdentifier` returns the phone and
                              only the phone — it answers `null` unless *both*
                              identifiers exist, in which case the email is what
                              the link is showing. So `variant="phone"` is exact
                              here, not a guess, and this line is the one place in
                              the directory a number can be copied from.

                              The link above keeps no copy button even though on
                              this projection it is *always* an identifier standing
                              in for a name — there is no name on a `users` row at
                              all. It is still the row's heading and its route into
                              the record; the account screen renders both
                              identifiers as values, with their own affordances.
                            */}
                            {secondary ? (
                                <p className="text-muted-foreground text-xs">
                                    <CopyableValue
                                        variant="phone"
                                        value={secondary}
                                        label="user phone"
                                    />
                                </p>
                            ) : null}
                        </div>
                    );
                },
            },
            {
                id: 'roles',
                header: 'Roles',
                cell: (user) => <RoleBadges roles={user.roles} />,
            },
            {
                id: 'status',
                header: 'Status',
                cell: (user) => <UserStatusBadge status={user.status} />,
            },
            {
                id: 'createdAt',
                header: 'Created',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (user) => formatInstantInZone(user.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                sortKey: 'updatedAt',
                className: 'text-muted-foreground text-sm',
                cell: (user) => formatInstantInZone(user.updatedAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer
            title="Users"
            description="Every sign-in identity on the platform. A user row is the account; vendor, agency, agent and customer profiles hang off it."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={users.reload}
                    disabled={users.isLoading || users.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search users"
                    // The id branch is a documented feature: an id copied out of an
                    // order, a ticket or an audit row is the obvious thing to paste,
                    // and a directory that answered "no results" to a valid id would
                    // look broken rather than strict.
                    placeholder="Email, phone or user id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.role || ANY}
                    onValueChange={(value) => set({ role: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-36" aria-label="Role">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any role</SelectItem>
                        {/* `admin` is deliberately absent — no users row can hold it. */}
                        {USER_ROLES.map((role) => (
                            <SelectItem key={role} value={role} className="capitalize">
                                {role}
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
                        {USER_STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="capitalize">
                                {status}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="Created"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={USER_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {meta && !users.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'user' : 'users'}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            <DataTable
                caption="Platform users"
                columns={columns}
                rows={rows}
                rowKey={(user) => user.id}
                sort={values.sort || USER_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={users.isLoading}
                isRefreshing={users.isRefreshing}
                error={users.error}
                onRetry={users.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={UsersIcon}
                        title={isFiltered ? 'No users match these filters' : 'No users yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches an email, a phone number, or a user id.'
                                : 'Accounts appear here as people register on the platform.'
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
                    noun="users"
                    isBusy={users.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
