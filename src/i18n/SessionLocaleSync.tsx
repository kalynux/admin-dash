import { useEffect } from 'react';

import { useAuth } from '@/store/auth-context';
import { resolveLocale } from './config';
import { useI18n } from './I18nContext';

/**
 * Applies the administrator's saved `preferredLanguage` once the session loads.
 *
 * Before `/auth/me` resolves there is no profile, so `I18nProvider` starts from
 * localStorage and then browser detection — which is what the sign-in screen
 * renders in. This pushes the stored preference in afterwards.
 *
 * `preferredLanguage` is a free string of 2–10 characters on the wire, so it
 * goes through `resolveLocale` rather than being trusted: an administrator
 * whose record says `pt` renders in English rather than in a dot-path.
 *
 * Renders nothing. It is an effect with a mount point, kept out of the provider
 * so `I18nProvider` stays above the router and independent of the auth store.
 *
 * Reads `useAuth`, never `useAdmin`: this mounts inside the provider but
 * outside `RequireAuth`, and `useAdmin` throws when there is no session.
 */
export function SessionLocaleSync() {
    const { admin } = useAuth();
    const { locale, setLocale } = useI18n();
    const preferred = admin?.preferredLanguage ?? null;

    useEffect(() => {
        if (!preferred) return;
        const resolved = resolveLocale(preferred);
        if (resolved !== locale) setLocale(resolved);
        // `locale` is deliberately absent from the dependency list. Including it
        // would fight the language picker: switching to French re-runs this,
        // sees the profile still says English, and switches straight back.
        // Only a *changed profile value* should move the locale.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preferred, setLocale]);

    return null;
}
