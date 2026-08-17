import { useMemo, useState } from 'react';
import { Banknote, X } from 'lucide-react';

import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { payoutColumns } from '@/components/money/payoutColumns';
import {
    MarkPaidDialog,
    MarkPaidQueuedNotice,
    RejectPayoutDialog,
} from '@/components/money/PayoutWriteDialogs';
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
import { listPayouts } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import {
    EARNINGS_ACCOUNT_OWNER_TYPES,
    MONEY_MAX_RANGE_DAYS,
    PAYOUT_ORIGINS,
    PAYOUT_ORIGIN_LABELS,
    PAYOUT_SORT_DEFAULT,
    PAYOUT_STATUSES,
    type Payout,
    type PayoutListQuery,
} from '@/types/money.types';
import type { Approval } from '@/types/approvals.types';

/**
 * `GET /money/payouts` · `money.payouts.read` — where money leaves the platform.
 *
 * ── Two ways a request gets here ──────────────────────────────────────────────
 * `manual` means the owner asked. `auto_threshold` means the platform's daily
 * sweep opened one for them once their available balance reached the payout
 * threshold — so nobody asked, and there is no requester to query. The filter
 * exists because those are different queues of work.
 *
 * ── The destination column has no digits, deliberately ────────────────────────
 * The projection behind this list never reads the account-number columns, so an
 * operator recognises a destination by provider and account name. The digits are
 * behind a separate, audited action on the detail screen.
 *
 * ── Filters live in the URL ───────────────────────────────────────────────────
 * These screens are support tools: a filtered queue is something an operator
 * sends to a colleague. `createdFrom`/`createdTo` are **calendar days** and are
 * named differently from the wire's `from`/`to` on purpose — the contract refuses
 * date-only values, so the day is resolved in the operator's own zone at request
 * time and a shared link means the same days to each reader.
 */

