import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { DestinationSummary } from '@/components/money/DestinationSummary';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatInstantInZone } from '@/lib/format';
import { notify } from '@/lib/notify';
import { revealPayoutDestination } from '@/services/money.service';
import { ApiError } from '@/types/api.types';
import {
    CODE_PAYOUT_DESTINATION_ABSENT,
    type PayoutDestination,
} from '@/types/money.types';

interface PayoutDestinationRevealProps {
    payoutId: string;
    /** The masked destination the payout row already carries. */
    destination: PayoutDestination | null;
    timeZone: string;
    /** Switches the detail screen to its Activity tab, filtered to disclosures. */
    onShowDisclosures?: () => void;
}

type RevealState =
    | { status: 'idle' }
    | { status: 'revealing' }
    | { status: 'revealed'; value: PayoutDestination; at: string }
    | { status: 'absent' }
    | { status: 'failed'; error: unknown };

/**
 * The masked destination, and the one control on this dashboard that discloses a
 * beneficiary's account number.
 *
 * ── Why this is a card and not a tab ──────────────────────────────────────────
 * A tab implies "content that loads when you open it", which is precisely the
 * shape that must not exist here: `GET /money/payouts/:payoutId/destination` is
 * **the only audited read on the service**, and it commits an audit row *before*
 * it reads the value. Opening a tab is not consent to being on the record.
 *
 * ── Why the fetch is imperative ───────────────────────────────────────────────
 * `useAsyncData` fires on mount and on every key change, so a reload-token bump
 * or React StrictMode's double-effect would each write a **second real
 * disclosure** against the operator's name. The request is therefore made from
 * the confirm handler alone, once, with the control disabled while in flight so a
 * double-click cannot write two rows. Nothing here retries automatically — a
 * retry is another disclosure.
 *
 * ── Why the value is never lifted out of this component ───────────────────────
 * Radix unmounts an inactive `TabsContent`, so switching tabs already discards
 * it. Keeping the number in local state makes that deliberate rather than
 * incidental: it is never put in a store, the URL, `sessionStorage`, a toast
 * (which outlives the screen) or a `useAsyncData` key.
 *
 * ── Reading the answer ────────────────────────────────────────────────────────
 * Branch on `revealed`, **never on `full` being non-null**. A card destination is
 * disclosed with `revealed: true` and every `full` member `null`, because its
 * only number is the `last4` already on the masked side. That is a completed
 * disclosure with nothing further to give, not a failure.
 */
export function PayoutDestinationReveal({
    payoutId,
    destination,
    timeZone,
    onShowDisclosures,
}: PayoutDestinationRevealProps) {
    const [state, setState] = useState<RevealState>({ status: 'idle' });
    const [confirmOpen, setConfirmOpen] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // An in-flight disclosure whose screen has gone is still a disclosure; abort
    // it rather than let it resolve into a component nobody is looking at.
    useEffect(() => () => abortRef.current?.abort(), []);

    async function reveal() {
        setConfirmOpen(false);
        setState({ status: 'revealing' });

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const value = await revealPayoutDestination(payoutId, { signal: controller.signal });
            setState({ status: 'revealed', value, at: new Date().toISOString() });
        } catch (error) {
            if (controller.signal.aborted) return;

            if (error instanceof ApiError && error.code === CODE_PAYOUT_DESTINATION_ABSENT) {
                setState({ status: 'absent' });
                return;
            }

            setState({ status: 'failed', error });
            notify.apiError(error, 'Could not reveal the destination');
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    Destination
                    <InfoHint label="About the destination">
                        Where this request was addressed, frozen when it was made. The account
                        number is not read on this page at all — the query behind it never names
                        those columns — so an operator recognises a destination by its provider
                        and account name. The digits are behind a separate, audited action.
                    </InfoHint>
                </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
                <DefinitionList>
                    <Definition label="Addressed to">
                        <DestinationSummary destination={destination} />
                    </Definition>
                </DefinitionList>

                {destination === null ? (
                    /*
                     * Nothing to disclose, so no button: this payout predates the
                     * destination snapshot. Spending an audit row to learn that
                     * would put a disclosure on the record that disclosed
                     * nothing. The 422 handler stays for the race where the row
                     * is legacy but the list said otherwise.
                     */
                    <p className="text-muted-foreground text-sm">
                        This request predates the destination snapshot, so there is no account
                        number recorded against it.
                    </p>
                ) : (
                    <RevealArea
                        state={state}
                        confirmOpen={confirmOpen}
                        onConfirmOpenChange={setConfirmOpen}
                        onReveal={reveal}
                        onHide={() => setState({ status: 'idle' })}
                        timeZone={timeZone}
                        onShowDisclosures={onShowDisclosures}
                    />
                )}
            </CardContent>
        </Card>
    );
}

