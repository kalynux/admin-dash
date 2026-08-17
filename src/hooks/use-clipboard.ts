import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy a value, and say so for a moment afterwards.
 *
 * Three screens had already written this inline — the payout destination reveal,
 * the one-time password panel and the MFA enrolment wizard — each with slightly
 * different failure handling. This is that behaviour once.
 *
 * ── Why the failure path is not decoration ────────────────────────────────────
 * `navigator.clipboard.writeText` rejects for reasons the operator can do
 * nothing about and the developer cannot reproduce: the Permissions API refused,
 * the document was not focused at the moment of the call, or — the common one in
 * this project's deployments — **the page is not a secure context**, because
 * `navigator.clipboard` is `undefined` on plain HTTP anywhere but `localhost`.
 * So `copy` reports a boolean rather than throwing, and the caller is expected
 * to leave the value on screen and selectable either way. Copying is a
 * convenience over selecting; it must never be the only way to get the value.
 */
export interface Clipboard {
    /** Resolves `true` when the value reached the clipboard. Never throws. */
    copy: (value: string) => Promise<boolean>;
    /** True for `resetAfterMs` following a successful copy. */
    copied: boolean;
    /** True when the last attempt failed, so a caller can say "select it instead". */
    failed: boolean;
}

export function useClipboard({ resetAfterMs = 1500 }: { resetAfterMs?: number } = {}): Clipboard {
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // A row can unmount while the "Copied" window is still open — a list
    // refetches, a dialog closes — and a `setState` after that is a warning at
    // best and a leak at worst.
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );

    const copy = useCallback(
        async (value: string) => {
            if (timer.current) clearTimeout(timer.current);

            try {
                // Optional-chained rather than assumed: on a non-secure origin
                // the whole `clipboard` object is absent, not a method that
                // rejects, so `navigator.clipboard.writeText` would throw a
                // TypeError out of the promise chain.
                if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
                await navigator.clipboard.writeText(value);
            } catch {
                setCopied(false);
                setFailed(true);
                return false;
            }

            setFailed(false);
            setCopied(true);
            timer.current = setTimeout(() => setCopied(false), resetAfterMs);
            return true;
        },
        [resetAfterMs],
    );

    return { copy, copied, failed };
}
