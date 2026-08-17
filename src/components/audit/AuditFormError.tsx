import { TriangleAlert } from 'lucide-react';

import { formatCount } from '@/lib/format';
import { resolveErrorMessage } from '@/lib/errors';
import { ApiError } from '@/types/api.types';

/**
 * A failure from an audit write, rendered where the operator can act on it.
 *
 * ── `AUDIT_EXPORT_TOO_LARGE` is a routine answer, not an edge case ────────────
 * The API export path is bounded by row count (`ADMIN_AUDIT_EXPORT_API_MAX_ROWS`,
 * 50 000 by default), and a quarter of a busy platform's trail exceeds it easily.
 * So this is the *expected* reply to a reasonable-looking request, and it needs
 * to say three things the generic message cannot: how many rows the range
 * actually covers, what the limit is, and that the CLI has no cap.
 *
 * The two numbers come from `details` as `{ rowCount, maxRows }` — read off the
 * service rather than guessed, since the endpoint page names neither key. Both
 * are read defensively so a shape change degrades to a number-free sentence
 * instead of printing `undefined` at somebody.
 */
export function AuditFormError({ error }: { error: unknown }) {
    const tooLarge = error instanceof ApiError && error.code === 'AUDIT_EXPORT_TOO_LARGE';

    const rowCount = readNumber(error, 'rowCount');
    const maxRows = readNumber(error, 'maxRows');

    return (
        <div
            className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-md border p-3"
            role="alert"
        >
            <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
            <div className="space-y-1 text-sm">
                <p>{resolveErrorMessage(error)}</p>

                {tooLarge ? (
                    <p className="text-muted-foreground text-xs">
                        {rowCount !== null && maxRows !== null ? (
                            <>
                                That range covers {formatCount(rowCount)} rows; this endpoint
                                exports at most {formatCount(maxRows)}.{' '}
                            </>
                        ) : null}
                        Narrow the range, or run{' '}
                        <span className="font-mono">npm run audit:export</span> on the server,
                        which has no cap.
                    </p>
                ) : null}
            </div>
        </div>
    );
}

function readNumber(error: unknown, key: string): number | null {
    if (!(error instanceof ApiError)) return null;
    const value = error.details?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
