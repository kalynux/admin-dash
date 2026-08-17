import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';

import { LOCALE_STORAGE_KEY, LOCALES, detectBrowserLocale, resolveLocale, type Locale } from './config';
import { enCatalog, getLoadedCatalog, loadCatalog } from './catalogs';
import { createHasKey, createTranslator } from './translator';
import { setRuntimeI18n } from './runtime';
import { I18nContext, type I18nContextValue } from './I18nContext';
import type { MessageCatalog } from './types';

function readStoredLocale(): Locale {
    try {
        const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (raw) return resolveLocale(raw);
    } catch {
        // Private mode / storage disabled — fall through to browser detection.
    }
    return detectBrowserLocale();
}

/**
 * Applies `lang` and `dir` to `<html>`. Screen readers switch voice on `lang`,
 * and `dir` is what would make an RTL locale lay out correctly if one lands.
 */
function applyDocumentLocale(locale: Locale) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.lang = LOCALES[locale].intlTag;
    root.dir = LOCALES[locale].dir;
}

interface I18nProviderProps {
    children: ReactNode;
    /**
     * Force a locale (tests). When set, the stored/detected locale and any
     * session sync are ignored.
     */
    locale?: Locale;
}

/**
 * Holds the active locale and its catalog.
 *
 * Mounted **above the router** so the pre-auth screens translate too — an
 * expired session and a rejected credential are both errors a signed-out
 * operator reads, and they are exactly the ones this phase localizes.
 * The administrator's saved `preferredLanguage` arrives later, once
 * `/auth/me` resolves; `SessionLocaleSync` pushes it in.
 */
export function I18nProvider({ children, locale: forcedLocale }: I18nProviderProps) {
    const [requestedLocale, setRequestedLocale] = useState<Locale>(readStoredLocale);
    const locale = forcedLocale ?? requestedLocale;

    // `loadCatalog` keeps its own module-level cache, so the catalog in play is
    // *derived* rather than mirrored into state — no effect, and no render
    // where the locale and the catalog disagree. `bumpLoaded` exists only to
    // re-render once an async chunk lands.
    const [, bumpLoaded] = useReducer((n: number) => n + 1, 0);
    const catalog: MessageCatalog = getLoadedCatalog(locale) ?? enCatalog;
    const isLoading = getLoadedCatalog(locale) === undefined;

    useEffect(() => {
        applyDocumentLocale(locale);
    }, [locale]);

    useEffect(() => {
        if (getLoadedCatalog(locale)) return;
        let cancelled = false;
        void loadCatalog(locale).then(() => {
            // A slow chunk may land after the operator switched again; the
            // derived `catalog` above already reflects the current locale, so
            // all this needs to do is ask for one more render.
            if (!cancelled) bumpLoaded();
        });
        return () => {
            cancelled = true;
        };
    }, [locale]);

    const setLocale = useCallback((next: Locale) => {
        setRequestedLocale(next);
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, next);
        } catch {
            // Persistence is a nicety — the switch still applies for this session.
        }
    }, []);

    const value = useMemo<I18nContextValue>(() => {
        const translate = createTranslator(locale, catalog, enCatalog);
        const hasKey = createHasKey(catalog, enCatalog);
        // Keep the non-React snapshot in step, so `services/api.ts` and
        // `lib/notify.ts` translate in the language the UI is rendering.
        setRuntimeI18n({ locale, t: translate, hasKey });
        return {
            locale,
            dir: LOCALES[locale].dir,
            setLocale,
            isLoading,
            t: translate as I18nContextValue['t'],
            tDynamic: translate,
            hasKey,
        };
    }, [locale, catalog, isLoading, setLocale]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
