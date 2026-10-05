import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { ReviewStars, ReviewText } from '@/components/reviews/ReviewBits';
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
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import {
    deleteReview,
    isReviewGone,
    isReviewStatusConflict,
    republishReview,
    unpublishReview,
} from '@/services/reviews.service';
import { ApiError } from '@/types/api.types';
import { REVIEW_REASON_MAX, REVIEW_REASON_MIN, type Review } from '@/types/reviews.types';

/** The verb a dialog performs. One at a time, so one controlled value. */
export type ReviewActionKind = 'unpublish' | 'republish' | 'delete';

export interface ReviewActionRequest {
    kind: ReviewActionKind;
    review: Review;
}

/** What the caller does with each outcome. The row is the caller's, never ours. */
export interface ReviewActionHandlers {
    /** Hide / Show again answered the updated review: replace the row. */
    onUpdated: (review: Review) => void;
    /** Delete answered `{ id, deleted: true }`: remove the row. */
    onDeleted: (reviewId: string) => void;
    /** Someone deleted it first (either 404): remove the row. */
    onGone: (reviewId: string) => void;
    /** Someone hid or showed it first (`REVIEW_STATUS_CONFLICT`): refresh the row. */
    onConflict: (reviewId: string) => void;
}

const REASON_LABEL = 'Note for other administrators (not shown to the author)';

const required = z
    .string()
    .trim()
    .min(REVIEW_REASON_MIN, `Write at least ${REVIEW_REASON_MIN} characters`)
    .max(REVIEW_REASON_MAX, `At most ${REVIEW_REASON_MAX} characters`);

const optional = z
    .string()
    .trim()
    .refine(
        (value) => value.length === 0 || value.length >= REVIEW_REASON_MIN,
        `Leave it blank, or write at least ${REVIEW_REASON_MIN} characters`,
    )
    .refine((value) => value.length <= REVIEW_REASON_MAX, `At most ${REVIEW_REASON_MAX} characters`);

const schemas = {
    unpublish: z.object({ reason: required }),
    republish: z.object({ reason: optional }),
    delete: z.object({ reason: required }),
} as const;

type Values = { reason: string };

const SERVER_FIELDS = ['reason'] as const;

/**
 * Hide · Show again · Delete — the three moderation writes, each behind a
 * confirmation.
 *
 * The caller decides whether the button exists (`availableActions` **and** the
 * permission); this dialog only performs the verb and reports what happened.
 *
 * ── The reason is a note between administrators ──────────────────────────────
 * Never shown to the author or the public, and labelled so — an operator who
 * believes the author reads it writes something different. Required for Hide
 * and Delete (3–500), optional for Show again, and a blank one is sent as no
 * key at all (`republishReview`).
 *
 * ── Delete says the two things Hide does not ─────────────────────────────────
 * It cannot be undone, and the author may then write a new review — whereas a
 * hidden review's author may not. So "Delete" is not "a stronger Hide", and
 * the dialog points at Hide for the case where the record should stay.
 *
 * ── Refusals ─────────────────────────────────────────────────────────────────
 * Both 404s (wi-admin's own, jovi-mall's `REVIEW_NOT_FOUND`) mean someone else
 * deleted it: the row goes. `REVIEW_STATUS_CONFLICT` means someone else hid or
 * showed it first: the row is re-read. A `400` lands on the reason field.
 * `502`/`503` changed nothing (the audit row is written fail-closed and the
 * platform made no change), so the copy says to try again.
 */
export function ReviewActionDialog({
    request,
    onClose,
    ...handlers
}: {
    request: ReviewActionRequest | null;
    onClose: () => void;
} & ReviewActionHandlers) {
    if (!request) return null;
    // Keyed so a second row's dialog starts with a clean form.
    return (
        <ActionDialog
            key={`${request.kind}-${request.review.id}`}
            request={request}
            onClose={onClose}
            {...handlers}
        />
    );
}

