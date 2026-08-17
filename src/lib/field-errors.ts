/**
 * Turning a `VALIDATION_ERROR` into something a form library can consume.
 */

import { hasStaticKey, tStatic } from '@/i18n/runtime';
import { ApiError } from '@/types/api.types';

/**
 * Normalise one `details.fields[].path`.
 *
 * The service dot-joins the path *within whichever target failed* — params, query
 * or body — and does not do so consistently: the contract's own example carries
 * both `"email"` and `"body.tier"` in the same response. A form knows its fields
 * by bare name, so the target prefix comes off.
 */
export function normalizeFieldPath(path: string): string {
    return path.replace(/^(body|query|params)\./, '');
}

/**
 * Server field errors that this form actually has inputs for, keyed by field name.
 *
 * Anything the form does not own is left out rather than dropped silently at the
 * call site — the caller can compare sizes and fall back to the banner when the
 * server complained about something with nowhere to render.
 */
export function pickFieldErrors<TField extends string>(
    error: unknown,
    fields: readonly TField[],
): Partial<Record<TField, string>> {
    if (!(error instanceof ApiError)) return {};

    const known = new Set<string>(fields);
    const out: Partial<Record<TField, string>> = {};

    for (const { path, message } of error.fieldErrors) {
        const name = normalizeFieldPath(path);
        if (!known.has(name)) continue;
        // First one wins: the server reports in schema order, which is the order
        // the form reads in.
        if (out[name as TField] === undefined) out[name as TField] = message;
    }

    return out;
}

/** Did the server name at least one field this form can point at? */
export function hasRenderableFieldErrors(error: unknown, fields: readonly string[]): boolean {
    return Object.keys(pickFieldErrors(error, fields)).length > 0;
}

/**
 * The localized counterpart of `pickFieldErrors`.
 *
 * Resolution per field: `errors.fields.<full.path>` → `errors.fields.<leaf>` →
 * **the server's own message** → `errors.fieldInvalid`.
 *
 * The server tier is kept deliberately. `validation` is a message-bearing
 * category and the service's Zod text is genuinely specific — *"`to` must be
 * after `from` — the range is half-open, [from, to)"* is worth more than any
 * generic line this catalog could hold for a field it has never heard of. It is
 * English, which is the honest cost: a translated vagueness would be worse.
 */
export function resolveFieldErrors<TField extends string>(
    error: unknown,
    fields: readonly TField[],
): Partial<Record<TField, string>> {
    const raw = pickFieldErrors(error, fields);
    const out: Partial<Record<TField, string>> = {};

    for (const [name, serverMessage] of Object.entries(raw) as [TField, string][]) {
        const leaf = name.split('.').pop() ?? name;
        const fullKey = `errors.fields.${name}`;
        const leafKey = `errors.fields.${leaf}`;

        // `||`, not `??`: the server can send an empty string, and a blank
        // message under a highlighted input is worse than a generic one — the
        // field reads as wrong with no reason given.
        out[name] = hasStaticKey(fullKey)
            ? tStatic(fullKey)
            : hasStaticKey(leafKey)
              ? tStatic(leafKey)
              : serverMessage || tStatic('errors.fieldInvalid');
    }

    return out;
}
