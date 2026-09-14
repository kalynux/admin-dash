import { AppLogo } from '@/components/layout/AppLogo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { env } from '@/config/env';

interface AuthLayoutProps {
    title: string;
    description?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /**
     * How wide the card is.
     *
     * `sm` is the credential screens — one field at a time, and a narrow column
     * is what makes them read as a single decision. `lg` exists for onboarding,
     * which is a *form*: it sits outside the dashboard shell for the same reason
     * the enrolment wizard does (every nav item a pending session could see
     * points at a route that refuses it), but it is not one question.
     */
    width?: 'sm' | 'lg';
}

/**
 * The chrome shared by every screen that renders without a dashboard around it:
 * sign-in, the two-factor challenge, and the enrolment wizard.
 *
 * It sits inside the theme provider, so it honours a chosen theme even though no
 * session exists yet to have a preference.
 */
export function AuthLayout({
    title,
    description,
    children,
    footer,
    width = 'sm',
}: AuthLayoutProps) {
    return (
        <div className="bg-muted/30 flex min-h-screen flex-col items-center justify-center gap-4 p-4">
            <Card className={width === 'lg' ? 'w-full max-w-3xl' : 'w-full max-w-sm'}>
                <CardHeader className="items-center text-center">
                    <AppLogo className="mx-auto size-12" />
                    <CardTitle className="mt-2 text-lg">{title}</CardTitle>
                    {description ? <CardDescription>{description}</CardDescription> : null}
                </CardHeader>
                <CardContent>{children}</CardContent>
            </Card>

            {footer}

            {/* The base URL is the first thing to check when nothing connects, and
                the CORS allowlist is exact-match — so a wrong port fails opaquely.
                Worth showing while developing, worth hiding in production.

                Mono, and left that way by the A2 sweep: this is build
                configuration read back for a developer, not a record's value —
                no id, no address, nothing an operator pastes. It also never
                renders in production, so a copy control here would be an
                affordance no operator can ever see. */}
            {env.isDev ? (
                <p className="text-muted-foreground text-center text-xs">
                    API: <span className="font-mono">{env.apiBaseUrl}</span>
                </p>
            ) : null}
        </div>
    );
}
