/**
 * A snapshot of the active translator, reachable outside React.
 *
 * Three callers need it and none can use hooks:
 *
 * - `services/api.ts` synthesises a session-ended message when `/auth/refresh`
 *   fails without an envelope;
 * - `lib/notify.ts` is called from services and from `catch` blocks, not only
 *   from components;
 * - `lib/errors.ts` is a pure module that 90 `DataState` call sites reach
 *   through props rather than through context.
 *
 * `I18nProvider` publishes the live translator here on every locale change, so
 * those callers stay in step with the UI instead of hardcoding English.
 * Inside components prefer `useTranslation()` / `useApiError()` — they
 * re-render on a language switch, which a module-level snapshot cannot do.
 */

import { DEFAULT_LOCALE, type Locale } from './config';
import { enCatalog } from './catalogs';
import { createHasKey, createTranslator, type Translate } from './translator';
import type { TranslateParams } from './types';

interface RuntimeI18n {
    locale: Locale;
    t: Translate;
    hasKey: (key: string) => boolean;
}

function englishSnapshot(): RuntimeI18n {
    return {
        locale: DEFAULT_LOCALE,
        t: createTranslator(DEFAULT_LOCALE, enCatalog, enCatalog),
        hasKey: createHasKey(enCatalog, enCatalog),
    };
}

let current: RuntimeI18n = englishSnapshot();

/** Called by `I18nProvider` whenever the locale or catalog changes. */
export function setRuntimeI18n(next: RuntimeI18n) {
    current = next;
}

/**
 * Test seam. Without it a test that mounts a French provider leaves the
 * snapshot in French for every later test file in the same worker.
 */
export function __resetRuntimeI18n() {
    current = englishSnapshot();
}

export function getRuntimeLocale(): Locale {
    return current.locale;
}

/** Translate from non-React code. */
export function tStatic(key: string, params?: TranslateParams): string {
    return current.t(key, params);
}

/** Does this key resolve? Non-React counterpart of `useI18n().hasKey`. */
export function hasStaticKey(key: string): boolean {
    return current.hasKey(key);
}
