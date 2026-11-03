import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowLeft,
    Ban,
    BellRing,
    Banknote,
    CalendarX2,
    CheckCircle2,
    RefreshCcw,
    Undo,
} from 'lucide-react';

import { BookingActionDialog, type BookingAction } from '@/components/bookings/BookingActionDialogs';
import { BookingRefundNotice, BookingSessionNotice } from '@/components/bookings/BookingRefundNotice';
import { RaiseRefundDialog } from '@/components/refunds/RaiseRefundDialog';
import { RaisedRefundNotice } from '@/components/refunds/RaisedRefundNotice';
import { BookingAccessPanel } from '@/components/bookings/BookingAccessPanel';
import { BookingActivityPanel } from '@/components/bookings/BookingActivityPanel';
import { BookingAvailabilityPanel } from '@/components/bookings/BookingAvailabilityPanel';
import {
    BookingEarningsBadge,
    BookingPaymentBadge,
    BookingStatusBadge,
} from '@/components/bookings/BookingBadges';
import { BookingPricingCard } from '@/components/bookings/BookingPricingCard';
import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { EarningsPauseCard } from '@/components/money/EarningsPauseCard';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getBooking } from '@/services/bookings.service';
import { useAdmin, useCan, type CanPredicate } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import {
    bookingAccessText,
    bookingDetailPath,
    bookingDisplayName,
    bookingEarningsCopy,
    bookingRefundFollowUp,
    bookingRefundOutcome,
    bookingStatusLabel,
    bookingTopupOwed,
    canCancelBooking,
    canCancelBookingSession,
    canCompleteBooking,
    canRecheckBookingPayment,
    canRecordCash,
    canRemindBooking,
    canWithdrawBookingProposal,
    isGoodwillRefundLive,
    isPaidNoShow,
    isUnpaidForCompletion,
    type BookingCancelRefund,
    type BookingDetail as BookingRecord,
    type BookingListItem,
    type BookingPayment,
    type BookingRefund,
    type BookingSessionCancelResult,
    type BookingStatusChange,
    type BookingWriteResult,
} from '@/types/bookings.types';
import { pauseReasonLabel } from '@/types/earnings-pause.types';
import {
    refundDetailPath,
    refundReasonKindLabel,
    refundStatusLabel,
    type CreateRefundResult,
} from '@/types/refunds.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /bookings/:bookingId` · `bookings.read` — one booking, everyone involved,
 * and the eight interventions.
 *
 * ── Who sees what ─────────────────────────────────────────────────────────────
 * Every tier reads it all, except the meeting link's TEXT (`bookings.access.read`,
 * tiers 1–2 — absent from Support's response, see `BookingAccessPanel`).
 * Buttons gate on their own permission and on whether the booking can take the
 * action: `bookings.settle` (cancel, cancel the class, complete, record cash),
 * `bookings.intervene` (re-check, withdraw) and `bookings.remind` (every tier).
 * **Activity** needs `audit.read` too; the payout card and the money link need
 * `money.earnings.read`. A tab or card the reader cannot use is omitted.
 *
 * ── A write answers the fresh booking ─────────────────────────────────────────
 * Each write's `booking` is held as `{ over, next }` so the page redraws from it
 * without a second read, and the next load of the record drops it. ⚠ A `null`
 * `booking` (the re-read missed after the write committed) reloads instead.
 *
 * ── A 200 on a cancel says nothing about the money ────────────────────────────
 * jovi-mall cancels first and refunds best-effort after. `result.refund` says what
 * happened; `BookingRefundNotice` holds `manual` and `failed` on screen, and reads
 * the same state off the booking when `refund` is absent or the page is reloaded.
 *
 * ── Complete is never offered on an unpaid booking ────────────────────────────
 * jovi-mall refuses it (`BOOKING_ADMIN_COMPLETE_UNPAID`); **Record cash** is
 * offered in its place. ⚠ The same refusal covers a price difference still owed on
 * a booking that reads `paid`, and Record cash cannot settle that one.
 *
 * ── The price is read-only ────────────────────────────────────────────────────
 * `BookingPricingCard` shows it. ⛔ No control here sets a price: only the shop
 * proposes and only the customer answers.
 */
