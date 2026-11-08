import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
    blockListingCustomer,
    isListingRecordGone,
    isListingStateMoved,
    isUnreachable,
    liftListingCustomerBlock,
    refundReveal,
} from '@/services/listings.service';
import {
    LISTING_NOTE_MAX,
    LISTING_NOTE_MIN,
    formatCredits,
    listingContactFieldLabel,
    type LeadReveal,
} from '@/types/listings.types';

/**
 * Refund an unlock · Block a customer on a listing · Lift that block.
 *
 * Each is offered by the caller only with its permission: the refund on
 * `catalog.listings.reveals.refund` (tiers 1–2 — ⛔ never shown to Support, not
 * even disabled), the block and lift on `catalog.listings.reveal-block`.
 *
 * ⚠ **None of them closes the ticket**, and each says so when it is opened from
 * one: the ticket is closed as usual, once the operator is done.
 *
 * Refusals: an unlock already refunded, a block already in place, or nothing to
 * lift all mean someone else acted first — the dialog closes and the caller
 * re-reads. `502`/`503` changed nothing.
 */

export type LeadActionRequest =
    | { kind: 'refund'; reveal: LeadReveal }
    | { kind: 'block' }
    | { kind: 'lift' };

const required = z
    .string()
    .trim()
    .min(LISTING_NOTE_MIN, `Write at least ${LISTING_NOTE_MIN} characters`)
    .max(LISTING_NOTE_MAX, `At most ${LISTING_NOTE_MAX} characters`);
const optional = z
    .string()
    .trim()
    .refine((value) => value.length === 0 || value.length >= LISTING_NOTE_MIN, `Leave it blank, or write at least ${LISTING_NOTE_MIN} characters`)
    .refine((value) => value.length <= LISTING_NOTE_MAX, `At most ${LISTING_NOTE_MAX} characters`);

const schemas = {
    refund: z.object({ text: required }),
    block: z.object({ text: required }),
    lift: z.object({ text: optional }),
} as const;

export function LeadActionDialog({
    request,
    listingId,
    customerId,
    customerName,
    ticketId,
    onClose,
    onDone,
}: {
    request: LeadActionRequest | null;
    listingId: string;
    customerId: string;
    customerName: string;
    /** When opened from a report ticket: recorded on the refund or block. */
    ticketId?: string;
    onClose: () => void;
    /** Landed, or refused because someone acted first — either way, re-read. */
    onDone: () => void;
}) {
    if (!request) return null;
    return (
        <ActionDialog
            key={request.kind === 'refund' ? `refund-${request.reveal.id}` : request.kind}
            request={request}
            listingId={listingId}
            customerId={customerId}
            customerName={customerName}
            ticketId={ticketId}
            onClose={onClose}
            onDone={onDone}
        />
    );
}

function ActionDialog({
    request,
    listingId,
    customerId,
    customerName,
    ticketId,
    onClose,
    onDone,
}: {
    request: LeadActionRequest;
    listingId: string;
    customerId: string;
    customerName: string;
    ticketId?: string;
    onClose: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<{ text: string }>({
        resolver: zodResolver(schemas[request.kind]),
        defaultValues: { text: '' },
    });

    const fromTicket = ticketId ? ' This does not close the ticket — close it as usual when you are done.' : '';

    async function onSubmit({ text }: { text: string }) {
        setFormError(null);
        try {
            if (request.kind === 'refund') {
                const result = await refundReveal(request.reveal.id, { note: text, ticketId });
                notify.success(
                    `Refunded ${formatCredits(result.refundedCredits ?? request.reveal.cost)} to the provider`,
                    {
                        description:
                            result.balanceAfter !== null
                                ? `Their balance is now ${formatCredits(result.balanceAfter)}.`
                                : undefined,
                    },
                );
            } else if (request.kind === 'block') {
                await blockListingCustomer(listingId, customerId, { reason: text, ticketId });
                notify.success('Customer blocked on this listing', {
                    description: 'They can no longer unlock its contacts.',
                });
            } else {
                await liftListingCustomerBlock(listingId, customerId, text);
                notify.success('Block lifted', { description: 'They can unlock this listing’s contacts again.' });
            }
            onClose();
            onDone();
        } catch (error) {
            if (isListingStateMoved(error) || isListingRecordGone(error)) {
                notify.warning('Someone else already did this', {
                    description: 'It has been reloaded so you can see where it is now.',
                });
                onClose();
                onDone();
                return;
            }
            setFormError(error);
        }
    }

    const copy =
        request.kind === 'refund'
            ? {
                  title: `Refund this ${listingContactFieldLabel(request.reveal.field)} unlock?`,
                  description: `${formatCredits(request.reveal.cost)} go back to the provider’s wallet, paying off any debt first. ${customerName} keeps the contact. An unlock is refunded once.${fromTicket}`,
                  label: 'Why — kept on the unlock for the next administrator',
                  hint: `${LISTING_NOTE_MIN}–${LISTING_NOTE_MAX} characters.`,
                  placeholder: 'The customer was a test account; the provider reported it the same day.',
                  confirm: `Refund ${formatCredits(request.reveal.cost)}`,
                  destructive: false,
              }
            : request.kind === 'block'
              ? {
                    title: 'Block this customer on this listing?',
                    description: `${customerName} can no longer unlock this listing’s contacts. They are only told “this business can’t be reached right now”, never why, and other listings are not affected.${fromTicket}`,
                    label: 'Reason — for administrators, never shown to the customer',
                    hint: `Recorded on the block and in the audit trail. ${LISTING_NOTE_MIN}–${LISTING_NOTE_MAX} characters.`,
                    placeholder: 'Unlocks contacts from several numbers and never books.',
                    confirm: 'Block customer',
                    destructive: true,
                }
              : {
                    title: 'Lift this block?',
                    description: `${customerName} can unlock this listing’s contacts again.${fromTicket}`,
                    label: 'Note for other administrators — optional',
                    hint: `Recorded in the audit trail. ${LISTING_NOTE_MIN}–${LISTING_NOTE_MAX} characters, or leave it blank.`,
                    placeholder: 'Blocked by mistake',
                    confirm: 'Lift block',
                    destructive: false,
                };

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.description}</DialogDescription>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                        id={`lead-${request.kind}-text`}
                        label={copy.label}
                        hint={copy.hint}
                        error={form.formState.errors.text?.message}
                    >
                        {(control) => (
                            <Textarea
                                rows={3}
                                maxLength={LISTING_NOTE_MAX}
                                placeholder={copy.placeholder}
                                {...control}
                                {...form.register('text')}
                            />
                        )}
                    </FormField>

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
                            variant={copy.destructive ? 'destructive' : 'default'}
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
