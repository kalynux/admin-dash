import { PackageCheck, PackageX, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import type { AgencyCascadeResult } from '@/types/agencies.types';

interface AgencyCascadeNoticeProps {
    result: AgencyCascadeResult;
    /** Which direction produced it — the counts alone cannot say. */
    direction: 'deactivate' | 'reactivate';
    onDismiss: () => void;
}

/**
 * What deactivating or reactivating an agency actually did to everyone else.
 *
 * ── Why this is a panel and not just a toast ──────────────────────────────────
 * The two counts arrive in the write's **`meta`** and **nowhere else** — no later
 * read reports them. A toast that has scrolled away takes the only statement of
 * what happened with it, and these are the numbers a vendor's support ticket will
 * be about. So it stays on screen until dismissed.
 *
 * ── The number this exists to explain ─────────────────────────────────────────
 * **A reactivation returns fewer products than the deactivation took, routinely.**
 * jovi-mall re-runs each listing's own activation gate rather than republishing
 * blindly, so anything that no longer passes stays suspended. Without saying that,
 * "197 restored" after "214 suspended" reads as a partial failure and the operator
 * goes looking for a bug that is not there.
 *
 * ── Why zero is worded carefully ──────────────────────────────────────────────
 * wi-admin coerces a missing count to `0`, and deactivating an already-inactive
 * agency is a silent no-op that also reports `0`. So a zero here can mean *nothing
 * needed moving*, *nothing was reported*, or *this had already been done*. The copy
 * says "no products were reported as moving" rather than asserting that none did —
 * the weaker claim is the only true one.
 */
export function AgencyCascadeNotice({
    result,
    direction,
    onDismiss,
}: AgencyCascadeNoticeProps) {
    const { products, orderItems } = result.counts;
    const isRestore = direction === 'reactivate';
    const nothingMoved = products === 0 && orderItems === 0;

    return (
        <Alert>
            {isRestore ? <PackageCheck /> : <PackageX />}
            <AlertTitle className="flex items-center justify-between gap-4">
                {nothingMoved
                    ? isRestore
                        ? 'Agency reactivated — nothing reported as restored'
                        : 'Agency deactivated — nothing reported as suspended'
                    : isRestore
                      ? `${formatCount(products)} product${products === 1 ? '' : 's'} restored`
                      : `${formatCount(products)} product${products === 1 ? '' : 's'} suspended`}
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
                {/*
                  wi-admin composes a sentence naming both numbers. Shown verbatim when
                  it is there rather than re-derived, so the dashboard and the audit
                  trail describe the write the same way.
                */}
                {result.message ? <p>{result.message}</p> : null}

                {!nothingMoved ? (
                    <p>
                        {formatCount(orderItems)} in-flight order item
                        {orderItems === 1 ? ' was' : 's were'}{' '}
                        {isRestore ? 'resumed' : 'put on hold'}.
                    </p>
                ) : null}

                {nothingMoved ? (
                    <p className="text-muted-foreground">
                        The write succeeded, but no products or order items were reported as
                        moving. That happens when there was genuinely nothing to move — and also
                        when the agency was already in this state, since repeating either action
                        is a no-op rather than an error. Reload the agency to see where it stands.
                    </p>
                ) : null}

                {isRestore && !nothingMoved ? (
                    <p className="text-muted-foreground">
                        Fewer products usually come back than went down, and that is expected
                        rather than a partial failure. Every listing is re-checked against its own
                        activation rules before it returns, and anything that still fails one stays
                        suspended.
                    </p>
                ) : null}

                {!isRestore && !nothingMoved ? (
                    <p className="text-muted-foreground">
                        Affected vendors are not told why. The reason recorded here is kept in the
                        audit trail only, so expect support tickets asking what happened.
                    </p>
                ) : null}
            </AlertDescription>
        </Alert>
    );
}