export function BookingDetail() {
    const { bookingId = '' } = useParams();
    if (!OBJECT_ID.test(bookingId)) return <InvalidBookingId />;
    // Keyed: a seat links to a sibling booking on this same route, and what one
    // booking's write reported must not follow the operator onto the next.
    return <BookingDetailScreen key={bookingId} bookingId={bookingId} />;
}

function InvalidBookingId() {
    return (
        <PageContainer title="Booking not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid booking id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

/** The tabs a link may name — the ones every holder of `bookings.read` has. */
const LINKABLE_TABS = ['overview', 'history', 'payments', 'link', 'times'];

function BookingDetailScreen({ bookingId }: { bookingId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [searchParams] = useSearchParams();
    const [tab, setTab] = useState(() => {
        const requested = searchParams.get('tab');
        return requested && LINKABLE_TABS.includes(requested) ? requested : 'overview';
    });
    const [action, setAction] = useState<BookingAction | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [fresh, setFresh] = useState<{ over: BookingRecord | null; next: BookingRecord } | null>(null);
    // When the screen opened — enough to decide whether a reminder is worth
    // offering and whether a price proposal has lapsed. jovi-mall re-checks the
    // start time on the write itself.
    const [now] = useState(() => Date.now());
    /*
      Two answers that exist on their write's response and nowhere else. The
      follow-up itself is re-derived from the booking on every render, so a reload
      or a jovi-mall that sends no `refund` still shows it.
    */
    const [refundOutcome, setRefundOutcome] = useState<BookingCancelRefund | null>(null);
    const [sessionResult, setSessionResult] = useState<BookingSessionCancelResult | null>(null);
    const [raising, setRaising] = useState(false);
    const [raised, setRaised] = useState<CreateRefundResult | null>(null);

    const booking = useAsyncData(`/bookings/${bookingId}`, (signal) => getBooking(bookingId, { signal }));

    if (booking.isLoading) {
        return (
            <PageContainer title="Booking">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    const record = fresh && fresh.over === booking.data ? fresh.next : booking.data;

    if (!record) {
        return (
            <PageContainer title="Booking">
                <ErrorState error={booking.error} onRetry={booking.reload} deniedTitle="No such booking" />
                <BackLink />
            </PageContainer>
        );
    }

    function onWritten(write: BookingWriteResult<unknown>) {
        if (action === 'cancel' || action === 'cancel-session') {
            setRefundOutcome(bookingRefundOutcome(write.result, bookingId));
        }
        if (action === 'cancel-session') {
            const session = write.result as BookingSessionCancelResult | undefined;
            setSessionResult(Array.isArray(session?.cancelled) ? session : null);
        }
        setAction(null);
        if (write.booking) setFresh({ over: booking.data, next: write.booking });
        else booking.reload();
        setReloadToken((current) => current + 1);
    }

    function onStale() {
        setAction(null);
        booking.reload();
        setReloadToken((current) => current + 1);
    }

    const canSettle = can('bookings.settle');
    const refundFollowUp = bookingRefundFollowUp(record, refundOutcome);
    const unpaid = isUnpaidForCompletion(record);
    const owed = bookingTopupOwed(record);
    const paidNoShow = isPaidNoShow(record);
    const canSeeActivity = can(['bookings.read', 'audit.read'], 'all');
    const canSeeMoney = can('money.earnings.read');
    const hasSeats = record.sessionSeats.length > 0;

    const button = (next: BookingAction, label: string, icon: ReactNode, variant: 'outline' | 'destructive' = 'outline') => (
        <Button key={next} variant={variant} size="sm" onClick={() => setAction(next)}>
            {icon}
            {label}
        </Button>
    );

    return (
        <PageContainer
            title={bookingDisplayName(record)}
            description={<CopyableId value={record.id} label="booking ID" truncate={false} />}
            actions={
                <>
                    {canSettle && canCompleteBooking(record) && !unpaid
                        ? button('complete', 'Complete', <CheckCircle2 className="size-4" />)
                        : null}
                    {canSettle && canRecordCash(record)
                        ? button('cash', 'Record cash', <Banknote className="size-4" />)
                        : null}
                    {can('bookings.intervene') && canRecheckBookingPayment(record)
                        ? button('recheck', 'Re-check payment', <RefreshCcw className="size-4" />)
                        : null}
                    {can('bookings.intervene') && canWithdrawBookingProposal(record)
                        ? button('withdraw', 'Withdraw proposal', <Undo className="size-4" />)
                        : null}
                    {can('bookings.remind') && canRemindBooking(record, now)
                        ? button('remind', 'Remind the customer', <BellRing className="size-4" />)
                        : null}
                    {can('bookings.remind') && canRemindBooking(record, now)
                        ? button('remind-vendor', 'Remind the vendor', <BellRing className="size-4" />)
                        : null}
                    {canSettle && canCancelBookingSession(record)
                        ? button('cancel-session', 'Cancel whole class', <CalendarX2 className="size-4" />)
                        : null}
                    {canSettle && canCancelBooking(record)
                        ? button('cancel', 'Cancel', <Ban className="size-4" />, 'destructive')
                        : null}
                </>
            }
        >
            <BackLink />

            {refundFollowUp ? (
                <BookingRefundNotice booking={record} followUp={refundFollowUp} onRaise={() => setRaising(true)} />
            ) : null}

            {sessionResult ? (
                <BookingSessionNotice result={sessionResult} onDismiss={() => setSessionResult(null)} />
            ) : null}

            {raised ? (
                <RaisedRefundNotice result={raised} timeZone={timeZone} onDismiss={() => setRaised(null)} />
            ) : null}

            {paidNoShow ? (
                <div
                    role="status"
                    className="border-destructive/40 bg-destructive/10 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                    <p className="flex items-start gap-2">
                        <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                        <span>
                            <strong className="font-medium">A paid no-show waits for an administrator.</strong>{' '}
                            The shop marked it no-show after the customer paid, so the money is held with no
                            release date. Complete it (the shop is paid after the hold) or cancel it (the customer
                            is refunded).
                            {owed ? ' It cannot be completed while the customer still owes the price difference.' : null}
                            {canSettle ? null : ' An administrator who can settle bookings decides it.'}
                        </span>
                    </p>
                    {canSettle ? (
                        <div className="flex flex-wrap gap-2">
                            {unpaid ? null : button('complete', 'Complete', <CheckCircle2 className="size-4" />)}
                            {button('cancel', 'Cancel and refund', <Ban className="size-4" />, 'destructive')}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {canSettle && canCompleteBooking(record) && unpaid ? (
                <p className="bg-muted/40 rounded-md border p-3 text-sm">
                    {owed ? (
                        <>
                            It cannot be completed yet: the customer still owes{' '}
                            {formatMoney(owed.amount, record.currency)} since the price went up. Record cash does not
                            cover a price difference: the customer pays it through the platform, or the shop records it.
                        </>
                    ) : (
                        <>
                            It cannot be completed yet: it is not paid, so there is no held money to release.
                            {canRecordCash(record)
                                ? ' If the customer paid the shop in cash, record the cash first.'
                                : ' It was not booked for cash, so the customer has to pay through the platform.'}
                        </>
                    )}
                </p>
            ) : null}

            {record.proposal ? <ProposalCard record={record} timeZone={timeZone} /> : null}

            <BookingPricingCard record={record} timeZone={timeZone} now={now} />

            {canSeeMoney ? (
                <EarningsPauseCard
                    kind="booking"
                    id={record.id}
                    reference={record.bookingNumber}
                    timeZone={timeZone}
                    reloadToken={reloadToken}
                    onChanged={() => setReloadToken((current) => current + 1)}
                />
            ) : null}

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <div className="overflow-x-auto">
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="history">Status history</TabsTrigger>
                        <TabsTrigger value="payments">Payments and refunds</TabsTrigger>
                        {hasSeats ? <TabsTrigger value="class">Class</TabsTrigger> : null}
                        <TabsTrigger value="link">Meeting link</TabsTrigger>
                        <TabsTrigger value="times">Bookable times</TabsTrigger>
                        {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                    </TabsList>
                </div>

                <TabsContent value="overview" className="space-y-4">
                    <OverviewPanel record={record} timeZone={timeZone} can={can} />
                </TabsContent>

                <TabsContent value="history">
                    <StatusHistory record={record} timeZone={timeZone} can={can} />
                </TabsContent>

                <TabsContent value="payments" className="space-y-4">
                    <MoneyPanel record={record} timeZone={timeZone} can={can} />
                </TabsContent>

                {hasSeats ? (
                    <TabsContent value="class">
                        <SeatsPanel record={record} timeZone={timeZone} />
                    </TabsContent>
                ) : null}

                <TabsContent value="link">
                    <BookingAccessPanel
                        bookingId={record.id}
                        access={record.access}
                        timeZone={timeZone}
                        reloadToken={reloadToken}
                    />
                </TabsContent>

                <TabsContent value="times">
                    <BookingAvailabilityPanel
                        productId={record.service.id}
                        timeZone={timeZone}
                        title={`Bookable times for ${record.service.name ?? 'this service'}`}
                    />
                </TabsContent>

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <BookingActivityPanel bookingId={record.id} timeZone={timeZone} reloadToken={reloadToken} />
                    </TabsContent>
                ) : null}
            </Tabs>

            <BookingActionDialog
                action={action}
                booking={record}
                onOpenChange={(open) => {
                    if (!open) setAction(null);
                }}
                onDone={onWritten}
                onStale={onStale}
                onSwitch={setAction}
            />

            {raising ? (
                <RaiseRefundDialog
                    open
                    onOpenChange={setRaising}
                    source={{ kind: 'booking', id: record.id, label: bookingDisplayName(record) }}
                    onRaised={(result) => {
                        setRaised(result);
                        setRefundOutcome(null);
                        booking.reload();
                        setReloadToken((current) => current + 1);
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewPanel({ record, timeZone, can }: { record: BookingRecord; timeZone: string; can: CanPredicate }) {
    const earnings = bookingEarningsCopy(record.earnings.state);
    const { meetingUrl } = bookingAccessText(record.access);

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Who</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Customer">
                            <div className="space-y-0.5">
                                <NamedLink
                                    name={record.customer.name}
                                    id={record.customer.id}
                                    idLabel="customer user ID"
                                    to={can('users.read') ? `/dashboard/users/${encodeURIComponent(record.customer.id)}` : undefined}
                                />
                                {record.customer.phone ? (
                                    <CopyableValue variant="phone" value={record.customer.phone} label="customer phone" />
                                ) : null}
                                {record.customer.email ? (
                                    <CopyableValue variant="email" value={record.customer.email} label="customer email" />
                                ) : null}
                                {record.customer.customerId ? (
                                    <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                                        Customer profile
                                        <CopyableValue value={record.customer.customerId} label="customer profile ID" />
                                    </p>
                                ) : (
                                    <p className="text-muted-foreground text-xs">No customer profile on this account</p>
                                )}
                            </div>
                        </Definition>
                        <Definition label="Shop">
                            <NamedLink
                                name={record.vendor.name}
                                id={record.vendor.id}
                                idLabel="shop ID"
                                to={can('vendors.read') ? `/dashboard/vendors/${encodeURIComponent(record.vendor.id)}` : undefined}
                            />
                        </Definition>
                        <Definition label="Service">
                            <NamedLink
                                name={record.service.name}
                                id={record.service.id}
                                idLabel="service ID"
                                to={
                                    can('vendors.read')
                                        ? `/dashboard/vendors/${encodeURIComponent(record.vendor.id)}/products/${encodeURIComponent(record.service.id)}`
                                        : undefined
                                }
                            />
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>When and where</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Status">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <BookingStatusBadge status={record.status} />
                                <BookingPaymentBadge status={record.paymentStatus} />
                            </div>
                        </Definition>
                        <Definition label="Starts">{formatInstantInZone(record.startAt, timeZone) ?? <NotSet />}</Definition>
                        <Definition label="Ends">{formatInstantInZone(record.endAt, timeZone) ?? <NotSet />}</Definition>
                        <Definition label="Place">
                            <Place record={record} />
                        </Definition>
                        <Definition label="Meeting link">
                            {record.access === null ? (
                                'No'
                            ) : record.access.hasMeetingUrl ? (
                                meetingUrl ? (
                                    <CopyableValue variant="plain" mono value={meetingUrl} label="meeting link" />
                                ) : (
                                    'Yes — see the Meeting link tab for whether the customer can see it'
                                )
                            ) : (
                                'No'
                            )}
                        </Definition>
                        <Definition label="Customer’s note">
                            {record.customerNote ? (
                                <p className="whitespace-pre-wrap">{record.customerNote}</p>
                            ) : (
                                <NotSet>None</NotSet>
                            )}
                        </Definition>
                        <Definition label="Shop’s calendar">
                            {record.calendarEventId ? (
                                <CopyableValue variant="plain" mono value={record.calendarEventId} label="calendar event ID" />
                            ) : (
                                <NotSet>Not on the shop’s calendar</NotSet>
                            )}
                        </Definition>
                        <Definition label="Booked">{formatInstantInZone(record.createdAt, timeZone) ?? <NotSet />}</Definition>
                        {record.completedAt ? (
                            <Definition label="Completed">{formatInstantInZone(record.completedAt, timeZone)}</Definition>
                        ) : null}
                        {record.cancelledAt ? (
                            <Definition label="Cancelled">{formatInstantInZone(record.cancelledAt, timeZone)}</Definition>
                        ) : null}
                        {record.cancelledReason ? (
                            <Definition label="Cancellation reason">
                                <p className="whitespace-pre-wrap">{record.cancelledReason}</p>
                                <p className="text-muted-foreground text-xs">The customer and the shop both see this.</p>
                            </Definition>
                        ) : null}
                    </DefinitionList>
                </CardContent>
            </Card>

            {record.partyReminders ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Reminders between the two sides</CardTitle>
                        <CardDescription>
                            Each side can send the other one reminder. The reminder buttons on this page are separate:
                            they do not show here and do not use these up.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="The vendor reminded the customer">
                                {formatInstantInZone(record.partyReminders.toCustomerAt, timeZone) ?? <NotSet>Not sent</NotSet>}
                            </Definition>
                            <Definition label="The customer reminded the vendor">
                                {formatInstantInZone(record.partyReminders.toVendorAt, timeZone) ?? <NotSet>Not sent</NotSet>}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>The shop’s money</CardTitle>
                    <CardDescription>Where it stands, without amounts.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <DefinitionList>
                        <Definition label="Agreed price">
                            {formatMoney(record.price, record.currency)}
                            {record.pricing && record.pricing.originalPrice !== record.price ? (
                                <span className="text-muted-foreground ml-2 text-xs">
                                    booked at {formatMoney(record.pricing.originalPrice, record.currency)}
                                </span>
                            ) : null}
                            {!record.requiresPayment ? (
                                <span className="text-muted-foreground ml-2 text-xs">no payment required</span>
                            ) : null}
                        </Definition>
                        <Definition label="Shop’s earnings">
                            <div className="space-y-1">
                                <BookingEarningsBadge state={record.earnings.state} />
                                {earnings.means ? <p className="text-muted-foreground text-xs">{earnings.means}</p> : null}
                            </div>
                        </Definition>
                        {record.earnings.holdReleaseAt ? (
                            <Definition label="Released at">
                                {formatInstantInZone(record.earnings.holdReleaseAt, timeZone)}
                            </Definition>
                        ) : null}
                        {record.earnings.releasedAt ? (
                            <Definition label="Released">{formatInstantInZone(record.earnings.releasedAt, timeZone)}</Definition>
                        ) : null}
                        {record.earnings.pause ? (
                            <Definition label="Paused">
                                <div className="space-y-0.5">
                                    <p>{pauseReasonLabel(record.earnings.pause.reason)}</p>
                                    {record.earnings.pause.note ? (
                                        <p className="text-muted-foreground text-xs">{record.earnings.pause.note}</p>
                                    ) : null}
                                    {record.earnings.pause.pausedAt ? (
                                        <p className="text-muted-foreground text-xs">
                                            since {formatInstantInZone(record.earnings.pause.pausedAt, timeZone)}
                                        </p>
                                    ) : null}
                                </div>
                            </Definition>
                        ) : null}
                    </DefinitionList>
                    {can('money.earnings.read') ? (
                        <Link
                            to={`/dashboard/money/transactions?bookingId=${encodeURIComponent(record.id)}`}
                            className="text-sm font-medium hover:underline"
                        >
                            See the amounts — every money movement for this booking
                        </Link>
                    ) : null}
                </CardContent>
            </Card>
        </>
    );
}

function Place({ record }: { record: BookingRecord }) {
    const location = record.location;
    if (!location) {
        return record.locationKind === 'online' ? <span>Online</span> : <NotSet>No place recorded</NotSet>;
    }
    const lines = [
        location.addressLine1,
        location.addressLine2,
        [location.city, location.state].filter(Boolean).join(', ') || null,
        location.country,
    ].filter((line): line is string => Boolean(line));

    return (
        <div className="space-y-0.5">
            <p className="font-medium">{location.label ?? humaniseEnum(location.kind) ?? location.kind}</p>
            {location.formattedAddress ? (
                <p>{location.formattedAddress}</p>
            ) : lines.length > 0 ? (
                lines.map((line) => <p key={line}>{line}</p>)
            ) : null}
            <p className="text-muted-foreground text-xs">
                {location.kind === 'customer_address'
                    ? 'At the customer’s own address.'
                    : location.kind === 'vendor_address'
                      ? 'At the shop.'
                      : humaniseEnum(location.kind)}
            </p>
        </div>
    );
}

function ProposalCard({ record, timeZone }: { record: BookingRecord; timeZone: string }) {
    const proposal = record.proposal!;
    const by = proposal.proposedBy === 'vendor' ? 'The shop' : proposal.proposedBy === 'customer' ? 'The customer' : proposal.proposedBy;
    return (
        <Card className={proposal.live ? 'border-warning/40' : undefined}>
            <CardHeader>
                <CardTitle>{proposal.live ? 'A new time is proposed' : 'Last proposal of a new time'}</CardTitle>
                <CardDescription>
                    {proposal.live
                        ? `${by} proposed it. It waits for the other side to answer.`
                        : `${by} proposed it — ${
                              // `lapsed` is written lazily: an expired one can still read `open`.
                              proposal.status === 'open'
                                  ? 'it expired unanswered'
                                  : (humaniseEnum(proposal.status)?.toLowerCase() ?? proposal.status)
                          }.`}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Proposed time">
                        {formatInstantInZone(proposal.startAt, timeZone)} – {formatInstantInZone(proposal.endAt, timeZone)}
                    </Definition>
                    <Definition label="Time it replaces">
                        {formatInstantInZone(proposal.previousStartAt, timeZone)} –{' '}
                        {formatInstantInZone(proposal.previousEndAt, timeZone)}
                    </Definition>
                    {typeof proposal.price === 'number' ? (
                        <Definition label="Price with this time">
                            <p>{formatMoney(proposal.price, record.currency)}</p>
                            <p className="text-muted-foreground text-xs">
                                {typeof proposal.previousPrice === 'number'
                                    ? `Replaces ${formatMoney(proposal.previousPrice, record.currency)}. `
                                    : ''}
                                The time and the price are answered together.
                            </p>
                        </Definition>
                    ) : null}
                    <Definition label="Proposed">{formatInstantInZone(proposal.proposedAt, timeZone)}</Definition>
                    <Definition label="Answer due by">
                        {formatInstantInZone(proposal.expiresAt, timeZone)}
                    </Definition>
                    {proposal.answeredAt ? (
                        <Definition label="Answered">{formatInstantInZone(proposal.answeredAt, timeZone)}</Definition>
                    ) : null}
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

// ─── Status history ───────────────────────────────────────────────────────────

const ACTOR_ROLE_LABELS: Record<string, string> = {
    customer: 'Customer',
    vendor: 'Shop',
    admin: 'Administrator',
    system: 'The platform',
};

function StatusHistory({ record, timeZone, can }: { record: BookingRecord; timeZone: string; can: CanPredicate }) {
    if (record.statusHistory.length === 0) {
        return (
            <EmptyState
                title="Not recorded"
                description="Bookings made before 27 October 2026 have no status history. This does not mean nothing happened — only that it was not written down."
            />
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Status history</CardTitle>
                <CardDescription>Who changed the status and when, oldest first.</CardDescription>
            </CardHeader>
            <CardContent>
                <ol className="space-y-3">
                    {record.statusHistory.map((change, index) => (
                        <li key={`${change.at}-${index}`} className="border-l-2 pl-3">
                            <p className="text-sm">
                                {change.from ? `${bookingStatusLabel(change.from)} → ` : ''}
                                <strong className="font-medium">{bookingStatusLabel(change.to)}</strong>
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {formatInstantInZone(change.at, timeZone) ?? change.at} · <Actor change={change} can={can} />
                            </p>
                            {change.reason ? <p className="mt-0.5 text-sm whitespace-pre-wrap">{change.reason}</p> : null}
                        </li>
                    ))}
                </ol>
            </CardContent>
        </Card>
    );
}

function Actor({ change, can }: { change: BookingStatusChange; can: CanPredicate }) {
    const role = ACTOR_ROLE_LABELS[change.actorRole] ?? change.actorRole;
    if (change.actorRole === 'system' || !change.actorId) return <span>{change.actorName ?? role}</span>;

    const id = encodeURIComponent(change.actorId);
    const to =
        change.actorRole === 'customer' && can('users.read')
            ? `/dashboard/users/${id}`
            : change.actorRole === 'vendor' && can('vendors.read')
              ? `/dashboard/vendors/${id}`
              : change.actorRole === 'admin' && can('administrators.read')
                ? `/dashboard/administrators/${id}`
                : undefined;
    const name = change.actorName ?? change.actorId;

    return (
        <span>
            {role}:{' '}
            {to ? (
                <Link to={to} className="hover:underline">
                    {name}
                </Link>
            ) : (
                name
            )}
        </span>
    );
}

// ─── Payments, refunds, the class ─────────────────────────────────────────────

function MoneyPanel({ record, timeZone, can }: { record: BookingRecord; timeZone: string; can: CanPredicate }) {
    const paymentColumns: Column<BookingPayment>[] = [
        {
            id: 'createdAt',
            header: 'When',
            className: 'align-top text-sm',
            cell: (row) => {
                const when = formatInstantInZone(row.createdAt, timeZone) ?? row.createdAt;
                return can('money.payments.read') ? (
                    <Link to={`/dashboard/money/payments/${encodeURIComponent(row.id)}`} className="font-medium hover:underline">
                        {when}
                    </Link>
                ) : (
                    when
                );
            },
        },
        {
            id: 'purpose',
            header: 'For',
            className: 'align-top text-sm',
            cell: (row) => (row.purpose === 'booking_balance' ? 'Balance' : row.purpose === 'primary' ? 'Booking' : row.purpose),
        },
        {
            id: 'how',
            header: 'How',
            className: 'align-top text-sm',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p>{[row.gateway, row.method].filter(Boolean).join(' · ') || <NotSet />}</p>
                    {row.reference ? <CopyableValue variant="plain" mono value={row.reference} label="payment reference" className="text-xs" /> : null}
                </div>
            ),
        },
        {
            id: 'amount',
            header: 'Amount',
            numeric: true,
            className: 'align-top',
            cell: (row) => formatMoney(row.amount, row.currency),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top text-sm',
            cell: (row) => humaniseEnum(row.status) ?? row.status,
        },
    ];

    const refundColumns: Column<BookingRefund>[] = [
        {
            id: 'createdAt',
            header: 'Raised',
            className: 'align-top text-sm',
            cell: (row) => {
                const when = formatInstantInZone(row.createdAt, timeZone) ?? row.createdAt;
                return (
                    <div className="space-y-0.5">
                        {can('orders.refund.read') ? (
                            <Link to={refundDetailPath(row.id)} className="font-medium hover:underline">
                                {when}
                            </Link>
                        ) : (
                            <p>{when}</p>
                        )}
                        <p className="text-muted-foreground text-xs">
                            {refundReasonKindLabel(row.reasonKind)}
                            {row.requestedBy ? ` · by ${row.requestedBy}` : ''}
                        </p>
                        {isGoodwillRefundLive(row) && record.status !== 'cancelled' ? (
                            <p className="text-muted-foreground text-xs">
                                This can be the difference going back after a rescheduled price went down. The booking
                                stays as it is.
                            </p>
                        ) : null}
                    </div>
                );
            },
        },
        {
            id: 'amount',
            header: 'Gross / fee / net',
            numeric: true,
            className: 'align-top text-sm',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p>{formatMoney(row.grossAmount, row.currency)}</p>
                    <p className="text-muted-foreground text-xs">
                        fee {row.feeAmount === null ? '—' : formatMoney(row.feeAmount, row.currency)} · net{' '}
                        {row.netAmount === null ? '—' : formatMoney(row.netAmount, row.currency)}
                    </p>
                    {row.feesPaidBy ? (
                        <p className="text-muted-foreground text-xs">
                            fees paid by {row.feesPaidBy === 'vendor' ? 'the shop' : row.feesPaidBy === 'customer' ? 'the customer' : row.feesPaidBy}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top text-sm',
            cell: (row) => refundStatusLabel(row.status),
        },
    ];

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Payments</CardTitle>
                    <CardDescription>Every attempt, oldest first, balance payments included.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <DefinitionList>
                        <Definition label="Status">
                            <BookingPaymentBadge status={record.paymentStatus} />
                        </Definition>
                        <Definition label="Method">{record.paymentMethod ? humaniseEnum(record.paymentMethod) : <NotSet>Not chosen yet</NotSet>}</Definition>
                        <Definition label="Paid">{formatInstantInZone(record.paidAt, timeZone) ?? <NotSet>Not paid</NotSet>}</Definition>
                    </DefinitionList>
                    <DataTable
                        caption="Payments on this booking"
                        columns={paymentColumns}
                        rows={record.payments}
                        rowKey={(row) => row.id}
                        isLoading={false}
                        empty={<EmptyState title="No payment" description="Nothing was ever charged for this booking." />}
                    />
                </CardContent>
            </Card>

            {record.settlement ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Final price</CardTitle>
                        <CardDescription>Worked out after the session, for a service priced by duration. Printed as sent.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Final price">{formatMoney(record.settlement.finalPrice, record.currency)}</Definition>
                            <Definition label="Pricing">{humaniseEnum(record.settlement.pricingMode) ?? record.settlement.pricingMode}</Definition>
                            <Definition label="Settled">{formatInstantInZone(record.settlement.settledAt, timeZone)}</Definition>
                            <Definition label="Balance due">{formatMoney(record.settlement.balanceDue, record.currency)}</Definition>
                            <Definition label="Balance paid">
                                {formatMoney(record.settlement.balancePaid, record.currency)}
                                {record.settlement.balancePaidAt ? ` on ${formatInstantInZone(record.settlement.balancePaidAt, timeZone)}` : ''}
                                {record.settlement.balancePaymentMethod ? ` · ${humaniseEnum(record.settlement.balancePaymentMethod)}` : ''}
                            </Definition>
                            <Definition label="Credit owed to the customer">{formatMoney(record.settlement.creditDue, record.currency)}</Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>Refunds</CardTitle>
                    <CardDescription>
                        Every refund request on this booking, newest first. Where the money is sent is on the
                        request in the refund queue.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        caption="Refund requests on this booking"
                        columns={refundColumns}
                        rows={record.refunds}
                        rowKey={(row) => row.id}
                        isLoading={false}
                        empty={<EmptyState title="No refund" description="Nobody has asked for money back on this booking." />}
                    />
                </CardContent>
            </Card>
        </>
    );
}

function SeatsPanel({ record, timeZone }: { record: BookingRecord; timeZone: string }) {
    const columns: Column<BookingListItem>[] = [
        {
            id: 'booking',
            header: 'Booking',
            className: 'align-top',
            cell: (row) => (
                <Link to={bookingDetailPath(row.id)} className="font-medium hover:underline">
                    {bookingDisplayName(row)}
                </Link>
            ),
        },
        {
            id: 'customer',
            header: 'Customer',
            className: 'align-top text-sm',
            cell: (row) => row.customer.name ?? <CopyableValue value={row.customer.id} label="customer user ID" />,
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => (
                <div className="flex flex-col items-start gap-1">
                    <BookingStatusBadge status={row.status} />
                    <BookingPaymentBadge status={row.paymentStatus} />
                </div>
            ),
        },
        {
            id: 'booked',
            header: 'Booked',
            className: 'align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? row.createdAt,
        },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle>The rest of the class</CardTitle>
                <CardDescription>
                    {formatCount(record.sessionSeats.length)} other booking{record.sessionSeats.length === 1 ? '' : 's'} still on for
                    the same service at the same time.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <DataTable
                    caption="Other seats in this class"
                    columns={columns}
                    rows={record.sessionSeats}
                    rowKey={(row) => row.id}
                    isLoading={false}
                />
            </CardContent>
        </Card>
    );
}

/** A name linked to its screen, over the copyable id — or the id alone. */
function NamedLink({ name, id, idLabel, to }: { name: string | null; id: string; idLabel: string; to?: string }) {
    if (!name) return <CopyableValue value={id} label={idLabel} truncate={false} to={to} />;
    return (
        <div className="space-y-0.5">
            {to ? (
                <Link to={to} className="font-medium hover:underline">
                    {name}
                </Link>
            ) : (
                <p className="font-medium">{name}</p>
            )}
            <CopyableValue value={id} label={idLabel} truncate={false} className="text-xs" />
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/bookings"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All bookings
        </Link>
    );
}
