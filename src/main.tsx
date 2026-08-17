import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from '@/App';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { warnOnSuspectConfig } from '@/config/env';
import { I18nProvider, SessionLocaleSync } from '@/i18n';
import { AuthProvider, UIProvider } from '@/store';
import './index.css';

warnOnSuspectConfig();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            {/* Above everything, including the theme: the sign-in screen shows
                errors too, and an expired session is read by somebody who is
                already signed out. */}
            <I18nProvider>
                {/* The last resort. `AppShell` has its own boundary keyed on the
                    path, but `SignIn`, `MfaSetup` and `SessionWatcher` render
                    outside it — a throw in any of those blanked the app until
                    this existed. */}
                <ErrorBoundary>
                    {/* Outermost of the stores, so the theme applies to the
                        sign-in screen too — it renders before any session
                        exists. */}
                    <UIProvider>
                        {/* Inside the router: the guards read this on the very
                            first render, and its `bootstrapping` state is what
                            stops a hard reload of a deep link from bouncing to
                            sign-in. */}
                        <AuthProvider>
                            <SessionLocaleSync />
                            <App />
                        </AuthProvider>
                    </UIProvider>
                </ErrorBoundary>
            </I18nProvider>
        </BrowserRouter>
    </StrictMode>,
);