function RevealArea({
    state,
    confirmOpen,
    onConfirmOpenChange,
    onReveal,
    onHide,
    timeZone,
    onShowDisclosures,
}: {
    state: RevealState;
    confirmOpen: boolean;
    onConfirmOpenChange: (open: boolean) => void;
    onReveal: () => void;
    onHide: () => void;
    timeZone: string;
    onShowDisclosures?: () => void;
}) {
    if (state.status === 'revealed') {
        return (
            <RevealedPanel
                destination={state.value}
                at={state.at}
                timeZone={timeZone}
                onHide={onHide}
                onShowDisclosures={onShowDisclosures}
            />
        );
    }

    if (state.status === 'absent') {
        /*
         * A 422, and deliberately not an ErrorState: the payout exists and simply
         * carries no snapshot. It is an answer, not a fault — and the attempt is
         * still on the record, which the operator should know.
         */
        return (
            <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
                <p className="font-medium">No account number is recorded against this payout.</p>
                <p className="text-muted-foreground">
                    It predates the destination snapshot. Ask the beneficiary for their current
                    details. <strong className="font-medium">The attempt is on the record.</strong>
                </p>
            </div>
        );
    }

    if (state.status === 'failed') {
        return (
            <div className="space-y-2">
                <ErrorState error={state.error} deniedTitle="Not available to you" />
                {/*
                  The fail-closed path matters here more than anywhere: the audit
                  row is committed before the value is read, so a failure means
                  nothing left the database. An operator must not walk away
                  assuming a leak.
                */}
                <p className="text-muted-foreground text-xs">
                    <strong className="font-medium">Nothing was disclosed.</strong> Revealing again
                    writes a new record.
                </p>
            </div>
        );
    }

    return (
        <Can permission="money.payouts.destination.read">
            <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
                <AlertDialogTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={state.status === 'revealing'}
                    >
                        {state.status === 'revealing' ? (
                            <InlineLoader label="Revealing…" />
                        ) : (
                            <>
                                <Eye className="size-4" />
                                Reveal account number
                            </>
                        )}
                    </Button>
                </AlertDialogTrigger>

                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Reveal this beneficiary&rsquo;s account number?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>
                                    <strong className="font-medium">This is recorded.</strong> Your
                                    name, the time and this payout are written to the audit trail{' '}
                                    <em>before</em> the number is read, and the record cannot be
                                    removed.
                                </p>
                                <p>
                                    Anyone holding the payout and audit permissions can see that
                                    you did it, on this payout&rsquo;s Activity tab.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onReveal}>Reveal and record</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Can>
    );
}

function RevealedPanel({
    destination,
    at,
    timeZone,
    onHide,
    onShowDisclosures,
}: {
    destination: PayoutDestination;
    at: string;
    timeZone: string;
    onHide: () => void;
    onShowDisclosures?: () => void;
}) {
    const phoneNumber = destination.full?.mobileMoney?.phoneNumber ?? null;
    const accountNumber = destination.full?.bank?.accountNumber ?? null;
    const value = phoneNumber ?? accountNumber;

    return (
        <div className="space-y-3 rounded-lg border p-3">
            {value ? (
                <DefinitionList>
                    <Definition label={phoneNumber ? 'Mobile money number' : 'Account number'}>
                        {/*
                          ── Why `plain`, and why the size is set here ──────────
                          This is the number an operator retypes into a banking
                          portal, which is the transcription error the copy
                          button exists to remove — so it must survive whole and
                          `id`'s head-and-tail shortening is exactly wrong for
                          it. `mono={false}` with the mono class supplied by
                          `className` is deliberate: the variant's own mono is
                          `text-xs`, and this one value is rendered large on
                          purpose because it is read as well as copied.

                          ⚠ The `label` follows the Definition's: a mobile-money
                          MSISDN and a bank account number are different things
                          and the copy button used to call both of them "account
                          number".
                        */}
                        <CopyableValue
                            variant="plain"
                            mono={false}
                            value={value}
                            label={phoneNumber ? 'mobile money number' : 'account number'}
                            className="font-mono text-lg font-medium"
                        />
                    </Definition>
                    <Definition label="As masked">
                        {/*
                          ⚠ No copy affordance here, deliberately. A mask is not a
                          value — there is nothing to paste anywhere — and offering
                          to copy it beside the real number invites copying the
                          wrong one.
                        */}
                        {destination.masked.mobileMoney?.phoneNumberMasked ??
                            destination.masked.bank?.accountNumberMasked ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            ) : (
                /*
                 * `revealed` is true and every `full` member is null — a card.
                 * Rendered as a neutral answer rather than an error or an empty
                 * state, because the disclosure DID happen and there was simply
                 * nothing further to give.
                 */
                <div className="space-y-1 text-sm">
                    <p className="font-medium">Disclosed — there was nothing further to give.</p>
                    <p className="text-muted-foreground">
                        A card destination&rsquo;s only number is the last four already shown; the
                        platform never stores a card number, so nothing was being hidden.{' '}
                        <strong className="font-medium">
                            This disclosure is still on the record.
                        </strong>
                    </p>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <p className="text-muted-foreground grow text-xs">
                    Revealed by you at {formatInstantInZone(at, timeZone) ?? 'just now'}.{' '}
                    <strong className="font-medium">This is recorded.</strong>
                </p>

                {onShowDisclosures ? (
                    <Button variant="ghost" size="sm" onClick={onShowDisclosures}>
                        See who has revealed this
                    </Button>
                ) : null}

                <Button variant="outline" size="sm" onClick={onHide}>
                    <EyeOff className="size-4" />
                    Hide
                </Button>
            </div>

            <p className="text-muted-foreground text-xs">
                Hiding does not un-record it, and revealing again writes a second record.
            </p>
        </div>
    );
}

/*
 * ── The local `RevealedValue` is gone ─────────────────────────────────────────
 * It hand-rolled what `CopyableValue` now does — and did it in a way that named
 * every disclosed number "account number", including the mobile-money ones. The
 * shared component reports a refused clipboard to a screen reader as well as in
 * the tooltip, and makes the number `select-all`, which is the fallback the old
 * warning toast could only describe.
 *
 * ⚠ Nothing about the DISCLOSURE changed. The reveal is still a confirmed,
 * imperative, once-only request; the copy affordance exists only after the
 * value has arrived, and never on the masked form beside it.
 */
