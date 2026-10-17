import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, Users as UsersIcon } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
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
import { describeIdKinds, describeSearchMiss, idSearchMiss } from '@/lib/id-search';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listUsers, type UserIdMatch } from '@/services/users.service';
import { useAdmin, useCan } from '@/store';
import type { RoutedPermissionName } from '@/types/permissions.types';
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

/**
 * ── Searching by id (BR-028, answered 2026-10-12) ─────────────────────────────
 * ⚠ **Four of the five ids this dashboard shows for a person are not user ids.**
 * A vendor, an agency, an agent and a customer each have a profile with an id of
 * its own, and that is the id on their page, on an order and on a shipment. This
 * directory used to match `users._id` and nothing else, so a profile id pasted
 * here was a well-formed id that found nobody. **The service now resolves all
 * five** — a 24-hex term is tried as a user id and as a customer, vendor, agency
 * or agent id, and the account that owns it comes back. Three things follow:
 *
 * - **The row is the account, so its id is not the id that was typed.** The
 *   screen says so (`explainIdSearch`) rather than leaving an operator to wonder
 *   why a search for one id produced a record carrying another.
 * - **`role`, `status` and the date range still narrow an id match** —
 *   `?search=<customerId>&role=vendor` finds the person only if they are also a
 *   vendor. So an id that finds nobody under other filters is offered again
 *   without them — and since BR-029 only when `meta.idMatch` says the id
 *   belongs to somebody, because it describes the id and not the page.
 * - **A whole id that finds nobody is not a person at all.** The links to
 *   Vendors, Agencies and Agents this screen briefly carried are gone — the
 *   search does that itself now. Orders stays: an order id is not a person, and
 *   it is the commonest id an operator holds.
 *
 * ⚠ **Deploy order: wi-admin first.** Against a service older than BR-028 a
 * profile id still finds nobody, and the empty state's sentence — which says the
 * id is no customer's, vendor's, agency's or agent's — would be untrue.
 */
const ORDERS: { path: string; permission: RoutedPermissionName } = {
    path: '/dashboard/orders',
    permission: 'orders.read',
};

/** The filters that still narrow an id match. `sort` and `search` do not. */
const NARROWING_KEYS = ['role', 'status', 'createdFrom', 'createdTo'] as const;

interface IdSearchStory {
    /** The line beside the count when rows came back, or `null` for nothing to say. */
    found: string | null;
    /** What an empty page means, and which way out is honest. */
    miss: { text: string; offerAlone: boolean; offerOrders: boolean };
}

/**
 * What a whole-id search found, in words.
 *
 * ── With `meta.idMatch` (BR-029) — facts ──────────────────────────────────────
 * It **describes the id, not the page**: `role`, `status` and the date range do
 * not touch it. So an empty page has three explanations and this tells them
 * apart, which the derivation below could only guess at:
 *
 * | `kinds` | narrowed? | Means | Offer |
 * |---|---|---|---|
 * | `[]` | either | nobody's id — removing a filter cannot help | Orders |
 * | non-empty | yes | **a filter is hiding the account** | *Search this id alone* |
 * | non-empty | no | ⚠ a profile with **no account behind it** — a data fault | nothing |
 *
 * And with rows, the kinds name what the typed id was. ⚠ `["user", "customer"]`
 * is real (five collections, nothing forbids one value being a user id AND
 * somebody else's profile id): then two accounts come back, and **the row whose
 * id equals the term is the `user` one** — `users.md` § `meta.idMatch`.
 *
 * ── Without it — derived ──────────────────────────────────────────────────────
 * Absent means no id was read, or a wi-admin older than 2026-10-13. Only the
 * second reaches here (the caller passes a whole id), and the rows are all there
 * is: an id search whose rows do not carry the id came through a profile, of
 * some kind; an empty one under a filter *may* be the filter.
 */
