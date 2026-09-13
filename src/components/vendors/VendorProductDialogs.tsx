import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
    PLATFORM_CODE_PRODUCT_NOT_OVERSIGHT_SUSPENDED,
    PLATFORM_CODE_PRODUCT_NOT_SUSPENDABLE,
    PLATFORM_CODE_PRODUCT_UNSUSPEND_BLOCKED,
    restoreVendorProduct,
    suspendVendorProduct,
} from '@/services/vendors.service';
import { ApiError } from '@/types/api.types';
import type { ActivationBlocker, VendorProduct } from '@/types/vendors.types';

const NOTE_MIN = 3;
const NOTE_MAX = 500;

/** The field really is called `note`, not `reason` — `SuspendVendorProductSchema`. */
const suspendSchema = z.object({
    note: z
        .string()
        .trim()
        .min(NOTE_MIN, 'A reason is required to take a product off sale')
        .max(NOTE_MAX, `Use at most ${NOTE_MAX} characters`),
});

interface ProductDialogProps {
    vendorId: string;
    product: VendorProduct;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

/**
 * `POST /vendors/:vendorId/products/:productId/suspend` · `vendors.products.manage`.
 *
 * Nested under the vendor because **the ownership is the authorisation** —
 * jovi-mall scopes the write by both ids, so naming this vendor cannot reach
 * another's listing.
 *
 * ── The one consequence worth stating on the dialog ───────────────────────────
 * The takedown is recorded as `platform_oversight`, which is **disjoint from every
 * automatic sweep**: reinstating the vendor will not put this listing back, and
 * neither will an agency problem being resolved. A human took it down, so a human
 * puts it back ([ADR-008 D-3](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)).
 *
 * The audit row targets the **vendor**, with the product in its payload, so this
 * appears in the vendor's activity feed — which is where somebody asking *this
 * vendor's listings went dark, why* will actually look.
 */
export function SuspendProductDialog({
    vendorId,
    product,
    open,
    onOpenChange,
    onDone,
}: ProductDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Take “{product.title ?? product.id}” off sale?</DialogTitle>
                    <DialogDescription>
                        It disappears from the storefront immediately. The vendor keeps the listing,
                        and sees both that it was taken down and the reason you give.
                    </DialogDescription>
                </DialogHeader>

                <SuspendProductForm
                    vendorId={vendorId}
                    product={product}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function SuspendProductForm({
    vendorId,
    product,
    onCancel,
    onDone,
}: {
    vendorId: string;
    product: VendorProduct;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof suspendSchema>>({
        resolver: zodResolver(suspendSchema),
        defaultValues: { note: '' },
    });

    async function onSubmit(values: z.infer<typeof suspendSchema>) {
        setFormError(null);
        try {
            await suspendVendorProduct(vendorId, product.id, { note: values.note });
            notify.success('Product taken off sale');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                /**
                 * A **422**, not the `409` the docs describe. It deliberately does
                 * not distinguish "not on sale" from "not this vendor's product" —
                 * telling them apart would confirm the existence of another
                 * vendor's id — so the copy covers both without guessing.
                 */
                if (error.platformCode === PLATFORM_CODE_PRODUCT_NOT_SUSPENDABLE) {
                    notify.warning('This listing cannot be taken off sale', {
                        description: 'It is no longer on sale. Reloading the catalogue.',
                    });
                    onDone();
                    return;
                }

                const fieldErrors = pickFieldErrors(error, ['note'] as const);
                if (fieldErrors.note) {
                    setError('note', { message: fieldErrors.note });
                    return;
                }

                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField
                id="suspend-product-note"
                label="Reason"
                error={errors.note?.message}
                hint={
                    <>
                        Stored on the listing and <strong>shown to the vendor</strong>, as well as
                        recorded in their activity trail. Write what they need to change.
                    </>
                }
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={NOTE_MAX}
                        placeholder="What is wrong with this listing"
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                Nothing automatic ever puts this back. Reinstating the vendor will not, and neither
                will their delivery agency being restored — a listing taken down here has to be put
                back here.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Taking down…" /> : 'Take off sale'}
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * `POST /vendors/:vendorId/products/:productId/restore` · `vendors.products.manage`.
 *
 * ── It lifts exactly one reason ───────────────────────────────────────────────
 * Only a `platform_oversight` takedown. An agency cascade or a vendor suspension
 * is refused with `422 VENDOR_PRODUCT_NOT_OVERSIGHT_SUSPENDED`, because those have
 * their own remedies. The catalogue only offers the action where
 * `canRestoreProduct` says so, so that code arriving means the state moved.
 *
 * ── The blockers are the interesting failure ──────────────────────────────────
 * The activation gate still runs, and `422 VENDOR_PRODUCT_UNSUSPEND_BLOCKED`
 * carries `details.blockers` — a list of `{ code, message }` that is the literal,
 * itemised answer to *why won't this go back on sale*. It is rendered as a list
 * inside the dialog rather than flattened into a toast: a toast would show one
 * line of what is often three, and it disappears before it can be acted on.
 */
export function RestoreProductDialog({
    vendorId,
    product,
    open,
    onOpenChange,
    onDone,
}: ProductDialogProps) {
    const [formError, setFormError] = useState<unknown>(null);
    const [blockers, setBlockers] = useState<ActivationBlocker[]>([]);
    const [isSubmitting, setSubmitting] = useState(false);

    async function onConfirm() {
        setFormError(null);
        setBlockers([]);
        setSubmitting(true);
        try {
            await restoreVendorProduct(vendorId, product.id);
            notify.success('Product put back on sale');
            onOpenChange(false);
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_PRODUCT_UNSUSPEND_BLOCKED) {
                    setBlockers(readBlockers(error));
                    return;
                }

                if (error.platformCode === PLATFORM_CODE_PRODUCT_NOT_OVERSIGHT_SUSPENDED) {
                    notify.warning('This listing was not taken down by an administrator', {
                        description:
                            'Something else took it off sale, so this action cannot lift it. Reloading the catalogue.',
                    });
                    onOpenChange(false);
                    onDone();
                    return;
                }

                setFormError(error);
                return;
            }

            notify.apiError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Put “{product.title ?? product.id}” back on sale?</DialogTitle>
                    <DialogDescription>
                        The platform re-checks the listing before it returns to the storefront.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <AuthFormError error={formError} />

                    {blockers.length > 0 ? <BlockerList blockers={blockers} /> : null}

                    {product.suspension?.note ? (
                        <div className="bg-muted/40 space-y-1 rounded-lg border p-3 text-sm">
                            <p className="text-muted-foreground text-xs">Taken down because</p>
                            <p>{product.suspension.note}</p>
                        </div>
                    ) : null}

                    <p className="text-muted-foreground text-xs leading-relaxed">
                        It returns to{' '}
                        {product.suspension?.previousStatus ?? 'the status it had before'}, provided
                        it still passes the platform&apos;s checks. If it does not, nothing changes
                        and you will be told why.
                    </p>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        {blockers.length > 0 ? 'Close' : 'Cancel'}
                    </Button>
                    <Button type="button" onClick={onConfirm} disabled={isSubmitting}>
                        {isSubmitting ? (
                            <InlineLoader label="Restoring…" />
                        ) : blockers.length > 0 ? (
                            'Try again'
                        ) : (
                            'Put back on sale'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Why the listing will not go back on sale, itemised.
 *
 * One blocker code is worth recognising by name: `CATALOG_PRODUCT_VENDOR_SUSPENDED`
 * is the guard that stops an agency problem being resolved *while the vendor is
 * suspended* from walking their listings back onto the storefront
 * ([ADR-008 D-4](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)). Its remedy is on
 * a different screen — reinstate the vendor first — which is worth saying, because
 * an operator staring at a product dialog will not otherwise think to look there.
 *
 * Every other code renders with the server's own message. The list is open-ended
 * and nothing switches on it.
 */
export function BlockerList({ blockers }: { blockers: ActivationBlocker[] }) {
    const vendorSuspended = blockers.some(
        (blocker) => blocker.code === 'CATALOG_PRODUCT_VENDOR_SUSPENDED',
    );

    return (
        <Alert variant="destructive">
            <AlertTitle>This listing cannot go back on sale yet</AlertTitle>
            <AlertDescription className="space-y-2">
                <ul className="list-inside list-disc space-y-1 text-sm">
                    {blockers.map((blocker, index) => (
                        <li key={`${blocker.code}-${index}`}>
                            {blocker.message}
                            {/*
                              ⚠ Mono and left alone: a blocker code is a *reason*
                              in the middle of a sentence, not a value — it names
                              which rule refused, the way a status does, and
                              nothing is looked up by it. A copy button inside each
                              bullet would also break the one thing this list has
                              to do, which is read as prose.
                            */}
                            <span className="text-muted-foreground font-mono text-xs">
                                {' '}
                                ({blocker.code})
                            </span>
                        </li>
                    ))}
                </ul>
                {vendorSuspended ? (
                    <p className="text-xs">
                        The vendor themselves is suspended, so none of their listings can be on
                        sale. Reinstate the vendor first — this listing is not the thing to fix.
                    </p>
                ) : null}
            </AlertDescription>
        </Alert>
    );
}

/**
 * `details.blockers`, if it is shaped as documented.
 *
 * Read defensively rather than cast: `details` survives the server's exposure
 * scrub only when the forwarded category is client-safe, so a blocker list can
 * legitimately arrive absent even on the code that promises it. An empty result
 * falls back to the generic error panel rather than rendering an empty list under
 * a heading that says there are reasons.
 */
function readBlockers(error: ApiError): ActivationBlocker[] {
    const raw = error.details?.blockers;
    if (!Array.isArray(raw)) return [];

    return raw.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const { code, message } = entry as Record<string, unknown>;
        if (typeof code !== 'string') return [];
        return [{ code, message: typeof message === 'string' ? message : code }];
    });
}
