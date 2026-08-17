/**
 * The dashboard's internationalization layer.
 *
 * Stood up in Phase 16 for **the error surface only**. Every user-facing
 * failure message resolves through here; the rest of the dashboard is still
 * English literals and moves namespace by namespace in a later phase.
 *
 * Layout:
 *   config.ts        which languages exist, and their Intl tag / direction
 *   locales/         the catalogs, one directory per language
 *   translator.ts    key lookup, interpolation, pluralization, English fallback
 *   context.tsx      the provider — holds the active locale, swaps catalogs
 *   runtime.ts       the same translator for code that cannot use hooks
 *   keys.ts          `TranslationKey`, derived from the English catalog
 *
 * The error ladder itself lives in `src/lib/errors.ts`, which has been the
 * declared seam since Phase 1 and is where 90+ call sites already point.
 */

export {
    DEFAULT_LOCALE,
    LOCALES,
    SUPPORTED_LOCALES,
    LOCALE_STORAGE_KEY,
    isLocale,
    resolveLocale,
    detectBrowserLocale,
    type Locale,
    type LocaleMeta,
} from './config';

export { I18nProvider } from './context';
export { useI18n, type I18nContextValue } from './I18nContext';
export { SessionLocaleSync } from './SessionLocaleSync';
export { useTranslation, useLocale } from './useTranslation';
export { tStatic, hasStaticKey, getRuntimeLocale, __resetRuntimeI18n } from './runtime';
export { asKey, type TranslationKey } from './keys';
export { plural, type PluralMessage, type TranslateParams } from './types';
export type { Messages } from './catalogs';
