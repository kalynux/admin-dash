import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

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
    approveListing,
    isListingRecordGone,
    isListingStateMoved,
    isUnreachable,
    rejectListing,
    suspendListing,
    unsuspendListing,
} from '@/services/listings.service';
import {
    LISTING_NOTE_MAX,
    LISTING_NOTE_MIN,
    LISTING_REJECT_REASONS_MAX,
    type ListingAction,
    type ListingDetail,
} from '@/types/listings.types';

export interface ListingActionRequest {
    kind: ListingAction;
    listing: ListingDetail;
}

const note = z
    .string()
    .trim()
    .min(LISTING_NOTE_MIN, `Write at least ${LISTING_NOTE_MIN} characters`)
    .max(LISTING_NOTE_MAX, `At most ${LISTING_NOTE_MAX} characters`);

const optionalNote = z
    .string()
    .trim()
    .refine((value) => value.length === 0 || value.length >= LISTING_NOTE_MIN, `Leave it blank, or write at least ${LISTING_NOTE_MIN} characters`)
    .refine((value) => value.length <= LISTING_NOTE_MAX, `At most ${LISTING_NOTE_MAX} characters`);

const schemas = {
    approve: z.object({ note: z.string(), reasons: z.array(z.object({ text: z.string() })) }),
    reject: z.object({
        note: z.string(),
        reasons: z.array(z.object({ text: note })).min(1).max(LISTING_REJECT_REASONS_MAX),
    }),
    suspend: z.object({ note, reasons: z.array(z.object({ text: z.string() })) }),
    unsuspend: z.object({ note: optionalNote, reasons: z.array(z.object({ text: z.string() })) }),
} as const;

type Values = { note: string; reasons: { text: string }[] };

/**
 * Approve · Reject · Take offline · Put back — the four review writes.
 *
 * The caller decides whether each button exists (`availableActions` **and** the
 * permission); this dialog performs the verb and reports what happened. Every
 * write answers the listing read back fresh, so `onDone` replaces the screen
 * with it and nothing is re-read.
 *
 * ── Who reads what you write ──────────────────────────────────────────────────
 * Rejection reasons and the Take-offline note **reach the provider** (their
 * own listing shows both — read from jovi-mall's `vendor-listing.dto.ts`), and
 * the forms say so before you type. The Put-back note does not.
 *
 * ── Refusals ─────────────────────────────────────────────────────────────────
 * `LISTING_STATUS_CONFLICT` — someone else decided first, or the listing moved:
 * the dialog closes and the screen re-reads. A `404` either way means it is
 * gone. `502`/`503` changed nothing, because the audit is written fail-closed.
 */
export function ListingActionDialog({
    request,
    onClose,
    onDone,
    onMoved,
}: {
    request: ListingActionRequest | null;
    onClose: () => void;
    onDone: (listing: ListingDetail) => void;
    /** Refused because the listing moved or went: re-read it. */
    onMoved: () => void;
}) {
    if (!request) return null;
    return (
        <ActionDialog
            key={`${request.kind}-${request.listing.id}`}
            request={request}
            onClose={onClose}
            onDone={onDone}
            onMoved={onMoved}
        />
    );
}

