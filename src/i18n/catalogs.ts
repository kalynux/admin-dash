/**
 * Catalog registry.
 *
 * English is imported statically — it is the fallback for every other locale,
 * so it is always needed. French is a dynamic import, which Vite emits as its
 * own chunk: an operator who never leaves English never downloads it.
 */

import en from './locales/en';
import type { Locale } from './config';
import type { MessageCatalog } from './types';

/** The English catalog doubles as the schema every other locale is checked against. */
export type Messages = typeof en;

export const enCatalog: MessageCatalog = en as unknown as MessageCatalog;

type CatalogLoader = () => Promise<{ default: unknown }>;

const LOADERS: Record<Exclude<Locale, 'en'>, CatalogLoader> = {
    fr: () => import('./locales/fr'),
};

const loaded = new Map<Locale, MessageCatalog>([['en', enCatalog]]);
const inFlight = new Map<Locale, Promise<MessageCatalog>>();

/** A catalog already in memory, or `undefined` if it still needs loading. */
export function getLoadedCatalog(locale: Locale): MessageCatalog | undefined {
    return loaded.get(locale);
}

/**
 * Load a catalog, de-duplicating concurrent requests. A failed chunk load
 * resolves to English rather than rejecting — a network hiccup should not take
 * the dashboard down, it should render in the fallback language.
 */
export function loadCatalog(locale: Locale): Promise<MessageCatalog> {
    const already = loaded.get(locale);
    if (already) return Promise.resolve(already);

    const pending = inFlight.get(locale);
    if (pending) return pending;

    const promise = LOADERS[locale as Exclude<Locale, 'en'>]()
        .then((mod) => {
            const catalog = mod.default as MessageCatalog;
            loaded.set(locale, catalog);
            inFlight.delete(locale);
            return catalog;
        })
        .catch((err) => {
            inFlight.delete(locale);
            console.error(`[i18n] Failed to load the "${locale}" catalog — falling back to English.`, err);
            return enCatalog;
        });

    inFlight.set(locale, promise);
    return promise;
}
