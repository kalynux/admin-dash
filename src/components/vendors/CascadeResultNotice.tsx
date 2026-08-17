import { PackageCheck, PackageX, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import type { PlatformVendor } from '@/types/vendors.types';

interface CascadeResultNoticeProps {
    result: PlatformVendor;
    onDismiss: () => void;
    /** Opens the catalogue filtered to what is still off sale. */
    onShowSuspendedListings: () => void;
}

/**
 * What a suspension or a reinstatement actually did to the catalogue.
 *
 * ── Why this is a panel and not just a toast ──────────────────────────────────
 * `suspendedProductCount` and `restoredProductCount` **appear on their own write's
 * response and nowhere else** — no later read reports them, and reinstating clears
 * the suspension record entirely. A toast that has scrolled away takes the only
 * statement of what happened with it, so the number stays on screen until it is
 * dismissed.
 *
 * ── The number this exists to explain ─────────────────────────────────────────
 * **A restore returns fewer listings than the suspension took, routinely.**
 * jovi-mall re-runs the activation gate on every listing rather than republishing
 * blindly, so anything that no longer passes stays down — and a listing an
 * administrator took down individually is *never* put back by a vendor restore.
 * Without saying that, "96 back on sale" after "128 taken down" reads as a partial
 * failure, and the operator goes looking for a bug that is not there.
 *
 * So the notice offers the one useful next step: show what is still off sale.
 */
export function CascadeResultNotice({
    result,
    onDismiss,
    onShowSuspendedListings,
}: CascadeResultNoticeProps) {
    const suspended = result.suspendedProductCount;
    const restored = result.restoredProductCount;

    // Neither key is present — a KYC verdict or a settings change, nothing to say.
    if (suspended === undefined && restored === undefined) return null;

    const isRestore = restored !== undefined;

    return (
        <Alert>
            {isRestore ? <PackageCheck /> : <PackageX />}
            <AlertTitle className="flex items-center justify-between gap-4">
                {isRestore
                    ? `${formatCount(restored)} listing${restored === 1 ? '' : 's'} back on sale`
                    : `${formatCount(suspended ?? 0)} listing${suspended === 1 ? '' : 's'} taken off sale`}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDismiss}
                    aria-label="Dismiss this summary"
                >
                    <X className="size-4" />
                </Button>
            </AlertTitle>
            <AlertDescription className="space-y-2">
                {isRestore ? (
                    <>
                        <p>
                            Every listing was re-checked before it returned. Anything that still
                            fails a check stayed off sale, and a listing an administrator took down
                            individually is never put back by this — that is expected, not a partial
                            failure.
                        </p>
                        <Button variant="outline" size="sm" onClick={onShowSuspendedListings}>
                            Show what is still off sale
                        </Button>
                    </>
                ) : (
                    <>
                        <p>
                            The whole catalogue went down in one transaction. Reinstating puts back
                            only what still passes the platform&apos;s checks, so expect fewer to
                            return.
                        </p>
                        <p className="text-xs">
                            This count is reported once, here. Nothing else on the platform records
                            it.
                        </p>
                    </>
                )}
            </AlertDescription>
        </Alert>
    );
}