function ActionDialog({
    request,
    onClose,
    onDone,
    onMoved,
}: {
    request: ListingActionRequest;
    onClose: () => void;
    onDone: (listing: ListingDetail) => void;
    onMoved: () => void;
}) {
    const { kind, listing } = request;
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<Values>({
        resolver: zodResolver(schemas[kind]),
        defaultValues: { note: '', reasons: [{ text: '' }] },
    });
    const reasons = useFieldArray({ control: form.control, name: 'reasons' });

    const copy = COPY[kind](listing);

    async function onSubmit(values: Values) {
        setFormError(null);
        try {
            const next =
                kind === 'approve'
                    ? await approveListing(listing.id)
                    : kind === 'reject'
                      ? await rejectListing(listing.id, values.reasons.map((reason) => reason.text))
                      : kind === 'suspend'
                        ? await suspendListing(listing.id, values.note)
                        : await unsuspendListing(listing.id, values.note);
            notify.success(copy.done, { description: copy.doneDescription(next) });
            onClose();
            onDone(next);
        } catch (error) {
            if (isListingStateMoved(error) || isListingRecordGone(error)) {
                notify.warning('This listing changed while you were looking at it', {
                    description: 'It has been reloaded so you can see where it is now — someone else may have decided first.',
                });
                onClose();
                onMoved();
                return;
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.description}</DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {kind === 'reject' ? (
                        <fieldset className="space-y-3">
                            <legend className="text-sm font-medium">
                                Reasons the provider will read ({reasons.fields.length} of {LISTING_REJECT_REASONS_MAX})
                            </legend>
                            {reasons.fields.map((field, index) => (
                                <div key={field.id} className="flex items-start gap-2">
                                    <FormField
                                        id={`listing-reject-reason-${index}`}
                                        label={`Reason ${index + 1}`}
                                        error={form.formState.errors.reasons?.[index]?.text?.message}
                                        className="flex-1"
                                    >
                                        {(control) => (
                                            <Textarea
                                                rows={2}
                                                maxLength={LISTING_NOTE_MAX}
                                                placeholder={index === 0 ? 'The description shows a phone number' : undefined}
                                                {...control}
                                                {...form.register(`reasons.${index}.text`)}
                                            />
                                        )}
                                    </FormField>
                                    {reasons.fields.length > 1 ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="mt-6 shrink-0"
                                            onClick={() => reasons.remove(index)}
                                            aria-label={`Remove reason ${index + 1}`}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    ) : null}
                                </div>
                            ))}
                            {reasons.fields.length < LISTING_REJECT_REASONS_MAX ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => reasons.append({ text: '' })}>
                                    <Plus className="size-4" />
                                    Add a reason
                                </Button>
                            ) : null}
                        </fieldset>
                    ) : null}

                    {kind === 'suspend' || kind === 'unsuspend' ? (
                        <FormField
                            id={`listing-${kind}-note`}
                            label={copy.noteLabel ?? 'Note'}
                            error={form.formState.errors.note?.message}
                            hint={copy.noteHint}
                        >
                            {(control) => (
                                <Textarea
                                    rows={3}
                                    maxLength={LISTING_NOTE_MAX}
                                    placeholder={copy.placeholder}
                                    {...control}
                                    {...form.register('note')}
                                />
                            )}
                        </FormField>
                    ) : null}

                    {formError && isUnreachable(formError) ? (
                        <div role="alert" className="border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border px-3 py-2 text-sm">
                            <p className="font-medium">The platform could not be reached.</p>
                            <p className="text-muted-foreground">Nothing was changed. Try again.</p>
                        </div>
                    ) : formError ? (
                        <AuthFormError error={formError} />
                    ) : null}

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant={kind === 'reject' || kind === 'suspend' ? 'destructive' : 'default'}
                            disabled={form.formState.isSubmitting}
                        >
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            {copy.confirm}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

interface Copy {
    title: string;
    description: string;
    confirm: string;
    done: string;
    doneDescription: (next: ListingDetail) => string | undefined;
    noteLabel?: string;
    noteHint?: string;
    placeholder?: string;
}

const COPY: Record<ListingAction, (listing: ListingDetail) => Copy> = {
    approve: (listing) => ({
        title: listing.isRevision ? 'Approve this change?' : 'Approve and publish this listing?',
        description: listing.isRevision
            ? 'The change replaces the live copy straight away. If the provider has fewer credits than one contact unlock costs, the listing goes live paused and comes back when they top up.'
            : 'Customers can find it straight away. If the provider has fewer credits than one contact unlock costs, it goes live paused and comes back when they top up.',
        confirm: listing.isRevision ? 'Approve change' : 'Approve and publish',
        done: listing.isRevision ? 'Change approved' : 'Listing approved',
        doneDescription: (next) =>
            next.status === 'suspended'
                ? 'It is paused until the provider tops up their credits.'
                : next.status === 'live'
                  ? 'It is live.'
                  : undefined,
    }),
    reject: (listing) => ({
        title: listing.isRevision ? 'Reject this change?' : 'Reject this listing?',
        description: [
            'The provider sees every reason you write — they are the only explanation they get, so say what to fix.',
            listing.isRevision ? 'The live copy stays up unchanged.' : null,
            listing.review?.indexFeeRef ? 'The indexing fee they paid to submit is refunded.' : null,
        ]
            .filter(Boolean)
            .join(' '),
        confirm: listing.isRevision ? 'Reject change' : 'Reject listing',
        done: listing.isRevision ? 'Change rejected' : 'Listing rejected',
        doneDescription: () => 'The provider has been told why.',
    }),
    suspend: () => ({
        title: 'Take this listing offline?',
        description:
            'Customers can no longer find it or unlock its contacts. It stays offline until an administrator puts it back.',
        confirm: 'Take offline',
        done: 'Listing taken offline',
        doneDescription: () => undefined,
        noteLabel: 'Note to the provider',
        noteHint: `The provider sees this on their listing, and it is recorded in the audit trail. ${LISTING_NOTE_MIN}–${LISTING_NOTE_MAX} characters.`,
        placeholder: 'The photos show a phone number. Remove it and we will put the listing back.',
    }),
    unsuspend: () => ({
        title: 'Put this listing back?',
        description: 'Customers can find it and unlock its contacts again.',
        confirm: 'Put back',
        done: 'Listing put back',
        doneDescription: () => undefined,
        noteLabel: 'Note for other administrators — optional',
        noteHint: `Recorded in the audit trail. ${LISTING_NOTE_MIN}–${LISTING_NOTE_MAX} characters, or leave it blank.`,
        placeholder: 'Photos fixed',
    }),
};
