import { useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { OperationBadge } from '@/components/system/OperationBadge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { resolveErrorMessage } from '@/lib/errors';
import type { DangerLevel } from '@/types/system.types';

/** The reason box is a real control, so it gets a real floor rather than "not empty". */
const REASON_MIN = 10;

export interface PreflightState {
    /** Rendered above the reason box once a pre-flight has returned. */
    summary: ReactNode;
    /** Bumped by the caller whenever the payload changes, which re-arms the gate. */
    payloadKey: string;
}

interface DestructiveActionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** What it does, in the operator's terms. */
    description: ReactNode;
    level: DangerLevel;
    irreversible?: boolean;
    /** The blast radius, from the server where the server states one. */
    blastRadius?: ReactNode;
    /** The form controls that decide the payload. */
    children?: ReactNode;

    /**
     * The pre-flight step.
     *
     * `run` performs the dry run (or the read that stands in for one). `state` is what it
     * returned. `unavailable` says there is genuinely nothing to check first, and the dialog
     * says so rather than pretending — `catalogue/vectorise` is the one such tool.
     */
    preflight?: {
        label: string;
        run: () => Promise<void>;
        state: PreflightState | null;
        unavailable?: string;
    };
    /** Changing any field must re-arm the gate; the caller supplies the identity of the payload. */
    payloadKey: string;

    /** Where the contract requires a typed confirmation, what it must equal and why. */
    confirmation?: { expected: string; label: string; hint: string };

    /**
     * Whether the endpoint records the reason.
     *
     * Only the feature-flag and maintenance writes take one on the wire. For the five bodyless
     * tools the note is **display-only**, and the dialog says so rather than implying the trail
     * will carry it.
     */
    reasonIsRecorded?: boolean;

    confirmLabel: string;
    onConfirm: (reason: string) => Promise<void>;
    isBusy?: boolean;
    error?: unknown;
    /** Rendered in place of the form once the action has answered. */
    result?: ReactNode;
}

/**
 * The confirmation flow every destructive tool goes through.
 *
 * Four steps, and only the last two are the contract's:
 *
 * 1. **Describe** — what it does, its level, its blast radius, whether it can be undone.
 * 2. **Pre-flight** — the live control stays disabled until a dry run for *this exact payload*
 *    has returned, and editing any field re-arms it. Where the endpoint has no `dryRun`, the
 *    caller supplies the honest equivalent — the eligible-row count for a replay, the worker's
 *    three state booleans for a trigger — or declares that none exists.
 * 3. **Reason** — required on every run.
 * 4. **Typed confirmation** — where the contract asks for one: `confirm` repeats `olderThanDays`
 *    for a prune (the age decides the blast radius) and `db` for a flush (the database does).
 *
 * ⚠ **Steps 2 and 3 are this dashboard's, not the service's.** The service enforces the typed
 * confirmation and defaults `dryRun` to true; it does not require that a dry run was actually
 * looked at, and **five of the seven writes accept no `reason` at all**. Where a reason cannot be
 * sent, `reasonIsRecorded={false}` makes the dialog say so in as many words — a confirmation step
 * that quietly records nothing is one that teaches operators confirmation steps record nothing.
 * Putting an optional `reason` on those five bodies is a recorded backend ask.
 */
