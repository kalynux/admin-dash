import { useState } from 'react';
import { Clock } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
import { InlineLoader } from '@/components/common/Loading';
import { AlreadyResolvedNotice } from '@/components/money/PayoutWriteDialogs';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { sendPayout, triagePayout } from '@/services/money.service';
import {
    endorsedByOf,
    gatewayShortfallOf,
    gatewayUnsupportedKind,
    isPayoutAlreadyTriaged,
    isPayoutNotPending,
    isPayoutTransferInFlight,
    PAYOUT_DUAL_CONTROL_THRESHOLD,
    resolvedPayoutStatusOf,
    type Payout,
} from '@/types/money.types';
import type { Approval } from '@/types/approvals.types';

/**
 * The two writes ADR-024 added: sending the money through the gateway, and the
 * tier-3 pre-screen that precedes it.
 *
 * They live beside `PayoutWriteDialogs` rather than inside it because they are
 * the two halves of the *new* workflow and neither shares a form with the old
 * pair — `/send` takes no body at all and `/triage` takes an optional note. What
 * they do share, `AlreadyResolvedNotice`, is imported rather than copied.
 */

// ─── Send through the gateway ─────────────────────────────────────────────────

/**
 * What a `200` from `/send` actually said.
 *
 * ⛔ **Three outcomes, and only one of them is "paid".** The status code says the
 * request was accepted, never that money arrived — so this is read off
 * `data.status` and nothing else.
 */
type SendOutcome =
    | { kind: 'processing'; payout: Payout }
    | { kind: 'paid'; payout: Payout }
    | { kind: 'failed'; payout: Payout };

function outcomeOf(payout: Payout): SendOutcome {
    if (payout.status === 'paid') return { kind: 'paid', payout };
    if (payout.status === 'failed') return { kind: 'failed', payout };
    /*
      Anything else — `processing`, or a status this build has not heard of —
      reads as in flight. That is the safe default rather than a lazy one: it
      claims nothing settled and nothing returned, which is true of every
      non-terminal state, and the two claims that would be wrong are exactly the
      two that matter.
    */
    return { kind: 'processing', payout };
}

interface SendPayoutDialogProps {
    payout: Payout;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The transfer resolved one way or another — re-read the record. */
    onSettled: () => void;
    /** A `202` — **nothing was sent**. */
    onQueued: (approval: Approval, message?: string) => void;
    /** Offer the manual path, where the caller has one to offer. */
    onMarkPaidInstead?: () => void;
}

/**
 * `POST /money/payouts/:payoutId/send` · `money.payouts.mark_paid`
 * (`financial` + `dual-control`) — the platform sends the money itself.
 *
 * ── Why the outcome is shown here instead of as a toast ──────────────────────
 * The usual answer is `processing`, which is neither a success an operator can
 * walk away from nor a failure. `failed` is sharper still: it means **the gateway
 * refused the transfer and the funds are still held**, so the request is open and
 * needs a retry or a rejection. A four-second toast is the wrong carrier for
 * either, so the dialog stays open and says what happened.
 *
 * ── Retry is this same call ──────────────────────────────────────────────────
 * `POST /send` on a `failed` payout re-sends it, and the backend reuses the
 * stored provider reference (ADR-024 D-8) so a transfer that actually succeeded
 * and merely failed to report is deduplicated by the provider rather than paying
 * the owner twice. There is **no retry endpoint and no client-side idempotency
 * key** — minting one per attempt is precisely what would defeat that.
 */
