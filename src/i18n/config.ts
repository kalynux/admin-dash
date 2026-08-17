/**
 * Locale registry — the single source of truth for which languages the
 * dashboard speaks.
 *
 * Two, deliberately: the market is Cameroon and the users are internal staff.
 * Adding a third is a row here plus a catalog under `src/i18n/locales/<code>/`;
 * nothing else in the app enumerates locales.
 *
 * `preferredLanguage` on the administrator profile is the same field wi-admin
 * stores, so the dashboard and the operator's record agree. It is a free string
 * of 2–10 characters on the wire, which is why everything that reads it goes
 * through `resolveLocale` rather than trusting it.
 */

export const DEFAULT_LOCALE = 'en' as const;

export type Locale = 'en' | 'fr';

export interface LocaleMeta {
    code: Locale;
    /** Name in English — used in docs and admin surfaces. */
    label: string;
    /** Name in the language itself — what the picker shows. */
    nativeLabel: string;
    /**
     * Writing direction, applied to `<html dir>`.
     *
     * Both locales are `ltr` today. The field is kept because removing it is
     * the change that hurts later: every consumer would have to grow one when
     * the first RTL locale lands, and there is no cost to carrying it.
     */
    dir: 'ltr' | 'rtl';
    /**
     * BCP-47 tag handed to `Intl.*`. Kept separate from `code` so a locale can
     * be regionalised (e.g. `fr-CM`) without renaming its catalog directory.
     */
    intlTag: string;
}

export const LOCALES: Record<Locale, LocaleMeta> = {
    en: {
        code: 'en',
        label: 'English',
        nativeLabel: 'English',
        dir: 'ltr',
        intlTag: 'en',
    },
    fr: {
        code: 'fr',
        label: 'French',
        nativeLabel: 'Français',
        dir: 'ltr',
        intlTag: 'fr',
    },
};

export const SUPPORTED_LOCALES = Object.keys(LOCALES) as Locale[];

export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && value in LOCALES;
}

/**
 * Normalise anything that claims to be a language into a supported locale.
 * Accepts bare codes (`fr`), BCP-47 tags (`fr-CM`, `fr_CA`) and unknown junk,
 * always landing on a locale the app can actually render.
 */
export function resolveLocale(value: unknown): Locale {
    if (isLocale(value)) return value;
    if (typeof value === 'string') {
        const base = value.toLowerCase().replace('_', '-').split('-')[0];
        if (isLocale(base)) return base;
    }
    return DEFAULT_LOCALE;
}

/** Best guess from the browser, used before a session is loaded. */
export function detectBrowserLocale(): Locale {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
    for (const lang of navigator.languages ?? [navigator.language]) {
        if (!lang) continue;
        const resolved = resolveLocale(lang);
        // `resolveLocale` falls back to `en`, so only accept a real match.
        if (resolved !== DEFAULT_LOCALE) return resolved;
        if (lang.toLowerCase().startsWith('en')) return 'en';
    }
    return DEFAULT_LOCALE;
}

/** localStorage key holding the last locale, so a reload doesn't flash English. */
export const LOCALE_STORAGE_KEY = 'admin-dash:locale';
