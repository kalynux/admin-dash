import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Definition, DefinitionList } from '@/components/common/DefinitionList';
import { formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import {
    bookingPriceChangeLabel,
    bookingPriceHasChanges,
    bookingPriceProposalLabel,
    bookingTopupOwed,
    bookingTopupStatusLabel,
    isPriceProposalWaiting,
    type BookingDetail,
} from '@/types/bookings.types';

/**
 * `pricing` on the booking detail: the price against what was booked, the shop's
 * latest proposal, anything still owed, and every agreed change.
 *
 * ⛔ **Read-only, and it must stay that way.** Only the shop proposes a price and
 * only the customer answers it; an administrator has no route to set one.
 *
 * ⛔ Every figure is printed as sent. jovi-mall's `amountPaid` is not on this
 * service, and nothing here works it out from the others.
 *
 * Renders nothing on a booking whose price never moved, which is most of them, and
 * on an older service that sends no `pricing`.
 */
export function BookingPricingCard({
    record,
    timeZone,
    now,
}: {
    record: BookingDetail;
    timeZone: string;
    /** When the screen opened, the same instant the reminder buttons are judged by. */
    now: number;
}) {
    const pricing = record.pricing;
    if (!pricing || !bookingPriceHasChanges(record)) return null;

    const { proposal, topup, history } = pricing;
    const waiting = isPriceProposalWaiting(record, now);
    const owed = bookingTopupOwed(record);
    const money = (amount: number) => formatMoney(amount, record.currency);

    return (
        <Card role="region" aria-label="The booking’s price" className={waiting || owed ? 'border-warning/40' : undefined}>
            <CardHeader>
                <CardTitle>
                    {owed
                        ? 'The customer still owes a price difference'
                        : waiting
                          ? 'A new price is proposed'
                          : 'Changes to the price'}
                </CardTitle>
                <CardDescription>
                    For reading only. Only the shop proposes a price, and only the customer answers it.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <DefinitionList>
                    <Definition label="Agreed price">{money(record.price)}</Definition>
                    {pricing.originalPrice !== record.price ? (
                        <Definition label="Booked at">{money(pricing.originalPrice)}</Definition>
                    ) : null}
                </DefinitionList>

                {proposal ? (
                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">Latest proposal</h3>
                        <DefinitionList>
                            <Definition label="Proposed price">{money(proposal.amount)}</Definition>
                            <Definition label="Price it would replace">{money(proposal.previousAmount)}</Definition>
                            <Definition label="Status">{bookingPriceProposalLabel(record, proposal, now)}</Definition>
                            <Definition label="Proposed">{formatInstantInZone(proposal.proposedAt, timeZone)}</Definition>
                            <Definition label="Answer due by">{formatInstantInZone(proposal.expiresAt, timeZone)}</Definition>
                            {proposal.answeredAt ? (
                                <Definition label="Answered">{formatInstantInZone(proposal.answeredAt, timeZone)}</Definition>
                            ) : null}
                        </DefinitionList>
                    </section>
                ) : null}

                {topup ? (
                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">Price difference</h3>
                        <DefinitionList>
                            <Definition label="Amount">{money(topup.amount)}</Definition>
                            <Definition label="Status">{bookingTopupStatusLabel(record, topup)}</Definition>
                            {owed ? (
                                <Definition label="Due by">
                                    <p>{formatInstantInZone(owed.dueAt, timeZone)}</p>
                                    <p className="text-muted-foreground text-xs">
                                        {now >= new Date(owed.dueAt).getTime()
                                            ? 'This date has passed. The platform’s next check cancels the booking and refunds what was paid.'
                                            : 'If it is not paid by then, the booking is cancelled and what was paid is refunded.'}
                                    </p>
                                </Definition>
                            ) : null}
                            {topup.paidAt ? (
                                <Definition label="Paid">
                                    {formatInstantInZone(topup.paidAt, timeZone)}
                                    {topup.method ? ` · ${humaniseEnum(topup.method) ?? topup.method}` : ''}
                                </Definition>
                            ) : null}
                        </DefinitionList>
                    </section>
                ) : null}

                {history.length > 0 ? (
                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">Every agreed change, oldest first</h3>
                        <ol className="space-y-2">
                            {history.map((change, index) => (
                                <li key={`${change.at}-${index}`} className="border-l-2 pl-3">
                                    <p className="text-sm">
                                        {money(change.from)} → <strong className="font-medium">{money(change.to)}</strong>
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        {formatInstantInZone(change.at, timeZone) ?? change.at} · {bookingPriceChangeLabel(change.kind)}
                                    </p>
                                </li>
                            ))}
                        </ol>
                    </section>
                ) : null}
            </CardContent>
        </Card>
    );
}