export function SendPayoutDialog({
    payout,
    open,
    onOpenChange,
    onSettled,
    onQueued,
    onMarkPaidInstead,
}: SendPayoutDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Send this payout</DialogTitle>
                    <DialogDescription>
                        Instructs the platform to send{' '}
                        {formatMoney(payout.amount, payout.currency)} to the beneficiary through
                        the payment gateway.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <SendPayoutForm
                    payout={payout}
                    onSettled={onSettled}
                    onQueued={onQueued}
                    onMarkPaidInstead={onMarkPaidInstead}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function SendPayoutForm({
    payout,
    onSettled,
    onQueued,
    onMarkPaidInstead,
    onCancel,
}: {
    payout: Payout;
    onSettled: () => void;
    onQueued: (approval: Approval, message?: string) => void;
    onMarkPaidInstead?: () => void;
    onCancel: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [outcome, setOutcome] = useState<SendOutcome | null>(null);
    const [failure, setFailure] = useState<unknown>(null);
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);
    const [alreadyResolved, setAlreadyResolved] = useState(false);

    const aboveThreshold = payout.amount >= PAYOUT_DUAL_CONTROL_THRESHOLD;
    const isRetry = payout.status === 'failed';

    async function submit() {
        setFailure(null);
        setOutcome(null);
        setAlreadyResolved(false);
        setSubmitting(true);

        try {
            const result = await sendPayout(payout.id);

            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }

            const next = outcomeOf(result.data);
            setOutcome(next);
            /*
              Reconcile on every outcome, `failed` included: the row has moved
              either way and the screen behind this dialog is showing a status
              that is now stale.
            */
            onSettled();

            if (next.kind === 'paid') notify.success('Payout sent and confirmed');
        } catch (error) {
            if (isPayoutNotPending(error)) {
                setResolvedStatus(resolvedPayoutStatusOf(error));
                setAlreadyResolved(true);
                return;
            }
            /*
              Everything else renders inline through `SendFailureNotice`, which
              branches on the platform code. Not a toast: the operator is
              mid-action, and several of these carry an instruction rather than
              just a fact.
            */
            setFailure(error);
        } finally {
            setSubmitting(false);
        }
    }

    if (alreadyResolved) {
        return <AlreadyResolvedNotice status={resolvedStatus} onReload={onSettled} />;
    }

    if (outcome) {
        return (
            <SendOutcomeNotice
                outcome={outcome}
                onRetry={submit}
                onClose={onCancel}
                submitting={submitting}
            />
        );
    }

    return (
        <div className="space-y-4">
            {failure ? (
                <SendFailureNotice
                    error={failure}
                    onRetry={submit}
                    onMarkPaidInstead={onMarkPaidInstead}
                    submitting={submitting}
                />
            ) : null}

            {aboveThreshold ? (
                <div className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm">
                    <Clock className="text-warning mt-0.5 size-4 shrink-0" />
                    <p>
                        {formatMoney(payout.amount, payout.currency)} is at or above the four-eyes
                        threshold. Submitting <strong>queues</strong> this for a second
                        administrator — <strong>nothing will be sent</strong> until they approve,
                        and you cannot approve your own request.
                    </p>
                </div>
            ) : null}

            {isRetry ? (
                <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-sm">
                    <p className="font-medium">This is a retry.</p>
                    <p className="text-muted-foreground">
                        The previous attempt failed and the funds are still held. The platform
                        re-sends this using the <strong>same provider reference</strong>, so a
                        transfer that in fact went through and only failed to report back is
                        recognised by the provider rather than paid a second time.
                    </p>
                </div>
            ) : (
                <p className="text-muted-foreground text-sm">
                    The gateway usually accepts a transfer without settling it immediately, so the
                    likely result is <strong>awaiting confirmation</strong> rather than paid.
                </p>
            )}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                    Cancel
                </Button>
                <Button type="button" onClick={submit} disabled={submitting}>
                    {submitting ? (
                        <InlineLoader label="Sending…" />
                    ) : isRetry ? (
                        'Retry the transfer'
                    ) : (
                        'Send now'
                    )}
                </Button>
            </DialogFooter>
        </div>
    );
}

/**
 * The three things a `200` can mean.
 *
 * ⛔ **On `failed`, "the funds are still held" comes first and in bold.** That is
 * the one sentence an administrator must not have to infer: the gateway refused
 * the transfer, nothing was returned to the owner, and the request is still open.
 */
