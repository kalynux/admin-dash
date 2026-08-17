import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
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
import {
    approveApproval,
    rejectApproval,
    withdrawApproval,
} from '@/services/approvals.service';
import { ApiError } from '@/types/api.types';
import { APPROVAL_STALE_CODES, type Approval } from '@/types/approvals.types';

/**
 * The three decisions, and the one thing they all have to be honest about.
 *
 * ── Approving *performs* the action ───────────────────────────────────────────
 * A `200` here means the promotion happened and the payout was marked paid — not
 * that either was scheduled. So the confirmation says so in plain words rather
 * than describing a signature.
 *
 * ── A signature with no reason ────────────────────────────────────────────────
 * `note` is optional to the schema and close to mandatory in practice: it is
 * *"the field a later audit review actually reads"*. Both dialogs prompt for it
 * and neither requires it, which is the contract's own balance.
 *
 * ── The precondition is re-checked at commit ──────────────────────────────────
 * An approval may sit for 24 hours, so the queued action is evaluated **again**
 * when it is approved. A `200` can therefore come back carrying a
 * `failureReason` — approval is not a promise the action succeeded — and the
 * caller is told about it rather than shown a success toast over a refusal.
 */

const NOTE_MAX = 500;

const noteSchema = z.object({
    note: z.string().trim().max(NOTE_MAX, `Use at most ${NOTE_MAX} characters`),
});

type NoteValues = z.infer<typeof noteSchema>;

interface DecisionDialogProps {
    approval: Approval;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The decision landed. The caller refetches. */
    onDecided: (approval: Approval) => void;
    /** The row moved underneath us — already resolved, or expired. */
    onStale: () => void;
}

/**
 * The banner for a row that was decided or expired while the dialog was open.
 *
 * Not an error: somebody else did the right thing first, or the clock ran out.
 * The remedy is to look at what the row says now, which is a reload rather than
 * a retry.
 */
function StaleNotice({ error, onReload }: { error: ApiError; onReload: () => void }) {
    const expired = error.code === 'AUTHZ_APPROVAL_EXPIRED';

    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {expired ? 'This request has expired' : 'This request has already been decided'}
            </p>
            <p className="text-muted-foreground text-xs">
                {expired
                    ? 'Requests last 24 hours. The original action can be submitted again if it is still wanted.'
                    : 'Another administrator resolved it while this was open. Reload to see who, and when.'}
            </p>
            <Button variant="outline" size="sm" onClick={onReload}>
                Reload
            </Button>
        </div>
    );
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export function ApproveApprovalDialog(props: DecisionDialogProps) {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Approve and perform this action?</DialogTitle>
                    <DialogDescription>
                        This is not a signature on something that happens later. Approving performs
                        the action now.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts on close, so each open starts with an empty note. */}
                <DecisionForm {...props} kind="approve" />
            </DialogContent>
        </Dialog>
    );
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export function RejectApprovalDialog(props: DecisionDialogProps) {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject this request?</DialogTitle>
                    <DialogDescription>
                        Nothing is performed. The requester can submit it again if they disagree.
                    </DialogDescription>
                </DialogHeader>
                <DecisionForm {...props} kind="reject" />
            </DialogContent>
        </Dialog>
    );
}

function DecisionForm({
    approval,
    kind,
    onOpenChange,
    onDecided,
    onStale,
}: DecisionDialogProps & { kind: 'approve' | 'reject' }) {
    const [formError, setFormError] = useState<unknown>(null);
    const [stale, setStale] = useState<ApiError | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<NoteValues>({
        resolver: zodResolver(noteSchema),
        defaultValues: { note: '' },
    });

    async function onSubmit(values: NoteValues) {
        setFormError(null);
        try {
            // Send nothing rather than `''`: an empty note is not a note, and
            // the field is 1–500 when present.
            const body = values.note ? { note: values.note } : {};
            const decided =
                kind === 'approve'
                    ? await approveApproval(approval.id, body)
                    : await rejectApproval(approval.id, body);

            if (kind === 'reject') {
                notify.success('Request rejected');
            } else if (decided.failureReason) {
                /*
                 * Approved, and then refused on the re-check — a payout resolved
                 * while this sat in the queue, say. The signature landed; the
                 * action did not. A success toast here would be a lie.
                 */
                notify.warning('Approved, but the action was refused', {
                    description: decided.failureReason,
                });
            } else {
                notify.success('Approved and performed');
            }

            onOpenChange(false);
            onDecided(decided);
        } catch (error) {
            if (error instanceof ApiError) {
                if (APPROVAL_STALE_CODES.includes(error.code ?? '')) {
                    setStale(error);
                    return;
                }
                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    if (stale) {
        return (
            <StaleNotice
                error={stale}
                onReload={() => {
                    onOpenChange(false);
                    onStale();
                }}
            />
        );
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <p className="bg-muted/40 rounded-md border p-3 text-sm">{approval.description}</p>

            <FormField
                id="decision-note"
                label="Note"
                error={errors.note?.message}
                hint="Optional, but this is the field a later audit review actually reads. An approval with no note is a signature with no reason."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={NOTE_MAX}
                        placeholder={
                            kind === 'approve'
                                ? 'What you checked, and how — e.g. “Verified with Finance on a call, 13/08 10:02”'
                                : 'Why this is being refused'
                        }
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>

            {kind === 'approve' ? (
                <p className="text-muted-foreground text-xs">
                    The precondition is checked again now, so an action that is no longer valid is
                    refused rather than performed.
                </p>
            ) : null}

            <DialogFooter>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isSubmitting}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant={kind === 'reject' ? 'destructive' : 'default'}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <InlineLoader label={kind === 'approve' ? 'Approving…' : 'Rejecting…'} />
                    ) : kind === 'approve' ? (
                        'Approve and perform'
                    ) : (
                        'Reject request'
                    )}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Withdraw ─────────────────────────────────────────────────────────────────

/**
 * `DELETE /approvals/:approvalId` — the requester takes their own request back.
 *
 * Scoped to your own requests; withdrawing somebody else's is not possible.
 */
export function WithdrawApprovalDialog({
    approval,
    open,
    onOpenChange,
    onDecided,
    onStale,
}: DecisionDialogProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [stale, setStale] = useState<ApiError | null>(null);

    async function withdraw() {
        setIsSubmitting(true);
        try {
            const decided = await withdrawApproval(approval.id);
            notify.success('Request withdrawn');
            onOpenChange(false);
            onDecided(decided);
        } catch (error) {
            if (error instanceof ApiError && APPROVAL_STALE_CODES.includes(error.code ?? '')) {
                setStale(error);
                return;
            }
            notify.apiError(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Withdraw your request?</DialogTitle>
                    <DialogDescription>
                        Nothing was performed, so nothing is undone. You can submit the action again
                        later.
                    </DialogDescription>
                </DialogHeader>

                {stale ? (
                    <StaleNotice
                        error={stale}
                        onReload={() => {
                            onOpenChange(false);
                            onStale();
                        }}
                    />
                ) : (
                    <div className="space-y-4">
                        <p className="bg-muted/40 rounded-md border p-3 text-sm">
                            {approval.description}
                        </p>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                disabled={isSubmitting}
                            >
                                Keep it
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={isSubmitting}
                                onClick={() => void withdraw()}
                            >
                                {isSubmitting ? (
                                    <InlineLoader label="Withdrawing…" />
                                ) : (
                                    'Withdraw request'
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