const FILTER_KEYS = [
    'status',
    'ownerType',
    'ownerId',
    'origin',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: PAYOUT_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * Offer the vocabulary in use today **plus whatever the URL already carries**.
 *
 * These are bounded strings rather than pinned enums, so a shared link naming a
 * status the platform added yesterday keeps working instead of silently
 * resetting to "any".
 */
function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function PayoutsQueue() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange
        ? rangeExceedsMaxDays(dayRange, MONEY_MAX_RANGE_DAYS)
        : false;

    const query: PayoutListQuery = {
        status: values.status || undefined,
        ownerType: values.ownerType || undefined,
        ownerId: values.ownerId || undefined,
        origin: values.origin || undefined,
        sort: values.sort || undefined,
        page,
        // An over-cap span is a guaranteed 400, so it is not sent at all and the
        // filter says why rather than letting the list fail.
        ...(spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/money/payouts', { ...query });
    const payouts = useAsyncData(path, (signal) => listPayouts(query, { signal }));

    const canMarkPaid = can('money.payouts.mark_paid');
    const canReject = can('money.payouts.reject');

    const [acting, setActing] = useState<{
        payout: Payout;
        kind: 'mark-paid' | 'reject';
    } | null>(null);

    /**
     * A `202` from mark-paid, held until the operator dismisses it.
     *
     * **Persistent, not a toast.** A queued mark-paid never appears on the
     * payout's own Activity feed — `queuedIntent` re-targets the audit row at the
     * `approval_request` and the payout rides as `related_target_*`, which the
     * activity filter does not consult. So this notice is the only record the
     * operator gets that their action went somewhere, and a message that slides
     * away after four seconds would leave them believing it was lost.
     */
    const [queued, setQueued] = useState<{ approval: Approval; message?: string } | null>(null);

    const columns = useMemo(
        () =>
            payoutColumns({
                timeZone,
                can,
                /*
                  Keyed on `status === 'pending'` and NOT on the amount.

                  The 2,000,000 XAF dual-control threshold is hard-coded in the
                  backend's permission catalog, not env-driven, and a client copy
                  of it would be a second implementation of a rule that can move.
                  So both buttons are offered on every pending row and the `202`
                  is the truth — the dialog explains the quorum, the server
                  decides.
                */
                rowAction: (payout) => {
                    if (payout.status !== 'pending') return null;

                    return (
                        <RowActions>
                            {canMarkPaid ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setActing({ payout, kind: 'mark-paid' })}
                                >
                                    Mark paid
                                </Button>
                            ) : null}
                            {canReject ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setActing({ payout, kind: 'reject' })}
                                >
                                    Reject
                                </Button>
                            ) : null}
                        </RowActions>
                    );
                },
            }),
        [timeZone, can, canMarkPaid, canReject],
    );

    const meta = payouts.data?.meta;

    return (
        <PageContainer
            title="Payouts"
            description="Requests to move money out of the platform, newest first."
        >
            <div className="space-y-4">
                {/*
                  Above the filters, because it is the answer to something the
                  operator just did and there is nowhere else it will appear —
                  see the note on `queued`.
                */}
                {queued ? (
                    <div className="space-y-2">
                        <MarkPaidQueuedNotice
                            approval={queued.approval}
                            message={queued.message}
                            timeZone={timeZone}
                        />
                        <Button variant="ghost" size="sm" onClick={() => setQueued(null)}>
                            Dismiss
                        </Button>
                    </div>
                ) : null}

                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <div className="space-y-1.5">
                        <Label htmlFor="payout-status">Status</Label>
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="payout-status" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(PAYOUT_STATUSES, values.status || ANY).map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value.replace(/_/g, ' ')}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="payout-owner-type">Owner kind</Label>
                        <Select
                            value={values.ownerType || ANY}
                            onValueChange={(next) => set({ ownerType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="payout-owner-type" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any owner</SelectItem>
                                {withCurrent(
                                    EARNINGS_ACCOUNT_OWNER_TYPES,
                                    values.ownerType || ANY,
                                ).map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label
                            htmlFor="payout-origin"
                            className="flex items-center gap-1"
                        >
                            Opened by
                            <InfoHint label="About payout origin">
                                A request the owner made, versus one the platform opened for them
                                automatically once their available balance reached the payout
                                threshold. Nobody asked for the latter.
                            </InfoHint>
                        </Label>
                        <Select
                            value={values.origin || ANY}
                            onValueChange={(next) => set({ origin: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="payout-origin" className="w-[190px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Either</SelectItem>
                                {withCurrent(PAYOUT_ORIGINS, values.origin || ANY).map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {PAYOUT_ORIGIN_LABELS[value] ?? value.replace(/_/g, ' ')}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <DateRangeFilter
                        label="Requested"
                        from={values.createdFrom}
                        to={values.createdTo}
                        onChange={(next) =>
                            set({ createdFrom: next.from || null, createdTo: next.to || null })
                        }
                        timeZone={timeZone}
                        maxDays={MONEY_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                {/*
                  Arrives from an account's "this owner in the payout queue" link.
                  Shown as a dismissible chip because an id in a filter bar is
                  otherwise invisible — an operator would see a short list and no
                  reason for it.
                */}
                {values.ownerId ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                            Owner {values.ownerId}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => set({ ownerId: null })}>
                            <X className="size-3.5" />
                            Clear owner
                        </Button>
                    </div>
                ) : null}

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} payout requests
                    </p>
                ) : null}

                <DataTable
                    caption="Payout requests"
                    columns={columns}
                    rows={payouts.data?.data ?? []}
                    rowKey={(payout) => payout.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={payouts.isLoading}
                    isRefreshing={payouts.isRefreshing}
                    error={payouts.error}
                    onRetry={payouts.reload}
                    empty={
                        <EmptyState
                            icon={Banknote}
                            title="No payout requests match"
                            description={
                                isFiltered
                                    ? 'No request matches these filters.'
                                    : 'Nothing is waiting to leave the platform.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="payout requests"
                        isBusy={payouts.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {acting?.kind === 'mark-paid' ? (
                <MarkPaidDialog
                    payout={acting.payout}
                    open
                    onOpenChange={(open) => !open && setActing(null)}
                    onPaid={() => {
                        setActing(null);
                        payouts.reload();
                    }}
                    onQueued={(approval, message) => {
                        setActing(null);
                        setQueued({ approval, message });
                        // Reload anyway: nothing was paid, so the row must re-read
                        // as pending rather than look acted upon.
                        payouts.reload();
                    }}
                />
            ) : null}

            {acting?.kind === 'reject' ? (
                <RejectPayoutDialog
                    payout={acting.payout}
                    open
                    onOpenChange={(open) => !open && setActing(null)}
                    onRejected={() => {
                        setActing(null);
                        payouts.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
