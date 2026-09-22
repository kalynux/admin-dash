import { UserX } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatInstantInZone } from '@/lib/format';

interface ClosurePanelProps {
    closedAt: string | null;
    timeZone: string;
}

/**
 * Why an account is closed, and why its identifiers are missing.
 *
 * ── Render this only after checking `status` ──────────────────────────────────
 * `closedAt` follows the same pairing rule as `suspension` (`users.md:100`): it
 * is non-null only while `status === 'closed'`, and it fails the same way — an
 * active account rendering a stale instant reads as closed on any screen that
 * does not check `status` first. The caller does that check, exactly as it does
 * for `SuspensionPanel`.
 *
 * ── This is not a suspension with a different word ────────────────────────────
 * **The owner did it, not an administrator.** There is no reason, no actor and
 * no reinstatement, and that is why this panel takes a bare instant rather than
 * a block: there is nothing else to show, and inventing a "Closed by" row would
 * imply somebody here decided it.
 *
 * ── Why the empty fields on this screen are the state working ─────────────────
 * jovi-mall has already removed the identifiers — `email`, `phone` and the
 * customer's name are gone and **not recoverable**. The row survives only so
 * orders, tickets and bookings still resolve to something. So the panel says so
 * outright: without it, a closed row reads as a broken payload, and the natural
 * next move is to go looking for a bug in the projection.
 *
 * ⚠ **The instant itself can be `null` on a closed account** — the contract
 * types it `ISO-8601 | null`. That is a closure whose date was never recorded,
 * not an open account, so the panel still renders and names the gap.
 */
export function ClosurePanel({ closedAt, timeZone }: ClosurePanelProps) {
    const at = formatInstantInZone(closedAt, timeZone);

    return (
        <Alert>
            <UserX />
            <AlertTitle>This account was closed by its owner</AlertTitle>
            <AlertDescription className="space-y-2">
                <p>
                    An administrator did not do this and cannot undo it. There is no reinstatement
                    for a closure, and nothing can be done to the account from here: it cannot be
                    suspended, sent a link or a message, or given new login details.
                </p>

                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium">Closed</dt>
                    <dd>{at ?? 'Date not recorded'}</dd>
                </dl>

                <p className="text-xs">
                    The email, phone and name were erased at closure and are not recoverable — so
                    empty identifiers below are expected here, not missing data. The record itself
                    is kept so past orders, tickets and bookings still resolve to somebody.
                </p>
            </AlertDescription>
        </Alert>
    );
}
