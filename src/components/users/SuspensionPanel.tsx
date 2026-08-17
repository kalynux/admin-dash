import { Ban } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatInstantInZone } from '@/lib/format';
import type { Suspension } from '@/types/users.types';

interface SuspensionPanelProps {
    suspension: Suspension;
    timeZone: string;
}

/**
 * Why an account cannot sign in.
 *
 * ── Render this only after checking `status` ──────────────────────────────────
 * The service already keys the whole `suspension` object on `status` and sends
 * `null` on an active account, so this component takes a non-null value and the
 * caller does the check. That is the contract's own reasoning: an active account
 * carrying a stale reason reads as suspended on any screen that renders the block
 * without looking at `status` first.
 *
 * ── Why the actor's id is not a link ──────────────────────────────────────────
 * `by.source` says which identity space `by.id` belongs to, and it is the whole
 * point of the field. An `'admin'` id lives in the **wi-admin database** and
 * resolves to nothing in jovi-mall, so linking it to a platform user would be a
 * link to the wrong person or to nothing. `by.name` is a snapshot taken at write
 * time for exactly this reason — it is the only readable record there will be.
 *
 * ── What is not here ──────────────────────────────────────────────────────────
 * A history. **Reinstatement clears this block entirely** — the reason, the
 * timestamp and the actor — so the audit trail is the only surviving record that
 * a suspension happened at all. The Activity tab is where that lives.
 */
export function SuspensionPanel({ suspension, timeZone }: SuspensionPanelProps) {
    const at = formatInstantInZone(suspension.at, timeZone);
    const actor = suspension.by;

    return (
        <Alert variant="destructive">
            <Ban />
            <AlertTitle>This account is suspended</AlertTitle>
            <AlertDescription className="space-y-2">
                <p>
                    Sign-in is blocked on every device. The block takes effect on the person&apos;s
                    next request, not at their next sign-in — so any session they had is already
                    dead.
                </p>

                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium">Reason</dt>
                    <dd>{suspension.reason ?? 'Not recorded'}</dd>

                    <dt className="font-medium">Suspended</dt>
                    <dd>{at ?? 'Not recorded'}</dd>

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
                    Role profiles are untouched by this — a vendor store or agent record keeps its
                    own status, on its own screen.
                </p>
            </AlertDescription>
        </Alert>
    );
}