function SendOutcomeNotice({
    outcome,
    onRetry,
    onClose,
    submitting,
}: {
    outcome: SendOutcome;
    onRetry: () => void;
    onClose: () => void;
    submitting: boolean;
}) {
    if (outcome.kind === 'paid') {
        return (
            <div className="space-y-3">
                <div className="space-y-1 rounded-md border p-3 text-sm">
                    <p className="font-medium">Paid.</p>
                    <p className="text-muted-foreground">
                        The gateway settled this transfer immediately.
                    </p>
                    <GatewayReference payout={outcome.payout} />
                </div>
                <DialogFooter>
                    <Button type="button" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    if (outcome.kind === 'processing') {
        return (
            <div className="space-y-3">
                <div className="space-y-1 rounded-md border p-3 text-sm">
                    <p className="font-medium">Sent to the provider — awaiting confirmation.</p>
                    <p className="text-muted-foreground">
                        This is <strong>not settled yet</strong>. The gateway confirms by callback,
                        and the payout stays in <em>processing</em> until it does. It cannot be
                        rejected while a transfer is in flight.
                    </p>
                    <GatewayReference payout={outcome.payout} />
                </div>
                <DialogFooter>
                    <Button type="button" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">The gateway refused the transfer.</p>
                <p>
                    <strong>The funds are still held.</strong> Nothing has been returned to the
                    owner and this request is still open — retry it, or reject it to release the
                    money back to their available balance.
                </p>
                {outcome.payout.transferFailureReason ? (
                    <p className="text-muted-foreground">
                        The provider said: {outcome.payout.transferFailureReason}
                    </p>
                ) : null}
                <GatewayReference payout={outcome.payout} />
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                    Close
                </Button>
                <Button type="button" onClick={onRetry} disabled={submitting}>
                    {submitting ? <InlineLoader label="Retrying…" /> : 'Retry the transfer'}
                </Button>
            </DialogFooter>
        </div>
    );
}

/** The provider's own id, for reconciling against their dashboard. */
function GatewayReference({ payout }: { payout: Payout }) {
    if (!payout.transferGatewayRef) return null;

    return (
        <p className="text-muted-foreground text-xs">
            Provider reference:{' '}
            <CopyableValue
                value={payout.transferGatewayRef}
                label="gateway transfer reference"
                truncate={false}
            />
        </p>
    );
}

/**
 * The refusals that need their own sentence, and their own affordances.
 *
 * ⛔ **Two of these must not offer a retry**, which is the reason this is a
 * component rather than a line of copy. `TRANSFER_IN_FLIGHT` means a transfer is
 * already running, so pressing send again is the double payment the whole design
 * exists to prevent. `GATEWAY_UNSUPPORTED` at `422` is permanent for this
 * destination, so a retry can only fail again — the way forward is the manual
 * path, offered here as a button rather than described.
 *
 * ⚠ **`insufficient_gateway_balance` is the opposite case and is easy to read
 * backwards.** It is a `409` and it looks like a failure, but **nothing was
 * sent** — the float was short, so the transfer never left. It is the one refusal
 * here that is safe to retry unchanged once the float is topped up.
 *
 * Every `details` member is read through a helper that tolerates its absence:
 * wi-admin forwards jovi-mall's `details` only when the platform's envelope
 * declares a client-safe category, so the figures below may simply not arrive.
 */
function SendFailureNotice({
    error,
    onRetry,
    onMarkPaidInstead,
    submitting,
}: {
    error: unknown;
    onRetry: () => void;
    onMarkPaidInstead?: () => void;
    submitting: boolean;
}) {
    const unsupported = gatewayUnsupportedKind(error);
    const shortfall = gatewayShortfallOf(error);

    if (isPayoutTransferInFlight(error)) {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-1 rounded-md border p-3 text-sm">
                <p className="font-medium">A transfer is already in progress.</p>
                <p>
                    This payout is being sent right now and cannot be sent again — reload to see
                    where it got to. It also cannot be rejected until the provider confirms.
                </p>
            </div>
        );
    }

    if (unsupported === 'destination') {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">This destination can&rsquo;t be paid automatically.</p>
                <p>
                    The gateway only reaches mobile-money accounts. Move the money yourself and
                    record it with <strong>Mark paid</strong>.
                </p>
                {onMarkPaidInstead ? (
                    <Button variant="outline" size="sm" onClick={onMarkPaidInstead}>
                        Mark paid instead
                    </Button>
                ) : null}
            </div>
        );
    }

    if (unsupported === 'deployment') {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">Automatic payouts are off on this deployment.</p>
                <p>
                    Nothing is wrong with this request. Settle it by hand and record it with{' '}
                    <strong>Mark paid</strong>, which never needed the gateway.
                </p>
                {onMarkPaidInstead ? (
                    <Button variant="outline" size="sm" onClick={onMarkPaidInstead}>
                        Mark paid instead
                    </Button>
                ) : null}
            </div>
        );
    }

    if (shortfall) {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">The payout float is short.</p>
                <p>
                    <strong>Nothing was sent</strong> and nothing changed — the platform&rsquo;s
                    balance with the provider could not cover this transfer.
                    {shortfall.available !== null && shortfall.required !== null ? (
                        <>
                            {' '}
                            It holds {formatMoney(shortfall.available, null)} of the{' '}
                            {formatMoney(shortfall.required, null)} needed.
                        </>
                    ) : null}{' '}
                    Retry once it has been topped up.
                </p>
                <Button variant="outline" size="sm" onClick={onRetry} disabled={submitting}>
                    {submitting ? <InlineLoader label="Retrying…" /> : 'Retry'}
                </Button>
            </div>
        );
    }

    /*
      Anything else — a plain `EARNINGS_PAYOUT_NOT_SENDABLE`, or a code this build
      has not heard of — through the shared renderer, which resolves
      `details.platformCode` against the copy catalogue and falls back to the
      server's own sentence.
    */
    return <AuthFormError error={error} />;
}

