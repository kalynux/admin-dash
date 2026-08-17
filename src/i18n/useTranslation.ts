import { useI18n, type I18nContextValue } from './I18nContext';

/**
 * The hook every component uses.
 *
 * ```tsx
 * const { t } = useTranslation();
 * <Button>{t('errors.state.retry')}</Button>
 * ```
 *
 * Because the locale lives in React context, switching language re-renders
 * every consumer — the UI changes language in place, with no reload.
 */
export function useTranslation(): I18nContextValue {
    return useI18n();
}

/** Just the locale, for components that only need to switch or format. */
export function useLocale() {
    const { locale, dir, setLocale } = useI18n();
    return { locale, dir, setLocale };
}
