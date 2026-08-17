import { Ban } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatInstantInZone } from '@/lib/format';
import type { VendorSuspension } from '@/types/vendors.types';

interface VendorSuspensionPanelProps {
    suspension: VendorSuspension;
    timeZone: string;
}

/**
 * Why the shop is not trading.
 *
 * ── Render this only after checking `status` ──────────────────────────────────
 * The service keys the whole `suspension` object on `status === 'inactive'` and
 * sends `null` otherwise, so this takes a non-null value and the caller does the
 * check — an active vendor carrying a stale reason would read as suspended on any
 * screen that renders the block without looking first.
 *
 * ── Why `fromStatus` is shown ─────────────────────────────────────────────────
 * It is what a restore puts back, and it is `active` **or**
 * `pending_verification` — never `inactive`. Showing it answers the question an
 * operator about to reinstate actually has: *what will this vendor be afterwards?*
 * A vendor who had never verified their email does not silently become verified by
 * being reinstated, and this is the only field that says so in advance.
 *
 * ── Why the actor's id is not a link ──────────────────────────────────────────
 * `by.source` says which identity space `by.id` belongs to. An `'admin'` id lives
 * in the **wi-admin database** and resolves to nothing in jovi-mall, so linking it
 * to a platform user would point at the wrong person or at nothing. `by.name` is a
 * write-time snapshot for exactly this reason — the only readable record there
 * will be.
 */
export function VendorSuspensionPanel({ suspension, timeZone }: VendorSuspensionPanelProps) {
    const at = formatInstantInZone(suspension.at, timeZone);
    const actor = suspension.by;

    return (
        <Alert variant="destructive">
            <Ban />
            <AlertTitle>This vendor is suspended</AlertTitle>
            <AlertDescription className="space-y-2">
                <p>
                    Their whole catalogue is off sale and their API access is blocked. The block
                    takes effect on their next request, not at their next sign-in.
                </p>

                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium">Reason</dt>
                    <dd>{suspension.reason ?? 'Not recorded'}</dd>

                    <dt className="font-medium">Suspended</dt>
                    <dd>{at ?? 'Not recorded'}</dd>

                    <dt className="font-medium">Was</dt>
                    <dd>
                        {suspension.fromStatus === 'pending_verification'
                            ? 'Pending verification — reinstating returns them to that, not to active'
                            : (suspension.fromStatus ?? 'Not recorded')}
                    </dd>

                    <dt className="font-medium">By</dt>
                    <dd>
                        {actor?.name ?? 'Not recorded'}
                        {actor?.source === 'admin' ? (
                            <span className="text-muted-foreground"> · administrator</span>
                        ) : actor?.source === 'platform' && actor.id ? (
                            <span className="text-muted-foreground"> · platform account</span>
                        ) : null}
                    </dd>
                </dl>

                <p className="text-xs">
                    Their sign-in account is untouched by this, and so is any other role they hold —
                    those have their own status on their own screens.
                </p>
            </AlertDescription>
        </Alert>
    );
}
