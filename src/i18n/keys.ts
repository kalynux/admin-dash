/**
 * `TranslationKey` — the union of every dot-path in the English catalog.
 *
 * Isolated in its own module so the (moderately expensive) recursive type is
 * computed once and imported everywhere, and so `t()` call sites get a real
 * compile error on a typo instead of a silent runtime miss.
 */

import type { Messages } from './catalogs';
import type { LeafKeys } from './types';

export type TranslationKey = LeafKeys<Messages>;

/**
 * Widen a runtime-built key to a translation key.
 *
 * Use only where the key genuinely cannot be known statically — an error code
 * and a `platformCode` are exactly that, and the whole resolution ladder is
 * built out of them. The lookup still falls back to English and then to the
 * key itself, so a miss degrades rather than throws.
 */
export function asKey(key: string): TranslationKey {
    return key as TranslationKey;
}