function ActionDialog({
    request,
    onClose,
    onUpdated,
    onDeleted,
    onGone,
    onConflict,
}: {
    request: ReviewActionRequest;
    onClose: () => void;
} & ReviewActionHandlers) {
    const { kind, review } = request;
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<Values>({
        resolver: zodResolver(schemas[kind]),
        defaultValues: { reason: '' },
    });

    const delivery = review.subjectType === 'delivery';

    async function onSubmit(values: Values) {
        setFormError(null);
        try {
            if (kind === 'delete') {
                await deleteReview(review.id, values.reason);
                notify.success('Review deleted', {
                    description: 'Its stars no longer count, and its author may write a new review.',
                });
                onClose();
                onDeleted(review.id);
                return;
            }
            const updated =
                kind === 'unpublish'
                    ? await unpublishReview(review.id, values.reason)
                    : await republishReview(review.id, values.reason);
            notify.success(kind === 'unpublish' ? 'Review hidden' : 'Review shown again', {
                description:
                    kind === 'unpublish'
                        ? 'Its stars stopped counting towards the rating straight away.'
                        : 'Its stars count towards the rating again.',
            });
            onClose();
            onUpdated(updated);
        } catch (error) {
            if (isReviewGone(error)) {
                notify.warning('This review was already deleted', {
                    description: 'Someone else deleted it before your change reached it.',
                });
                onClose();
                onGone(review.id);
                return;
            }
            if (isReviewStatusConflict(error)) {
                notify.warning('Someone else already changed this review', {
                    description: 'It has been refreshed so you can see where it is now.',
                });
                onClose();
                onConflict(review.id);
                return;
            }
            if (error instanceof ApiError) {
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    const unreachable =
        formError instanceof ApiError && (formError.status === 502 || formError.status === 503);

    const copy = COPY[kind](delivery);

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.description}</DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <figure className="bg-muted/40 space-y-1 rounded-lg border px-3 py-2 text-sm">
                        <ReviewStars rating={review.rating} />
                        <ReviewText review={review} clamp />
                    </figure>

                    <FormField
                        id={`review-${kind}-reason`}
                        label={kind === 'republish' ? `${REASON_LABEL} — optional` : REASON_LABEL}
                        error={form.formState.errors.reason?.message}
                        hint={
                            kind === 'republish'
                                ? `Recorded in the audit trail. ${REVIEW_REASON_MIN}–${REVIEW_REASON_MAX} characters, or leave it blank.`
                                : `Recorded in the audit trail. ${REVIEW_REASON_MIN}–${REVIEW_REASON_MAX} characters.`
                        }
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={REVIEW_REASON_MAX}
                                placeholder={copy.placeholder}
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {unreachable ? (
                        <div
                            role="alert"
                            className="border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">The platform could not be reached.</p>
                            <p className="text-muted-foreground">Nothing was changed. Try again.</p>
                        </div>
                    ) : formError ? (
                        <AuthFormError error={formError} />
                    ) : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant={kind === 'delete' ? 'destructive' : 'default'}
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

const COPY: Record<
    ReviewActionKind,
    (delivery: boolean) => { title: string; description: string; confirm: string; placeholder: string }
> = {
    unpublish: (delivery) => ({
        title: 'Hide this review?',
        description: delivery
            ? "Its stars stop counting towards the agent's and agency's rating straight away. You can show it again later. Its author sees it marked hidden, without your note, and cannot write another review of this delivery."
            : 'It comes off the product page and its stars stop counting towards the rating straight away. You can show it again later. Its author sees it marked hidden, without your note, and cannot write another review of this product.',
        confirm: 'Hide review',
        placeholder: 'Abusive language',
    }),
    republish: (delivery) => ({
        title: 'Show this review again?',
        description: delivery
            ? "Its stars count towards the agent's and agency's rating again. Delivery reviews are never shown on any page."
            : 'It goes back on the product page and its stars count towards the rating again.',
        confirm: 'Show again',
        placeholder: 'Hidden by mistake',
    }),
    delete: () => ({
        title: 'Delete this review permanently?',
        description:
            "It can't be restored, and its author will be able to write a new one. To hide it while keeping it on record, use Hide instead.",
        confirm: 'Delete permanently',
        placeholder: 'Spam',
    }),
};
