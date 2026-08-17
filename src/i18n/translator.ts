/**
 * The pure translation resolver — no React, no side effects beyond a dev-only
 * warning, so it can be used from stores, services and tests as easily as from
 * a component.
 */

import { DEFAULT_LOCALE, type Locale, LOCALES } from './config';
import {
    isPluralMessage,
    type MessageCatalog,
    type MessageNode,
    type PluralCategory,
    type TranslateParams,
} from './types';

const INTERPOLATION = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Walk a dot-path into a catalog. Returns `undefined` for any missing hop. */
function lookup(catalog: MessageCatalog | undefined, key: string): MessageNode | undefined {
    if (!catalog) return undefined;
    let node: MessageNode | undefined = catalog;
    for (const segment of key.split('.')) {
        if (typeof node !== 'object' || node === null || isPluralMessage(node)) return undefined;
        node = (node as Record<string, MessageNode>)[segment];
        if (node === undefined) return undefined;
    }
    return node;
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: Locale, count: number): PluralCategory {
    const tag = LOCALES[locale].intlTag;
    let rules = pluralRulesCache.get(tag);
    if (!rules) {
        rules = new Intl.PluralRules(tag);
        pluralRulesCache.set(tag, rules);
    }
    return rules.select(count) as PluralCategory;
}

/**
 * Resolve a node to a raw string, picking a plural form when the node is
 * count-sensitive. A plural message asked for without a `count` falls back to
 * `other` rather than throwing — a missing count is a bug, not a crash.
 */
function toRawString(
    node: MessageNode,
    locale: Locale,
    params?: TranslateParams,
): string | undefined {
    if (typeof node === 'string') return node;
    if (isPluralMessage(node)) {
        const forms = node.__plural;
        const count = typeof params?.count === 'number' ? params.count : undefined;
        if (count === undefined) return forms.other;
        const category = pluralCategory(locale, count);
        return forms[category] ?? forms.other;
    }
    // A namespace node — the caller asked for a branch, not a leaf.
    return undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
    if (!params) return template;
    return template.replace(INTERPOLATION, (match, name: string) => {
        const value = params[name];
        if (value === undefined || value === null) return match;
        return String(value);
    });
}

const warned = new Set<string>();

function warnMissing(locale: Locale, key: string) {
    if (!import.meta.env.DEV) return;
    const id = `${locale}:${key}`;
    if (warned.has(id)) return;
    warned.add(id);
    console.warn(`[i18n] Missing translation "${key}" for locale "${locale}".`);
}

/** Test seam — the warning is one-shot per key, which would leak across cases. */
export function __resetTranslatorWarnings() {
    warned.clear();
}

export type Translate = (key: string, params?: TranslateParams) => string;

/**
 * Build a `t` bound to one locale.
 *
 * Resolution order: the active catalog → the English catalog → the key itself.
 * The English step is what lets a partially translated locale ship: any key it
 * has not covered yet renders in English instead of leaking a dot-path into
 * the UI.
 */
export function createTranslator(
    locale: Locale,
    catalog: MessageCatalog,
    fallbackCatalog: MessageCatalog,
): Translate {
    return function t(key: string, params?: TranslateParams): string {
        const node = lookup(catalog, key);
        const raw = node !== undefined ? toRawString(node, locale, params) : undefined;
        if (raw !== undefined) return interpolate(raw, params);

        if (locale !== DEFAULT_LOCALE) {
            const fallbackNode = lookup(fallbackCatalog, key);
            const fallbackRaw =
                fallbackNode !== undefined
                    ? toRawString(fallbackNode, DEFAULT_LOCALE, params)
                    : undefined;
            if (fallbackRaw !== undefined) {
                warnMissing(locale, key);
                return interpolate(fallbackRaw, params);
            }
        }

        warnMissing(locale, key);
        return key;
    };
}

/** True when a key resolves to a leaf in either the active or the English catalog. */
export function createHasKey(catalog: MessageCatalog, fallbackCatalog: MessageCatalog) {
    return function has(key: string): boolean {
        const node = lookup(catalog, key) ?? lookup(fallbackCatalog, key);
        return node !== undefined && (typeof node === 'string' || isPluralMessage(node));
    };
}