export function DestructiveActionDialog({
    open,
    onOpenChange,
    title,
    description,
    level,
    irreversible,
    blastRadius,
    children,
    preflight,
    payloadKey,
    confirmation,
    reasonIsRecorded = false,
    confirmLabel,
    onConfirm,
    isBusy,
    error,
    result,
}: DestructiveActionDialogProps) {
    const [reason, setReason] = useState('');
    const [typed, setTyped] = useState('');
    const [preflightBusy, setPreflightBusy] = useState(false);

    /**
     * Clear the reason and the typed confirmation whenever the dialog opens or closes.
     *
     * **Adjusted during render**, which React documents as the way to reset state when a prop
     * changes, and which this repo requires — `setState` inside an effect body is a lint error
     * here, and `SearchInput` carries the same note. It re-renders before anything paints, so
     * there is no flash of the previous run's text.
     *
     * Re-arming matters: a dialog that remembered the last run's ceremony would let a second,
     * differently-shaped run through on the first one's evidence.
     */
    const [seenOpen, setSeenOpen] = useState(open);
    if (seenOpen !== open) {
        setSeenOpen(open);
        setReason('');
        setTyped('');
    }

    /**
     * The pre-flight is spent when the payload moves. This is the whole of the gate: without the
     * key comparison an operator could dry-run `olderThanDays: 30`, change it to `7`, and run the
     * live delete against evidence gathered for a different cutoff.
     */
    const preflightFresh =
        !preflight || Boolean(preflight.unavailable) || preflight.state?.payloadKey === payloadKey;

    const reasonOk = reason.trim().length >= REASON_MIN;
    const confirmationOk = !confirmation || typed.trim() === confirmation.expected;
    const canConfirm = preflightFresh && reasonOk && confirmationOk && !isBusy;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription asChild>
                        <div className="space-y-2">
                            <OperationBadge level={level} irreversible={irreversible} />
                            <div>{description}</div>
                        </div>
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <div className="space-y-3">{result}</div>
                ) : (
                    <div className="space-y-4">
                        {blastRadius ? (
                            <div className="border-destructive/40 bg-destructive/10 flex gap-2.5 rounded-md border p-3 text-sm">
                                <AlertTriangle
                                    className="text-destructive mt-0.5 size-4 shrink-0"
                                    aria-hidden
                                />
                                <div>{blastRadius}</div>
                            </div>
                        ) : null}

                        {children}

                        {preflight ? (
                            <div className="space-y-2 rounded-md border p-3">
                                {preflight.unavailable ? (
                                    <p className="text-muted-foreground text-sm">
                                        {preflight.unavailable}
                                    </p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-sm font-medium">
                                                Check first, then run
                                            </p>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={preflightBusy || isBusy}
                                                onClick={() => {
                                                    setPreflightBusy(true);
                                                    void preflight
                                                        .run()
                                                        .finally(() => setPreflightBusy(false));
                                                }}
                                            >
                                                {preflightBusy ? (
                                                    <Loader2 className="size-4 animate-spin" />
                                                ) : null}
                                                {preflight.label}
                                            </Button>
                                        </div>

                                        {preflightFresh && preflight.state ? (
                                            <div className="text-sm">{preflight.state.summary}</div>
                                        ) : (
                                            <p className="text-muted-foreground text-xs">
                                                {preflight.state
                                                    ? 'The settings changed since the last check. Run it again before going ahead.'
                                                    : 'Nothing has been checked yet. This reports what would happen and changes nothing.'}
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : null}

                        <div className="space-y-1.5">
                            <Label htmlFor="destructive-reason">
                                Why are you doing this?{' '}
                                <span className="text-muted-foreground font-normal">
                                    (at least {REASON_MIN} characters)
                                </span>
                            </Label>
                            <Textarea
                                id="destructive-reason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                rows={2}
                                maxLength={500}
                                placeholder="Replaying the events geo-tracker missed during the 13/08 outage"
                            />
                            <p className="text-muted-foreground text-xs">
                                {reasonIsRecorded
                                    ? 'Recorded in the audit row, and shown to anyone the change affects.'
                                    : 'This note is not recorded — the endpoint accepts no reason. The audit row captures your identity, the parameters and the result.'}
                            </p>
                        </div>

                        {confirmation ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="destructive-confirm">{confirmation.label}</Label>
                                <Input
                                    id="destructive-confirm"
                                    value={typed}
                                    onChange={(event) => setTyped(event.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="font-mono"
                                />
                                <p className="text-muted-foreground text-xs">{confirmation.hint}</p>
                            </div>
                        ) : null}

                        {error ? (
                            <p className="text-destructive text-sm">{resolveErrorMessage(error)}</p>
                        ) : null}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
                        {result ? 'Close' : 'Cancel'}
                    </Button>
                    {result ? null : (
                        <Button
                            variant="destructive"
                            disabled={!canConfirm}
                            onClick={() => void onConfirm(reason.trim())}
                        >
                            {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                            {confirmLabel}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
