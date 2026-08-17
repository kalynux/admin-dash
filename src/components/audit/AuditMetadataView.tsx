import { useMemo } from 'react';
import { EyeOff, Scissors } from 'lucide-react';

import { redactMetadata } from '@/lib/audit-redaction';
import { formatCount } from '@/lib/format';

/**
 * The recorded state on an audit entry — `payload`, `before`, `after`.
 *
 * ── The one screen that renders captured request data ─────────────────────────
 * Everything else on this dashboard renders a DTO the service composed field by
 * field. These three are `Schema.Types.Mixed`: whatever a request body held, as
 * the writer stored it. So this component treats its input as untrusted even
 * though it arrived over an authenticated connection from our own service.
 *
 * Three rules it keeps:
 *
 * 1. **Redact again on the way out.** `sanitiseState()` already stripped
 *    credential-shaped fields server-side; `redactMetadata` does it a second
 *    time. Two nets, because this is the one place where a server regression
 *    would be invisible until after it had been read.
 * 2. **Say what was hidden.** A silently missing field reads as a rendering bug
 *    and teaches nobody anything. The names go on screen; the values never do.
 * 3. **Text nodes only.** `JSON.stringify` into a `<pre>`, never
 *    `dangerouslySetInnerHTML`, and no value is ever interpolated into an
 *    attribute, a URL or the document title.
 *
 * ── Redaction and truncation are different statements ─────────────────────────
 * `stateTruncated` on the entry means the *server* replaced an oversized value
 * with a summary — nothing was withheld for being secret, something was dropped
 * for being big. It gets its own notice, from the caller, because conflating the
 * two would let "we hid a password" and "that array was long" read alike.
 */

/**
 * The summary the writer stores in place of an oversized value.
 *
 * ── This is a shape, not a flag ───────────────────────────────────────────────
 * When a value exceeds `ADMIN_AUDIT_MAX_STATE_BYTES` the writer does not truncate
 * *inside* it — it **replaces the whole value** with
 * `{ truncated: true, bytes, keys }`, keeping the key names because knowing
 * *which* fields changed is most of the forensic value and is the part that is
 * certainly small.
 *
 * So a screen that renders `payload` as JSON without checking would put a
 * three-key object in front of an operator as though it were the request. The
 * entry's own `stateTruncated` boolean is an OR across all three blocks and
 * cannot say *which* one was capped, so the shape is detected per block.
 */
interface TruncatedState {
    truncated: true;
    bytes?: number;
    keys?: string[];
}

function asTruncatedSummary(value: Record<string, unknown>): TruncatedState | null {
    if (value.truncated !== true) return null;
    // `keys` is what distinguishes the writer's summary from a record that merely
    // happens to have a boolean field called `truncated`.
    if (!Array.isArray(value.keys)) return null;

    return {
        truncated: true,
        bytes: typeof value.bytes === 'number' ? value.bytes : undefined,
        keys: value.keys.filter((key): key is string => typeof key === 'string'),
    };
}

interface AuditMetadataViewProps {
    label: string;
    value: Record<string, unknown> | null;
    /** What this block is, when it is absent — the three have different reasons. */
    emptyHint: string;
}

export function AuditMetadataView({ label, value, emptyHint }: AuditMetadataViewProps) {
    const redacted = useMemo(() => redactMetadata(value), [value]);

    // `null` is a fact about the row, not a load failure: an action with no
    // request body records no payload, and a creation has nothing `before`.
    if (value === null) {
        return (
            <section className="space-y-1.5">
                <h3 className="text-sm font-medium">{label}</h3>
                <p className="text-muted-foreground text-sm">{emptyHint}</p>
            </section>
        );
    }

    const summary = asTruncatedSummary(value);
    if (summary) {
        return (
            <section className="space-y-1.5">
                <h3 className="text-sm font-medium">{label}</h3>
                <div className="bg-warning/5 border-warning/30 space-y-2 rounded-md border p-3">
                    <p className="text-sm">
                        This value was too large to store, so the row keeps a summary of it
                        instead
                        {summary.bytes !== undefined ? (
                            <> — {formatCount(summary.bytes)} bytes</>
                        ) : null}
                        . <strong>The values themselves were never written to the trail.</strong>
                    </p>
                    {summary.keys && summary.keys.length > 0 ? (
                        <p className="text-muted-foreground text-xs">
                            The fields it covered were:{' '}
                            <span className="font-mono break-words">
                                {summary.keys.join(', ')}
                            </span>
                        </p>
                    ) : null}
                </div>
            </section>
        );
    }

    return (
        <section className="space-y-1.5">
            <h3 className="text-sm font-medium">{label}</h3>

            <pre className="bg-muted/40 max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap">
                {JSON.stringify(redacted.value, null, 2)}
            </pre>

            {redacted.redactedKeys.length > 0 ? (
                <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                    <EyeOff className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                        {redacted.redactedKeys.length}{' '}
                        {redacted.redactedKeys.length === 1 ? 'field was' : 'fields were'} hidden by
                        this dashboard for looking credential-shaped:{' '}
                        <span className="font-mono">{redacted.redactedKeys.join(', ')}</span>. The
                        service redacts these before storing them too — this is a second check, not
                        the only one.
                    </span>
                </p>
            ) : null}

            {redacted.truncated ? (
                <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                    <Scissors className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                        Parts of this value were too deep or too long to display and were
                        summarised.
                    </span>
                </p>
            ) : null}
        </section>
    );
}
