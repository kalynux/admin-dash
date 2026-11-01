import { LockKeyhole, LockKeyholeOpen, RotateCw } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { getBookingAccessState } from '@/services/bookings.service';
import {
    bookingAccessReasonCopy,
    bookingAccessText,
    type BookingAccessOnDetail,
} from '@/types/bookings.types';

/**
 * The meeting link and the shop's instructions — what the booking carries, and
 * whether the CUSTOMER can see them yet.
 *
 * ── Two questions, two sources ────────────────────────────────────────────────
 * *What is there* is the detail's `access` block. ⛔ The text itself
 * (`meetingUrl`, `instructions`) is sent only to `bookings.access.read` — tiers
 * 1–2 — and is **absent** for Support, who sees "has a link: yes / no" from
 * `hasMeetingUrl` and never an empty field.
 *
 * *Can the customer see it* is `GET /bookings/:id/access`, a delegated verdict
 * every tier may ask: Support answers "I can't see my link" with the reason it
 * is locked and a resent reminder, and never reads the link out.
 */
export function BookingAccessPanel({
    bookingId,
    access,
    timeZone,
    reloadToken,
}: {
    bookingId: string;
    access: BookingAccessOnDetail | null;
    timeZone: string;
    reloadToken: number;
}) {
    const verdict = useAsyncData(`/bookings/${bookingId}/access#${reloadToken}`, (signal) =>
        getBookingAccessState(bookingId, { signal }),
    );
    const text = bookingAccessText(access);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div className="space-y-1.5">
                        <CardTitle>Can the customer see the link?</CardTitle>
                        <CardDescription>
                            The platform’s own answer, as the customer’s app applies it right now.
                        </CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={verdict.reload}
                        disabled={verdict.isLoading || verdict.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Check again
                    </Button>
                </CardHeader>
                <CardContent>
                    {verdict.isLoading ? (
                        <InlineLoader label="Asking the platform…" />
                    ) : verdict.error && verdict.data === null ? (
                        <ErrorState error={verdict.error} onRetry={verdict.reload} />
                    ) : verdict.data === null ? (
                        <p className="text-muted-foreground text-sm">
                            This booking has no meeting link and no instructions, so there is nothing for the
                            customer to see.
                        </p>
                    ) : (
                        <DefinitionList>
                            <Definition label="Right now">
                                {verdict.data.state === 'open' ? (
                                    <Badge variant="outline" className="border-success/30 bg-success/10 text-success gap-1">
                                        <LockKeyholeOpen className="size-3.5" />
                                        Visible to the customer
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning gap-1">
                                        <LockKeyhole className="size-3.5" />
                                        {verdict.data.state === 'locked' ? 'Locked' : verdict.data.state}
                                    </Badge>
                                )}
                            </Definition>
                            {verdict.data.reason ? (
                                <Definition label="Why">{bookingAccessReasonCopy(verdict.data.reason)}</Definition>
                            ) : null}
                            <Definition label="Opens">
                                {formatInstantInZone(verdict.data.opensAt, timeZone) ?? <NotSet />}
                            </Definition>
                            <Definition label="Closes">
                                {formatInstantInZone(verdict.data.closesAt, timeZone) ?? <NotSet />}
                            </Definition>
                        </DefinitionList>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>On this booking</CardTitle>
                    {access && !access.visible ? (
                        <CardDescription>
                            The link and the instructions themselves are not shown at your level.
                        </CardDescription>
                    ) : null}
                </CardHeader>
                <CardContent>
                    {access === null ? (
                        <p className="text-muted-foreground text-sm">No meeting link and no instructions.</p>
                    ) : (
                        <DefinitionList>
                            <Definition label="Meeting link">
                                {!access.hasMeetingUrl ? (
                                    'No'
                                ) : text.meetingUrl ? (
                                    <CopyableValue variant="plain" mono value={text.meetingUrl} label="meeting link" />
                                ) : (
                                    'Yes'
                                )}
                            </Definition>
                            <Definition label="Instructions">
                                {!access.hasInstructions ? (
                                    'No'
                                ) : text.instructions ? (
                                    <p className="whitespace-pre-wrap">{text.instructions}</p>
                                ) : (
                                    'Yes'
                                )}
                            </Definition>
                            <Definition label="Shown to the customer">
                                {access.revealMinutesBefore === null ? (
                                    <NotSet>No time set</NotSet>
                                ) : (
                                    `${formatCount(access.revealMinutesBefore)} minutes before it starts`
                                )}
                            </Definition>
                        </DefinitionList>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
