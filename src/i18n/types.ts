/**
 * Type plumbing for the translation catalogs.
 *
 * The English catalog is the schema: `TranslationKey` is derived from it, so a
 * typo in a `t('...')` call is a compile error, and every other locale is
 * checked structurally against it (a `DeepPartial`, so an unfinished catalog
 * still compiles and falls back to English key by key).
 */

/** CLDR plural categories. Which ones apply depends on the locale. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export type PluralForms = Partial<Record<Exclude<PluralCategory, 'other'>, string>> & {
    other: string;
};

/**
 * A count-sensitive message. Branded rather than duck-typed so a namespace
 * that happens to contain an `other` key is never mistaken for a plural.
 */
export interface PluralMessage {
    readonly __plural: PluralForms;
}

/**
 * Declare a count-sensitive message. Resolution uses `Intl.PluralRules`, so a
 * language with more than two forms works by adding the extra categories — no
 * call-site change.
 *
 * ```ts
 * retryAfter: plural({ one: 'Try again in {{count}} second.', other: 'Try again in {{count}} seconds.' })
 * // t('errors.detail.retryAfter', { count: 42 }) → 'Try again in 42 seconds.'
 * ```
 */
export function plural(forms: PluralForms): PluralMessage {
    return { __plural: forms };
}

export function isPluralMessage(value: unknown): value is PluralMessage {
    return typeof value === 'object' && value !== null && '__plural' in value;
}

/** A catalog node: a string, a plural message, or a nested namespace. */
export type MessageNode = string | PluralMessage | { [key: string]: MessageNode };

export type MessageCatalog = { [key: string]: MessageNode };

/**
 * Dot-paths of every *leaf* in a catalog. Namespace nodes are deliberately not
 * keys — `t('errors')` should not typecheck.
 */
export type LeafKeys<T> = {
    [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends PluralMessage
          ? K
          : T[K] extends object
            ? `${K}.${LeafKeys<T[K]>}`
            : never;
}[keyof T & string];

/** Recursively optional — the shape every non-English catalog is checked against. */
export type DeepPartial<T> = T extends string
    ? string
    : T extends PluralMessage
      ? PluralMessage
      : { [K in keyof T]?: DeepPartial<T[K]> };

/** Values substituted into `{{placeholders}}`. `count` also selects the plural form. */
export type TranslateParams = Record<string, string | number | null | undefined>;
