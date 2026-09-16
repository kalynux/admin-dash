import { useMemo, useState } from 'react';
import { Banknote, X } from 'lucide-react';

import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { payoutColumns } from '@/components/money/payoutColumns';
import {
    SendPayoutDialog,
    TriagePayoutDialog,
} from '@/components/money/PayoutTransferDialogs';
import {
    MarkPaidDialog,
    PayoutQueuedNotice,
    RejectPayoutDialog,
} from '@/components/money/PayoutWriteDialogs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { usePendingPermission } from '@/hooks/use-pending-permission';
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
    canMarkPayoutPaid,
    canRejectPayout,
    EARNINGS_ACCOUNT_OWNER_TYPES,
    isGatewaySendableDestination,
    isPayoutSendable,
    MONEY_MAX_RANGE_DAYS,
    payoutHoldsFunds,
    PAYOUT_ORIGINS,
    PAYOUT_ORIGIN_LABELS,
    PAYOUT_SORT_DEFAULT,
    PAYOUT_STATUSES,
    type Payout,
    type PayoutListQuery,
} from '@/types/money.types';
import type { Approval } from '@/types/approvals.types';
import { PERMISSION_MONEY_PAYOUTS_TRIAGE } from '@/types/permissions.pending';

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

    /*
      ── Who may do what, ADR-024 § 4 ──────────────────────────────────────────

      ⚠ **Reject reaches Support.** `/reject` takes
      `anyPermission('money.payouts.reject', 'money.payouts.triage')` — it is the
      half of triage that actually closes a request, and a reviewer's rejection is
      final. **One Reject control, shown to both tiers**; there is deliberately no
      separate "recommend rejection" flow.

      ⛔ **Send, Mark-paid and the destination reveal are hidden from Support**
      rather than left to answer `403`. They hold `money.payouts.triage` and none
      of the three, and a control that only ever refuses teaches an operator that
      this screen is unreliable.
    */
    const canEndorse = usePendingPermission(PERMISSION_MONEY_PAYOUTS_TRIAGE);
    const canPay = can('money.payouts.mark_paid');
    const canReject = can('money.payouts.reject') || canEndorse;

    const [acting, setActing] = useState<{
        payout: Payout;
        kind: 'mark-paid' | 'reject' | 'send' | 'endorse';
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
                    /*
                      ⛔ **Keyed on `status`, and `triage` is not consulted.**
                      Endorsement is advisory (ADR-024 D-2): a payout nobody has
                      endorsed is exactly as payable as one that has been, so the
                      pre-screen must never decide whether a pay control appears.
                    */
                    const showEndorse =
                        canEndorse && payout.status === 'pending' && payout.triage === null;
                    const showSend =
                        canPay &&
                        isPayoutSendable(payout.status) &&
                        isGatewaySendableDestination(payout.destination);
                    const showMarkPaid = canPay && canMarkPayoutPaid(payout.status);
                    const showReject = canReject && payoutHoldsFunds(payout.status);

                    if (!showEndorse && !showSend && !showMarkPaid && !showReject) return null;

                    const rejectAllowed = canRejectPayout(payout.status);

                    return (
                        <RowActions>
                            {showEndorse ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setActing({ payout, kind: 'endorse' })}
                                >
                                    Endorse
                                </Button>
                            ) : null}
                            {showSend ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setActing({ payout, kind: 'send' })}
                                >
                                    {payout.status === 'failed' ? 'Retry' : 'Send'}
                                </Button>
                            ) : null}
                            {showMarkPaid ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setActing({ payout, kind: 'mark-paid' })}
                                >
                                    Mark paid
                                </Button>
                            ) : null}
                            {showReject ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setActing({ payout, kind: 'reject' })}
                                    // ⛔ Disabled, never hidden, while a transfer
                                    // may still be in flight — releasing the hold
                                    // then is how an owner gets paid twice (D-7).
                                    disabled={!rejectAllowed}
                                    title={
                                        rejectAllowed
                                            ? undefined
                                            : 'Waiting for the provider to confirm this transfer'
                                    }
                                >
                                    Reject
                                </Button>
                            ) : null}
                        </RowActions>
                    );
                },
            }),
        [timeZone, can, canEndorse, canPay, canReject],
    );

    const meta = payouts.data?.meta;

    /*
      ── The one filter on this screen that the SERVER does not apply ───────────

      ⚠ **Client-side, and deliberately not offered as a server filter** — BR-026
      § 1 asked for one and the backend refused with a reason worth keeping: the
      verdict lives in `vendors` / `delivery_agencies` / `delivery_agents` while
      this queue pages over `payout_requests`, so filtering across them means a
      three-way `$lookup` keyed on `owner_type` that would widen the one narrow
      projection keeping the beneficiary's account number off this path. A real
      guarantee for a convenience is the wrong trade. Their instruction was
      "filter in the client", and this is it.

      ⚠ **It therefore sees ONE PAGE, and the UI has to say so.** It sits outside
      `FilterBar` and outside `values` for that reason: dropped in among the four
      server filters it would read as another one, and an operator who ticked it
      and saw three rows would reasonably conclude the queue holds three unvetted
      requests. `meta.total` still counts the whole filtered queue, so the count
      line below states both numbers whenever this is hiding anything.
    */
    const [unvettedOnly, setUnvettedOnly] = useState(false);
    const rows = payouts.data?.data ?? [];
    const visibleRows = unvettedOnly ? rows.filter((row) => !row.verification.verified) : rows;
    const hiddenByVetting = rows.length - visibleRows.length;

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
                        <PayoutQueuedNotice
                            approval={queued.approval}
                            message={queued.message}
                            timeZone={timeZone}
                        />
                        <Button variant="ghost" size="sm" onClick={() => setQueued(null)}>
                            Dismiss
                        </Button>
                    </div>
                ) : null}

                {/*
                  `Clear` clears the vetting checkbox too, even though it lives
                  outside this bar and outside the URL. An operator who presses
                  "Clear filters" and still sees rows missing would be right to
                  call that a bug, and the alternative — a second clear control —
                  is worse than folding it in here.
                */}
                <FilterBar
                    isFiltered={isFiltered || unvettedOnly}
                    onClear={() => {
                        reset();
                        setUnvettedOnly(false);
                    }}
                >
                    <FilterField label="Status" htmlFor="payout-status">
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
                    </FilterField>

                    <FilterField label="Owner kind" htmlFor="payout-owner-type">
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
                    </FilterField>

                    <FilterField
                        htmlFor="payout-origin"
                        label={
                            <>
                                Opened by
                                <InfoHint label="About payout origin">
                                    A request the owner made, versus one the platform opened for them
                                    automatically once their available balance reached the payout
                                    threshold. Nobody asked for the latter.
                                </InfoHint>
                            </>
                        }
                    >
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
                    </FilterField>

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
                        {/*
                          ⚠ Deliberately NOT a `CopyableValue`, unlike every other
                          bare id on this module. This is a chip describing the
                          filter that is applied, not a field of the record — its
                          text reads "Owner <id>" as one label, and the id came
                          from the URL the operator is already looking at. The
                          same holds for the agency and agent chips on the COD
                          lists.
                        */}
                        <Badge variant="secondary" className="font-mono text-xs">
                            Owner {values.ownerId}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => set({ ownerId: null })}>
                            <X className="size-3.5" />
                            Clear owner
                        </Button>
                    </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                    {meta ? (
                        <p className="text-muted-foreground text-sm">
                            {formatCount(meta.total)} payout requests
                            {/*
                              Both numbers, never just the filtered one — the
                              filter below sees this page and `meta.total` counts
                              the queue, so reporting one alone would let an
                              operator read a page as a queue.
                            */}
                            {hiddenByVetting > 0
                                ? ` · showing ${visibleRows.length} of ${rows.length} on this page`
                                : null}
                        </p>
                    ) : (
                        <span />
                    )}

                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                            // Named explicitly rather than relying on the wrapping
                            // label: the primitive is a Radix button, so the
                            // implicit label association a real `<input>` would
                            // get does not apply.
                            aria-label="Only owners nobody has vetted"
                            checked={unvettedOnly}
                            onCheckedChange={(next) => setUnvettedOnly(next === true)}
                        />
                        Only owners nobody has vetted
                        <InfoHint label="About this filter">
                            Applies to the requests on this page only. The verdict is not something
                            the server can filter on here, so paging may reveal more.
                        </InfoHint>
                    </label>
                </div>

                <DataTable
                    caption="Payout requests"
                    columns={columns}
                    rows={visibleRows}
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
                                /*
                                  The vetting case is named first and separately.
                                  It is the one where the server DID return rows,
                                  so "nothing is waiting to leave the platform"
                                  would be flatly untrue — and on a queue this is
                                  the reading that matters: an operator must never
                                  come away thinking there is no money to review
                                  because every request on the page happened to
                                  be from a vetted owner.
                                */
                                unvettedOnly && rows.length > 0
                                    ? 'Every request on this page is from an owner somebody has vetted. Untick the filter, or try the next page.'
                                    : isFiltered
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

            {acting?.kind === 'send' ? (
                <SendPayoutDialog
                    payout={acting.payout}
                    open
                    onOpenChange={(open) => !open && setActing(null)}
                    /*
                      ⚠ The dialog is NOT closed here. It reconciles the list as
                      soon as the transfer resolves and then keeps showing its own
                      outcome — "awaiting confirmation", or "the gateway refused
                      it and the funds are still held". Closing on settle would
                      throw away the sentence the operator most needs.
                    */
                    onSettled={() => payouts.reload()}
                    onQueued={(approval, message) => {
                        setActing(null);
                        setQueued({ approval, message });
                        // Nothing was sent — the row must re-read as pending
                        // rather than look dispatched.
                        payouts.reload();
                    }}
                    onMarkPaidInstead={
                        // Only where it can succeed: the manual pre-flight takes
                        // `pending` alone, so a `failed` row has no manual path.
                        canPay && canMarkPayoutPaid(acting.payout.status)
                            ? () => setActing({ payout: acting.payout, kind: 'mark-paid' })
                            : undefined
                    }
                />
            ) : null}

            {acting?.kind === 'endorse' ? (
                <TriagePayoutDialog
                    payout={acting.payout}
                    open
                    onOpenChange={(open) => !open && setActing(null)}
                    onEndorsed={() => {
                        setActing(null);
                        payouts.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