function explainIdSearch(
    searchedId: string,
    rows: readonly User[],
    idMatch: UserIdMatch | undefined,
    isNarrowed: boolean,
): IdSearchStory {
    const term = searchedId.toLowerCase();
    const viaProfile = rows.some((row) => row.id.toLowerCase() !== term);

    if (!idMatch) {
        return {
            found:
                rows.length > 0 && !rows.some((row) => row.id.toLowerCase() === term)
                    ? 'that id is a customer, vendor, agency or agent profile’s, and this is the account that owns it. The account’s own id is on its page.'
                    : null,
            miss: isNarrowed
                ? {
                      text: 'No account matches that id under the other filters. An id finds its account whether it is the user’s own or a customer, vendor, agency or agent profile’s — but the role, status and date filters still narrow it.',
                      offerAlone: true,
                      offerOrders: false,
                  }
                : {
                      text: 'No account has that id — as its own, or as the id of a customer, vendor, agency or agent profile. It is not a person’s id; if it came from an order, look for it there.',
                      offerAlone: false,
                      offerOrders: true,
                  },
        };
    }

    const profileKinds = idMatch.kinds.filter((kind) => kind !== 'user');
    let found: string | null = null;
    if (viaProfile && profileKinds.length > 0) {
        found =
            idMatch.kinds.includes('user') && rows.length > 1
                ? `that id is an account’s own id and also ${describeIdKinds(profileKinds)} id belonging to someone else, so both accounts are listed — the one whose id is the same is the account’s own.`
                : `that id is ${describeIdKinds(profileKinds)} id, and this is the account that owns it. The account’s own id is on its page.`;
    }

    if (idMatch.kinds.length === 0) {
        return {
            found,
            miss: {
                text: 'No account or profile has that id — it is not a person’s id. If it came from an order, look for it there.',
                offerAlone: false,
                offerOrders: true,
            },
        };
    }

    const owner = describeIdKinds(idMatch.kinds);
    return {
        found,
        miss: isNarrowed
            ? {
                  text: `That id is ${owner} id — the role, status or date filter is hiding the account.`,
                  offerAlone: true,
                  offerOrders: false,
              }
            : {
                  // The platform never deletes a `users` row, so this takes a
                  // hand-edited database — the mirror of a `missing` profile on
                  // the user detail, where the account exists and the profile not.
                  text: `That id is ${owner} id, but no account stands behind it. That is a fault in the data rather than a search result — report it with the id.`,
                  offerAlone: false,
                  offerOrders: false,
              },
    };
}

export function UsersList() {
    const admin = useAdmin();
    const can = useCan();
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

    /** A whole, well-formed id in the box — the only kind the service reads as one. */
    const searchedId = idSearchMiss(values.search) === 'whole' ? values.search.trim() : null;

    /** Whether anything besides the term is narrowing the result. */
    const isNarrowed = NARROWING_KEYS.some((key) => values[key] !== '');

    const story = searchedId ? explainIdSearch(searchedId, rows, meta?.idMatch, isNarrowed) : null;

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
                    acceptsId
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <FilterField label="Role" htmlFor="filter-role">
                    <Select
                        value={values.role || ANY}
                        onValueChange={(value) => set({ role: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-role" className="w-36">
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
                </FilterField>

                <FilterField label="Status" htmlFor="filter-status">
                    <Select
                        value={values.status || ANY}
                        onValueChange={(value) => set({ status: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-status" className="w-36">
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
                </FilterField>

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
                    {story?.found ? <> — {story.found}</> : null}
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
                                ? describeSearchMiss(
                                      values.search,
                                      'Try a different term, or clear the filters. A search matches an email, a phone number, or a user id.',
                                      story?.miss.text ?? '',
                                  )
                                : 'Accounts appear here as people register on the platform.'
                        }
                        action={
                            isFiltered ? (
                                <div className="flex flex-wrap justify-center gap-2">
                                    {story?.miss.offerAlone ? (
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                set({
                                                    role: null,
                                                    status: null,
                                                    createdFrom: null,
                                                    createdTo: null,
                                                })
                                            }
                                        >
                                            Search this id alone
                                        </Button>
                                    ) : null}
                                    {story?.miss.offerOrders && can(ORDERS.permission) ? (
                                        <Button asChild variant="outline" size="sm">
                                            <Link to={`${ORDERS.path}?search=${searchedId}`}>
                                                Look for it in Orders
                                            </Link>
                                        </Button>
                                    ) : null}
                                    <Button variant="outline" size="sm" onClick={reset}>
                                        Clear filters
                                    </Button>
                                </div>
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
