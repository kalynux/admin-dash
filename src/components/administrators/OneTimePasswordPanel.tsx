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
     *
     * ── ⚠ Why this is not `<CopyableValue variant="plain">` ───────────────────
     * The A2 sweep folded the dashboard's value renders onto that primitive and
     * stopped at this panel on purpose. `CopyableValue` is documented as *"an
     * enhancement, never the only route"* — a ghost icon beside a value that is
     * already legible. Here copying **is** the screen: the password is shown
     * once, stored nowhere, and an operator who leaves without it has to reset
     * the account and end every session it has. That wants a labelled button
     * with a real hit target, not a 24px icon competing with the value beside
     * it. The two behaviours the primitive exists to standardise — the shared
     * `useClipboard`, and a value that stays rendered and `select-all` whatever
     * the clipboard did — are both already here.
     *
     * The 10-minute "Copied" is the other half of it: the primitive resets
     * after 1.5s, which is right for a row you can copy again and wrong for a
     * disclosure you cannot.
     *
     * `PayoutDestinationReveal` and `MfaEnrolmentWizard` are the same shape and
     * kept for the same reason.
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
                {/*
                  ⚠ The email is left as prose, though the A2 sweep makes every
                  other one on this surface copyable. This dialog has exactly
                  one thing to copy, it is shown once, and a second copy control
                  eight pixels away is how somebody leaves with the address in
                  their clipboard and the password gone. The same address is
                  copyable on the administrator's own screen behind this dialog.
                */}
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
