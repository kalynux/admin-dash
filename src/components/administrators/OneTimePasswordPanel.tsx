import { Check, Copy, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { administratorDisplayName, type Administrator } from '@/types/administrators.types';
import { useClipboard } from '@/hooks/use-clipboard';

/**
 * The password the service generated, shown **once**.
 *
 * ── Where this value may and may not go ───────────────────────────────────────
 * It lives in component state and nowhere else. Not in a store, not in the URL,
 * not in `sessionStorage`, not in a `useAsyncData` key, and **never in a toast**
 * — a toast outlives the screen that fired it and lands in a corner of every
 * subsequent page. It is not logged, and the component holding it unmounts on
 * dismissal.
 *
 * ── Why dismissal is deliberate ───────────────────────────────────────────────
 * `administrators.md`: *"`oneTimePassword` is shown once and stored nowhere
 * else. There is no email delivery in this service, so the creating
 * administrator is the delivery channel."* If it is lost the only remedy is
 * another password reset, which ends every session the account has. So the
 * parent dialog must refuse outside-clicks and Escape while this is showing, and
 * the only way past it is the explicit button below.
 *
 * ── The message is the server's ───────────────────────────────────────────────
 * `message` comes from the envelope and differs between create and reset. It is
 * rendered verbatim rather than re-worded here, so the sentence an operator
 * reads is the one the service chose.
 */
export function OneTimePasswordPanel({
    password,
    administrator,
    message,
    sessionsEnded,
    onDone,
}: {
    password: string;
    administrator: Administrator;
    /** The envelope's `message`. Rendered as given. */
    message?: string;
    /** Present on a password reset; absent on a create. */
    sessionsEnded?: number;
    onDone: () => void;
}) {
    /*
     * The clipboard API is origin- and permission-restricted and simply refuses
     * in some contexts. The failure is swallowed here: the value is already on
     * screen in a `select-all` block, which is the fallback, and an error toast
     * would be alarming about nothing.
     *
     * `resetAfterMs` is effectively disabled — unlike every other copy control
     * on the dashboard, this one is shown once and never again, so "Copied"
     * should stay put as the record that it worked.
     */
    const { copy: writeToClipboard, copied } = useClipboard({ resetAfterMs: 10 * 60_000 });

    async function copy() {
        await writeToClipboard(password);
    }

    return (
        <div className="space-y-4">
            <div className="border-warning/40 bg-warning/10 space-y-1 rounded-md border p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                    <KeyRound className="size-4 shrink-0" aria-hidden />
                    Copy this now — it is shown once
                </p>
                <p className="text-muted-foreground text-xs">
                    {message ??
                        'It is stored nowhere else, here or on the server. There is no email delivery on this service, so you are the delivery channel.'}
                </p>
            </div>

            <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                    One-time password for {administratorDisplayName(administrator)} (
                    {administrator.email})
                </p>
                <div className="flex items-center gap-2">
                    {/*
                      `select-all` so a triple-click takes the whole value, and
                      the text is present in the DOM regardless of whether the
                      clipboard API is available.
                    */}
                    <code className="bg-muted min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-sm break-all select-all">
                        {password}
                    </code>
                    <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                        {copied ? (
                            <>
                                <Check className="size-4" aria-hidden />
                                Copied
                            </>
                        ) : (
                            <>
                                <Copy className="size-4" aria-hidden />
                                Copy
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {sessionsEnded !== undefined ? (
                <p className="text-muted-foreground text-xs">
                    {sessionsEnded === 0
                        ? 'They had no active sessions.'
                        : `${sessionsEnded} session${sessionsEnded === 1 ? '' : 's'} ended. A reset that left the old sessions alive would not recover the account — it would add a second way in.`}
                </p>
            ) : null}

            <DialogFooter>
                <Button type="button" onClick={onDone}>
                    I have copied it
                </Button>
            </DialogFooter>
        </div>
    );
}
