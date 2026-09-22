import type { ReactNode } from 'react';
import { EyeOff } from 'lucide-react';

import { MaskedNotice } from '@/components/system/MaskedNotice';
import { scrubJson, scrubText } from '@/lib/scrub-secrets';

/**
 * The read-only field set shared by the error journal and Platform logs — the two
 * screens that show what the platform's code threw.
 *
 * Lifted out of `SystemErrors` when Platform logs grew a full-entry view, so both
 * screens scrub a stack the same way: two copies of a scrubbing renderer are two
 * places a credential can get through.
 */

/**
 * Free text from the error record, scrubbed, with the omission disclosed.
 *
 * ── What goes through this, and what does not ─────────────────────────────────
 * `internalMessage`, `causeMessage` and `stack` are whatever the code threw — a
 * driver's connection string, a gateway's echo of the request it rejected, a
 * frame from a library that logs its own headers. The error journal's row
 * `message` is the sentence the platform *composed* for the caller from a fixed
 * catalogue, so it cannot carry a credential by construction and is deliberately
 * left alone there.
 */
export function ScrubbedText({
    value,
    subject,
    mono,
}: {
    value: string | null | undefined;
    subject: string;
    mono?: boolean;
}) {
    const { text, matched } = scrubText(value ?? '');
    const body = value ? text : '—';

    return (
        <>
            {mono ? (
                <pre className="bg-muted/50 max-h-80 overflow-auto rounded p-2 text-xs">
                    {body}
                </pre>
            ) : (
                <span className="whitespace-pre-wrap">{body}</span>
            )}
            <MaskedNotice matched={matched} subject={subject} className="mt-1" />
        </>
    );
}

/**
 * A free-form object — `details`, or a log line's own context — with **both**
 * nets.
 *
 * The contract returns `details` *unmasked* to tiers 1 and 2, and it is an
 * arbitrary object from a third-party failure, so a credential can arrive either
 * named (`authorization`) or buried in a value (`note: "retrying with Bearer …"`).
 * Each net catches what the other cannot, and the two are disclosed separately
 * because they are different claims about the same object.
 */
export function ScrubbedJson({
    value,
    subject = 'these details',
}: {
    value: unknown;
    subject?: string;
}) {
    const { text, matched, redactedKeys } = scrubJson(value);

    return (
        <>
            <pre className="bg-muted/50 max-h-64 overflow-auto rounded p-2 text-xs">{text}</pre>
            {redactedKeys.length > 0 ? (
                <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-xs">
                    <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                        {redactedKeys.length}{' '}
                        {redactedKeys.length === 1 ? 'field was' : 'fields were'} hidden for having
                        a credential-shaped name:{' '}
                        <span className="font-mono">{redactedKeys.join(', ')}</span>.
                    </span>
                </p>
            ) : null}
            <MaskedNotice matched={matched} subject={subject} className="mt-1" />
        </>
    );
}

/**
 * A labelled value.
 *
 * ⚠ `[overflow-wrap:anywhere]` and `min-w-0`, not `break-words` alone. These
 * render inside `DialogContent`, which is a CSS grid, and a grid item's minimum
 * width is its min-content — which `overflow-wrap: break-word` does not shrink.
 * A path with a long query string, or a JSON message with no spaces, would widen
 * the dialog past the viewport and clip the very text it is there to show.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0 space-y-0.5">
            <p className="text-muted-foreground text-xs">{label}</p>
            <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
        </div>
    );
}
