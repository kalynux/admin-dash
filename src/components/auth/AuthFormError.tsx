import { AlertTriangle } from 'lucide-react';

import { resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';

/**
 * The inline banner on a credential form.
 *
 * Credential failures get a banner rather than a toast because they belong to the
 * form: the operator is about to retype something, and an answer that slides away
 * after four seconds is the wrong shape for that. It is also why
 * `ADMIN_AUTH_INVALID_CREDENTIALS` lands here and never on a field — attaching it
 * to the email input would tell an attacker the address exists, which is exactly
 * what the service's single-code design is there to prevent.
 *
 * `context` narrows the wording for a credential screen: a rate limit is "too
 * many attempts" there and "too many requests" on a data screen. It has **no
 * default** on purpose — this banner is reused as the generic form banner by
 * every write dialog, and defaulting it to `auth` would quietly give those
 * dialogs credential wording. The four auth screens pass it; nobody else does.
 */
export function AuthFormError({ error, context }: { error: unknown; context?: string }) {
    if (!error) return null;

    const title = resolveErrorMessage(error, { context });
    const description = resolveErrorDetail(error, { context });

    return (
        <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mb-4 flex gap-2.5 rounded-lg border p-3 text-sm"
        >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 space-y-0.5">
                <p className="font-medium">{title}</p>
                {description ? <p className="text-destructive/85 text-xs">{description}</p> : null}
            </div>
        </div>
    );
}