// ─── Endorse (the tier-3 pre-screen) ──────────────────────────────────────────

const NOTE_MAX = 500;

/**
 * `POST /money/payouts/:payoutId/triage` · `money.payouts.triage`.
 *
 * ── ⛔ What this must never become ────────────────────────────────────────────
 * A gate. Endorsement is **advisory**: a payout nobody has endorsed is exactly as
 * payable as one that has been (ADR-024 D-2), and the pre-screen exists to save
 * the approving administrator work rather than to gate them — an empty Support
 * queue must never stall payments. Nothing on this dashboard may disable Send or
 * Mark-paid on a missing `triage`.
 *
 * ── And what it is not ───────────────────────────────────────────────────────
 * Half of a decision. There is no "recommend rejection" here and there must not
 * be one: a reviewer who rejects presses the ordinary **Reject** control, which
 * they can reach because `/reject` takes
 * `anyPermission('money.payouts.reject', 'money.payouts.triage')`. Their
 * rejection is final, closes the request and returns the money — one outcome, one
 * code path (D-1).
 *
 * The note is optional and bounded 1–500 trimmed; an empty one is omitted rather
 * than sent, because `note` is `.min(1)` when present.
 */
export function TriagePayoutDialog({
    payout,
    open,
    onOpenChange,
    onEndorsed,
}: {
    payout: Payout;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onEndorsed: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Endorse this payout request</DialogTitle>
                    <DialogDescription>
                        Records that you have checked this request and believe it is genuine.{' '}
                        <strong>It moves no money and changes no status</strong> — an administrator
                        still releases the funds, and they can do that whether or not anybody has
                        endorsed it.
                    </DialogDescription>
                </DialogHeader>
                <TriagePayoutForm
                    payout={payout}
                    onEndorsed={onEndorsed}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function TriagePayoutForm({
    payout,
    onEndorsed,
    onCancel,
}: {
    payout: Payout;
    onEndorsed: () => void;
    onCancel: () => void;
}) {
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    const [alreadyTriaged, setAlreadyTriaged] = useState<string | null | false>(false);
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);
    const [alreadyResolved, setAlreadyResolved] = useState(false);

    const tooLong = note.trim().length > NOTE_MAX;

    async function submit() {
        setFailure(null);
        setAlreadyTriaged(false);
        setAlreadyResolved(false);
        setSubmitting(true);

        try {
            await triagePayout(payout.id, note);
            notify.success('Payout request endorsed');
            onEndorsed();
        } catch (error) {
            if (isPayoutAlreadyTriaged(error)) {
                // Inline: the operator is mid-action, and the useful fact is who
                // got there first rather than that it failed.
                setAlreadyTriaged(endorsedByOf(error));
                return;
            }
            if (isPayoutNotPending(error)) {
                setResolvedStatus(resolvedPayoutStatusOf(error));
                setAlreadyResolved(true);
                return;
            }
            setFailure(error);
        } finally {
            setSubmitting(false);
        }
    }

    if (alreadyResolved) {
        return <AlreadyResolvedNotice status={resolvedStatus} onReload={onEndorsed} />;
    }

    if (alreadyTriaged !== false) {
        return (
            <div className="space-y-3">
                <div className="space-y-2 rounded-md border p-3 text-sm">
                    <p className="font-medium">
                        {alreadyTriaged
                            ? `${alreadyTriaged} already reviewed this request.`
                            : 'Somebody has already reviewed this request.'}
                    </p>
                    <p className="text-muted-foreground">
                        A request carries one endorsement. Nothing you did was lost — reload to see
                        theirs.
                    </p>
                </div>
                <DialogFooter>
                    <Button type="button" onClick={onEndorsed}>
                        Reload
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <AuthFormError error={failure} />

            <div className="space-y-2">
                <label htmlFor="triage-note" className="text-sm font-medium">
                    Note (optional)
                </label>
                <Textarea
                    id="triage-note"
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Checked against KYC documents"
                />
                <p className="text-muted-foreground text-xs">
                    {tooLong
                        ? `Use at most ${NOTE_MAX} characters.`
                        : 'Whoever releases the funds will read this.'}
                </p>
            </div>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                    Cancel
                </Button>
                <Button type="button" onClick={submit} disabled={submitting || tooLong}>
                    {submitting ? <InlineLoader label="Endorsing…" /> : 'Endorse'}
                </Button>
            </DialogFooter>
        </div>
    );
}
