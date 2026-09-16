import { useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
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
import { notify } from '@/lib/notify';
import { triageDeposit, triageRemittance } from '@/services/cod.service';

const NOTE_MAX = 500;

/**
 * The COD pre-screen — `POST /cod/{remittances,deposits}/:id/triage`, `cod.triage`.
 *
 * ── ⛔ What this must never become ────────────────────────────────────────────
 * A step. Endorsement gates nothing (ADR-024 D-2, and D-5 for this half): an
 * un-endorsed remittance is exactly as confirmable, and an un-endorsed deposit
 * exactly as settleable. No confirm or reject control on the COD screens may
 * consult `triage`, and none does.
 *
 * ── And what it is not ───────────────────────────────────────────────────────
 * Half a decision. There is no "recommend rejection": a reviewer who wants this
 * refused presses the ordinary **Reject** control. One outcome, one code path.
 *
 * ── One dialog for both records ──────────────────────────────────────────────
 * The two endpoints take the same body, behind the same permission, and record
 * the same stamp — so this takes the record `kind` and picks the call, rather
 * than existing twice with the noun changed. The **caller** decides whether to
 * offer it at all, which is where the deposit's `platform`-recipient rule lives
 * (`isDepositEndorsableHere`); putting that check in here would hide a refusal
 * inside a component whose job is the form.
 */
export function CodTriageDialog({
    kind,
    recordId,
    open,
    onOpenChange,
    onEndorsed,
}: {
    kind: 'remittance' | 'deposit';
    recordId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onEndorsed: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Endorse this {kind}</DialogTitle>
                    <DialogDescription>
                        Records that you have checked this declaration and believe it is genuine.{' '}
                        <strong>It moves no money and changes no status</strong> — an administrator
                        still confirms the cash, and they can do that whether or not anybody has
                        endorsed it.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <CodTriageForm
                    kind={kind}
                    recordId={recordId}
                    onEndorsed={onEndorsed}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function CodTriageForm({
    kind,
    recordId,
    onEndorsed,
    onCancel,
}: {
    kind: 'remittance' | 'deposit';
    recordId: string;
    onEndorsed: () => void;
    onCancel: () => void;
}) {
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const tooLong = note.trim().length > NOTE_MAX;

    async function submit() {
        setFormError(null);
        setSubmitting(true);

        try {
            const perform = kind === 'remittance' ? triageRemittance : triageDeposit;
            const result = await perform(recordId, note);
            // The server composes its own sentence naming what is still required.
            notify.success(result.message ?? `${kind === 'remittance' ? 'Remittance' : 'Deposit'} endorsed`);
            onEndorsed();
        } catch (error) {
            /*
              Inline rather than a toast, including the `403
              COD_DEPOSIT_WRONG_RECIPIENT` race: the operator is mid-action, and
              that refusal carries an explanation worth reading rather than a
              fact worth glancing at. `AuthFormError` resolves
              `details.platformCode` against the copy catalogue, where that code
              already has its sentence.
            */
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            <AuthFormError error={formError} />

            <div className="space-y-2">
                <label htmlFor="cod-triage-note" className="text-sm font-medium">
                    Note (optional)
                </label>
                <Textarea
                    id="cod-triage-note"
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Counted against the agent's handover sheet"
                />
                <p className="text-muted-foreground text-xs">
                    {tooLong
                        ? `Use at most ${NOTE_MAX} characters.`
                        : 'Whoever confirms the cash will read this.'}
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
