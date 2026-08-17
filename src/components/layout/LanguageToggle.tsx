import { useState } from 'react';
import { Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LOCALES, SUPPORTED_LOCALES, useTranslation, type Locale } from '@/i18n';
import { notify } from '@/lib/notify';
import { updateOwnProfile } from '@/services/administrators.service';
import { useAuth } from '@/store/auth-context';

/**
 * Switch the dashboard's language.
 *
 * ── Two places the choice lives, and why both ─────────────────────────────────
 * The switch applies **locally and immediately**, then is written back to
 * `preferredLanguage` through `PATCH /administrators/me` so it follows the
 * operator to another browser. wi-admin stores that field already and needs no
 * permission to change your own, so this costs nothing and is the same value
 * `SessionLocaleSync` reads on the next sign-in.
 *
 * The write is **best-effort and never blocks the switch**: the language the
 * operator asked for is the language they get, and a failed persist is a toast
 * rather than a rollback. Rolling back would be the worse failure — it would
 * look like the control is broken.
 *
 * ⚠ **`refreshProfile()`, never a merge.** `PATCH /administrators/me` answers
 * the `Administrator` projection, which has **no `mfaRequired`** — and
 * `deriveMfaEnrolmentRequired` reads exactly that field to recover a scoped
 * enrolment session across a reload. Merging the response into the profile
 * would set it `undefined` and break MFA enrolment recovery for every tier-1
 * account. `EditOwnProfileDialog` carries the same warning for the same reason.
 *
 * Signed-in only. On the sign-in screen the locale comes from localStorage and
 * then browser detection, which is enough for the credential screens' copy and
 * avoids offering a control whose write would 401.
 */
export function LanguageToggle() {
    const { locale, setLocale, t } = useTranslation();
    const { admin, refreshProfile } = useAuth();
    const [saving, setSaving] = useState(false);

    async function choose(next: Locale) {
        if (next === locale) return;

        setLocale(next);
        if (!admin) return;

        setSaving(true);
        try {
            await updateOwnProfile({ preferredLanguage: next });
            await refreshProfile();
        } catch (error) {
            // The fallback names what failed; if wi-admin said *why*, that wins.
            notify.apiError(error, t('errors.state.languageNotSaved'));
        } finally {
            setSaving(false);
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {/* App chrome, not error copy — English literal, like `ThemeToggle`. */}
                <Button variant="ghost" size="icon" aria-label="Change language" disabled={saving}>
                    <Languages className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {SUPPORTED_LOCALES.map((code) => (
                    <DropdownMenuItem
                        key={code}
                        onSelect={() => void choose(code)}
                        data-active={locale === code ? '' : undefined}
                        className="data-[active]:bg-accent"
                    >
                        {LOCALES[code].nativeLabel}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
