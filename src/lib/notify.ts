/**
 * Toasts.
 *
 * A thin wrapper over sonner so that (a) every error toast surfaces the request
 * reference the same way, and (b) nothing outside this module has to know which
 * toast library is mounted.
 */

import { toast } from 'sonner';
import { resolveErrorDetail, resolveErrorMessage, type ResolveErrorOptions } from '@/lib/errors';
import { ApiError } from '@/types/api.types';

interface NotifyOptions {
    description?: string;
    duration?: number;
}

export const notify = {
    success(message: string, options?: NotifyOptions) {
        return toast.success(message, options);
    },

    info(message: string, options?: NotifyOptions) {
        return toast.info(message, options);
    },

    warning(message: string, options?: NotifyOptions) {
        return toast.warning(message, options);
    },

    error(message: string, options?: NotifyOptions) {
        return toast.error(message, options);
    },

    /**
     * The default handler for a failed request.
     *
     * Renders the catalogued message for the code, plus the remedy, the
     * reference id and any platform code as the description — the things
     * support asks for and the things an operator otherwise has to find in
     * devtools.
     *
     * The second parameter accepts a plain string for the ~40 call sites that
     * pass a hand-written "Could not do X" fallback, or an options object to
     * name a screen `context`. A fallback is used **only when the catalog and
     * the server both had nothing** — it names what the operator was doing, and
     * a real reason beats it every time.
     */
    apiError(error: unknown, fallback?: string | ResolveErrorOptions) {
        const options: ResolveErrorOptions =
            typeof fallback === 'string' ? { fallbackMessage: fallback } : (fallback ?? {});

        const message = resolveErrorMessage(error, options);
        const description = resolveErrorDetail(error, options);

        // A rate limit is self-clearing and a conflict resolves on reload —
        // neither deserves the same visual weight as a real fault.
        const isSoft =
            error instanceof ApiError &&
            (error.category === 'rate_limit' || error.category === 'conflict');

        return isSoft
            ? toast.warning(message, { description })
            : toast.error(message, { description });
    },

    /*
      There is deliberately no `queuedForApproval` toast.

      A `202` is not a failure, and it is also not a thing to say and slide away:
      a queued mark-paid never appears on the payout's own Activity feed
      (`queuedIntent` re-targets the audit row at the approval request), so the
      acknowledgement *is* the only record an operator gets. All four
      dual-controlled writes therefore render a persistent
      `AdministratorQueuedNotice` in place, carrying the approval and its expiry.
      A toast here would be a second, worse way to say the same thing.
    */

    promise: toast.promise,
    dismiss: toast.dismiss,
};
