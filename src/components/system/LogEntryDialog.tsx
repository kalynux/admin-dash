import type { ReactNode } from 'react';
import { Scissors } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { Field, ScrubbedJson, ScrubbedText } from '@/components/system/ScrubbedFields';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { formatInstantInZone } from '@/lib/format';
import {
    detailsWereDropped,
    wasCutAtWrite,
    type LogEntryView,
} from '@/lib/log-entry';

/**
 * One platform log line, whole.
 *
 * `system.md` anticipates this view — *"expanding a row shows strictly more of
 * what the warning is about"* — and the row cannot hold it: on an error line the
 * row's `msg` is only `"<category> <status> <code>"`, and the failure itself is
 * in the error handler's record and the stack.
 *
 * ── Every free-text field is scrubbed, and says so ────────────────────────────
 * The same two nets the error journal uses, from the same components. This is a
 * tier-1 screen, which is why the stack is shown at all; it is not a reason to
 * put a credential on the screen that the platform's own scrubber missed.
 *
 * ── Absent fields are omitted rather than drawn as `—` ────────────────────────
 * A log line is whatever its writer attached, so most lines carry a handful of
 * these and a dialog of dashes would bury the three that are there. `Message`
 * and `Reference` always render, because their absence is itself information.
 *
 * ⚠ **Still no copy button on the scrubbed text**, for the reason the row gives:
 * a copy would hand over `Bearer [secret-removed]`, which is not what the platform
 * logged, or put the caught credential onto the clipboard. Selecting the text by
 * hand works, and the reference — the value people actually quote — is copyable.
 */
export function LogEntryDialog({
    entry,
    timeZone,
    onClose,
}: {
    entry: LogEntryView | null;
    timeZone: string;
    onClose: () => void;
}) {
    return (
        <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                {entry ? <EntryBody entry={entry} timeZone={timeZone} /> : null}
            </DialogContent>
        </Dialog>
    );
}

function EntryBody({ entry, timeZone }: { entry: LogEntryView; timeZone: string }) {
    const http = entry.httpError;
    const err = entry.err;
    const at = formatInstantInZone(entry.at, timeZone);

    // The same sentence twice is noise: `err.message` is usually the thrown
    // message the handler already recorded, and `clientMessage` equals it on an
    // unmasked category.
    const errMessage =
        err?.message && err.message !== http?.internalMessage ? err.message : null;
    const callerSaw =
        http?.clientMessage && (http.masked || http.clientMessage !== http.internalMessage)
            ? http.clientMessage
            : null;

    const request = [entry.method, entry.path ?? entry.routeGroup].filter(Boolean).join(' ');
    const hasExtra = Object.keys(entry.extra).length > 0;

    return (
        <>
            <DialogHeader className="min-w-0">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Badge variant="outline" className="font-normal">
                        {entry.level || 'log'}
                    </Badge>
                    {http?.code ? <span className="font-mono text-sm">{http.code}</span> : 'Log line'}
                </DialogTitle>
                <DialogDescription>
                    {[at ?? entry.at, entry.status !== null ? String(entry.status) : null, http?.category]
                        .filter(Boolean)
                        .join(' · ')}
                </DialogDescription>
            </DialogHeader>

            <div className="min-w-0 space-y-4 text-sm">
                <Field label="Message">
                    <ScrubbedText value={entry.msg} subject="this log line" />
                </Field>

                <Field label="Reference">
                    {/* Whole: it is the cross-service join, and half of it joins nothing. */}
                    {entry.requestId ? (
                        <CopyableValue
                            value={entry.requestId}
                            label="request reference"
                            truncate={false}
                        />
                    ) : (
                        <span className="text-muted-foreground">
                            None — not written during a request
                        </span>
                    )}
                </Field>

                {http?.internalMessage ? (
                    <Field label="What the code threw">
                        <ScrubbedText value={http.internalMessage} subject="the internal message" />
                        <CutNotice value={http.internalMessage} />
                    </Field>
                ) : null}

                {callerSaw ? (
                    <Field label="Shown to the caller">
                        <ScrubbedText value={callerSaw} subject="the caller's message" />
                        {http?.masked ? (
                            <span className="text-muted-foreground block text-xs">
                                A substituted message — the category is masked, so the caller never
                                saw the line above.
                            </span>
                        ) : null}
                    </Field>
                ) : null}

                {errMessage ? (
                    <Field label={err?.type ? `Error (${err.type})` : 'Error'}>
                        <ScrubbedText value={errMessage} subject="the error message" />
                    </Field>
                ) : null}

                {http?.causeMessage ? (
                    <Field label="Cause">
                        <ScrubbedText value={http.causeMessage} subject="the cause" />
                        <CutNotice value={http.causeMessage} />
                    </Field>
                ) : null}

                {http && http.details !== null ? (
                    <Field label="Details">
                        <ScrubbedJson value={http.details} />
                        {detailsWereDropped(http.details) ? (
                            <CutText>
                                jovi-mall replaced these details with a marker when it wrote the
                                line — they were over its size budget, and the original is not
                                stored anywhere.
                            </CutText>
                        ) : null}
                    </Field>
                ) : null}

                {err?.stack ? (
                    <Field label="Stack">
                        <ScrubbedText value={err.stack} subject="the stack" mono />
                        <CutNotice value={err.stack} />
                    </Field>
                ) : null}

                {request || entry.durationMs !== null ? (
                    <Field label="Request">
                        {request ? <ScrubbedText value={request} subject="the request path" /> : null}
                        {entry.durationMs !== null ? (
                            <span className="text-muted-foreground block text-xs">
                                Took {entry.durationMs} ms
                            </span>
                        ) : null}
                    </Field>
                ) : null}

                {http?.actorRole || entry.actorId ? (
                    <Field label="Caller">
                        {http?.actorRole ? <span className="block">{http.actorRole}</span> : null}
                        {entry.actorId ? (
                            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                                Administrator
                                <CopyableValue value={entry.actorId} label="administrator id" />
                            </span>
                        ) : null}
                    </Field>
                ) : null}

                {entry.source === 'console' ? (
                    <Field label="Written by">
                        A bridged <code className="font-mono text-xs">console</code> call — these
                        carry no component name, so the line cannot say which module wrote it.
                    </Field>
                ) : null}

                {hasExtra ? (
                    <Field label="Other fields">
                        <ScrubbedJson value={entry.extra} subject="these fields" />
                    </Field>
                ) : null}
            </div>
        </>
    );
}

/**
 * Said beside a field jovi-mall cut when it wrote the line, so nobody goes
 * looking for the rest: it was never stored.
 */
function CutNotice({ value }: { value: string | null }) {
    if (!wasCutAtWrite(value)) return null;
    return (
        <CutText>
            Cut by jovi-mall when the line was written (its limit is{' '}
            <code className="font-mono">LOG_MAX_STACK_BYTES</code>, 4 KB by default). The rest was
            never stored.
        </CutText>
    );
}

function CutText({ children }: { children: ReactNode }) {
    return (
        <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-xs">
            <Scissors className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{children}</span>
        </p>
    );
}
