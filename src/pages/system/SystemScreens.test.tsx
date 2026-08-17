import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SystemErrors } from '@/pages/system/SystemErrors';
import { SystemHealth } from '@/pages/system/SystemHealth';
import { SystemIntegrations } from '@/pages/system/SystemIntegrations';
import { SystemMaintenance } from '@/pages/system/SystemMaintenance';
import { SystemMetrics } from '@/pages/system/SystemMetrics';
import { SystemQueues } from '@/pages/system/SystemQueues';
import { SystemWorkers } from '@/pages/system/SystemWorkers';
import {
    adminFixture,
    heldFixture,
    maintenanceFixture,
    outboxSummaryFixture,
    readinessFixture,
    systemHealthFixture,
} from '@/test/fixtures';
import {
    LEAKED_TOKEN,
    adminErrorFixture,
    cacheReportFixture,
    dependenciesFixture,
    developerErrorFixture,
    geoTrackerFixture,
    integrationsFixture,
    metricsFixture,
    queuesFixture,
    supportErrorFixture,
    systemErrorsPageFixture,
    workersReportFixture,
} from '@/test/system-fixtures';
import {
    FEATURE_FLAGS_FIXTURE,
    overriddenFlagFixture,
    setMaintenanceResultFixture,
    workerRefusedFixture,
    workerRunFixture,
} from '@/test/dev-tools-fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

type Answer = (call: FetchCall) => Response | undefined;

/**
 * Answers whichever `/system` reads the screen under test makes and **throws on anything else**,
 * so a stray request fails the test rather than passing silently.
 */
function stubSystem(...overrides: Answer[]) {
    return stubFetch((call) => {
        for (const answer of overrides) {
            const response = answer(call);
            if (response) return response;
        }
        if (call.url.includes('/system/health')) return successResponse(systemHealthFixture());
        if (call.url.includes('/system/dependencies')) return successResponse(dependenciesFixture());
        if (call.url.includes('/system/cache')) return successResponse(cacheReportFixture());
        if (call.url.includes('/system/geo-tracker')) return successResponse(geoTrackerFixture());
        if (call.url.includes('/health/live')) {
            return successResponse({
                status: 'alive',
                service: 'wi-admin',
                uptimeSeconds: 84_213,
                timestamp: '2026-08-16T09:14:02.331Z',
            });
        }
        if (call.url.includes('/health/ready')) return successResponse(readinessFixture());
        if (call.url.includes('/system/workers')) return successResponse(workersReportFixture());
        if (call.url.includes('/system/outbox')) return successResponse(outboxSummaryFixture());
        if (call.url.includes('/system/queues')) return successResponse(queuesFixture());
        if (call.url.includes('/system/integrations')) return successResponse(integrationsFixture());
        if (call.url.includes('/system/metrics')) return successResponse(metricsFixture());
        if (call.url.includes('/system/maintenance')) return successResponse(maintenanceFixture());
        if (call.url.includes('/system/errors')) return successResponse(systemErrorsPageFixture());
        if (call.url.includes('/dev-tools/feature-flags')) {
            return successResponse({ flags: FEATURE_FLAGS_FIXTURE });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function render(ui: React.ReactElement, tier: AdminTier = 1) {
    return renderWithProviders(ui, {
        route: '/dashboard/system',
        permissions: { held: heldFixture(tier) },
    });
}

describe('Health', () => {
    /**
     * The reason three of these reads exist separately at all: the local half must keep working
     * when the delegated half does not. One `Promise.all` would blank the page that exists to
     * tell you the platform is down.
     */
    it('renders wi-admin’s own half when the platform’s half is unreachable', async () => {
        stubSystem((call) =>
            call.url.includes('/system/dependencies')
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                      category: 'external_service',
                  })
                : undefined,
        );
        render(<SystemHealth />);

        // The local panel still answers — twice over, since the unauthenticated probe beside it
        // reports the same connection under its own name.
        expect((await screen.findAllByText('wi-admin database')).length).toBeGreaterThan(0);
        // …and the delegated one offers a retry rather than taking the page with it.
        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('labels the two Mongo connections by meaning, because the key sets invert', async () => {
        stubSystem();
        render(<SystemHealth />);

        // `/system/health` calls them admin/platform and `/health/ready` calls the same two
        // mongoAdmin/mongoPlatform — inverted. Both panels are on this screen at once, so a
        // positional mapping would put "wi-admin" against the platform database.
        const labels = await screen.findAllByText('wi-admin database');
        expect(labels.length).toBeGreaterThanOrEqual(2);
        expect(screen.getAllByText('Platform database').length).toBeGreaterThanOrEqual(2);
    });

    it('renders an unconfigured geo-tracker as a steady state, not a fault', async () => {
        stubSystem((call) =>
            call.url.includes('/system/geo-tracker')
                ? successResponse(
                      geoTrackerFixture({ configured: false, health: null, readiness: null }),
                  )
                : undefined,
        );
        render(<SystemHealth />);

        expect(await screen.findByText(/not configured in this deployment/i)).toBeInTheDocument();
        expect(screen.getByText(/steady state, not\s+a fault/i)).toBeInTheDocument();
    });

    it('reports the dangling-intent cap as a floor rather than an exact count', async () => {
        stubSystem((call) =>
            call.url.includes('/system/health')
                ? successResponse(
                      systemHealthFixture({
                          audit: {
                              danglingIntents: 100,
                              danglingIntentsCappedAt: 100,
                              oldestDanglingAt: '2026-08-12T22:41:03.118Z',
                              retentionDays: 365,
                          },
                      }),
                  )
                : undefined,
        );
        render(<SystemHealth />);

        // The query stops counting at the cap, so a bare "100" would read as exactly a hundred.
        expect(await screen.findByText('100+')).toBeInTheDocument();
    });
});

describe('Workers', () => {
    it('shows the three state booleans as three columns, never collapsed into one', async () => {
        stubSystem();
        render(<SystemWorkers />);

        expect(await screen.findByRole('columnheader', { name: 'Scheduled' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Executing' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Manual claim' })).toBeInTheDocument();
        // The legacy shape's single flag is what this replaces; it must not reappear.
        expect(screen.queryByRole('columnheader', { name: 'Running' })).not.toBeInTheDocument();
    });

    it('says the booleans describe only the instance that answered', async () => {
        stubSystem();
        render(<SystemWorkers />);

        expect(await screen.findByText(/process-local/i)).toBeInTheDocument();
    });

    it('offers no trigger on the worker that cannot be run', async () => {
        stubSystem();
        render(<SystemWorkers />);

        const row = (await screen.findByText('inbound-calendar-sync')).closest('tr');
        expect(within(row as HTMLElement).queryByRole('button', { name: /run now/i })).toBeNull();
        expect(within(row as HTMLElement).getByText(/two horizons/i)).toBeInTheDocument();
    });

    it('hides the trigger entirely without developer_tools.workers.trigger', async () => {
        stubSystem();
        render(<SystemWorkers />, 2);

        await screen.findByText('tracking-dispatch');
        expect(screen.queryByRole('button', { name: /run now/i })).not.toBeInTheDocument();
    });

    it('warns that the tools are switched off before a trigger is attempted', async () => {
        stubSystem();
        render(<SystemWorkers />);

        // The flag defaults off, and the fixture reflects that. Saying so up front beats
        // letting an operator press a button that will refuse.
        expect(await screen.findByText(/developer tools are switched off/i)).toBeInTheDocument();
    });

    it('does not warn when the flag is on', async () => {
        stubSystem((call) =>
            call.url.includes('/dev-tools/feature-flags')
                ? successResponse({
                      flags: [overriddenFlagFixture({ name: 'dev_tools.enabled', enabled: true })],
                  })
                : undefined,
        );
        render(<SystemWorkers />);

        await screen.findByText('tracking-dispatch');
        expect(screen.queryByText(/developer tools are switched off/i)).not.toBeInTheDocument();
    });
});

describe('running a worker', () => {
    async function openTrigger() {
        await screen.findByText('tracking-dispatch');
        const row = screen.getByText('tracking-dispatch').closest('tr') as HTMLElement;
        await userEvent.click(within(row).getByRole('button', { name: /run now/i }));
        // Just over the ten-character floor: every character is an event, and these dialogs are
        // the most keystroke-heavy cases in the suite.
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Draining it');
    }

    /**
     * `ran` is optional and its absence means true. This is the case a screen branching on
     * `ran === true` gets wrong against any platform predating the overlap lock.
     */
    it('reports a run when the response omits `ran` entirely', async () => {
        stubSystem((call) =>
            call.url.includes('/workers/tracking-dispatch/run')
                ? successResponse(workerRunFixture({ worker: 'tracking-dispatch' }), {
                      message: 'Ran "tracking-dispatch" in 4182ms',
                  })
                : undefined,
        );
        render(<SystemWorkers />);

        await openTrigger();
        await userEvent.click(screen.getByRole('button', { name: /run it/i }));

        expect(await screen.findByText(/ran in 4182 ms/i)).toBeInTheDocument();
    });

    it('reports `ran: false` as a neutral outcome rather than a failure', async () => {
        stubSystem((call) =>
            call.url.includes('/workers/tracking-dispatch/run')
                ? successResponse(workerRefusedFixture())
                : undefined,
        );
        render(<SystemWorkers />);

        await openTrigger();
        await userEvent.click(screen.getByRole('button', { name: /run it/i }));

        // A 200. The sweep is in flight somewhere and this trigger changed nothing.
        expect(await screen.findByText('Nothing ran.')).toBeInTheDocument();
        // The platform's own note and this screen's explanation both say it, which is the point:
        // an operator must not read a refused trigger as a failed one.
        expect(screen.getAllByText(/already in progress/i).length).toBeGreaterThan(0);
    });

    it('reads a busy verdict off details.platformCode, not error.code', async () => {
        stubSystem((call) =>
            call.url.includes('/workers/tracking-dispatch/run')
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'conflict',
                      details: { platformCode: 'DEV_TOOLS_WORKER_BUSY' },
                  })
                : undefined,
        );
        render(<SystemWorkers />);

        await openTrigger();
        await userEvent.click(screen.getByRole('button', { name: /run it/i }));

        // `PLATFORM_OPERATION_REJECTED` is every delegated refusal on the service; branching on
        // it would say "already running" for any of them.
        expect(await screen.findByText(/already running that sweep/i)).toBeInTheDocument();
    });

    it('renders the flag refusal as a service state, not a permission problem', async () => {
        stubSystem((call) =>
            call.url.includes('/workers/tracking-dispatch/run')
                ? errorResponse(409, 'DEV_TOOLS_DISABLED', {
                      message: 'Developer tools are switched off',
                      category: 'business_rule',
                  })
                : undefined,
        );
        render(<SystemWorkers />);

        await openTrigger();
        await userEvent.click(screen.getByRole('button', { name: /run it/i }));

        expect(await screen.findByText(/did not run/i)).toBeInTheDocument();
        // A 403 would send an administrator to inspect their own grants — the wrong place.
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
    });

    it('will not run until a reason has been given', async () => {
        stubSystem();
        render(<SystemWorkers />);

        await screen.findByText('tracking-dispatch');
        const row = screen.getByText('tracking-dispatch').closest('tr') as HTMLElement;
        await userEvent.click(within(row).getByRole('button', { name: /run now/i }));

        expect(screen.getByRole('button', { name: /run it/i })).toBeDisabled();
    });
});

describe('Queues', () => {
    /**
     * The redundancy is the feature: `/system/outbox` is a direct read of the platform
     * collection and `/system/queues` is delegated, so during an incident the delegated half is
     * the one that fails — which is exactly when queue depth is wanted.
     */
    it('keeps the direct read when the delegated one is unavailable', async () => {
        stubSystem((call) =>
            call.url.includes('/system/queues')
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                      category: 'external_service',
                  })
                : undefined,
        );
        render(<SystemQueues />);

        expect(await screen.findByText('Delivered')).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('reads a stuck row as a different fault from a backlog', async () => {
        stubSystem((call) =>
            call.url.includes('/system/queues')
                ? successResponse(
                      queuesFixture({
                          trackingOutbox: { ...queuesFixture().trackingOutbox, stuckPending: 4 },
                      }),
                  )
                : undefined,
        );
        render(<SystemQueues />);

        expect(await screen.findByText(/parking logic did not run/i)).toBeInTheDocument();
    });

    it('says a dead assignment sweep is what a non-zero due count means', async () => {
        stubSystem();
        render(<SystemQueues />);

        expect(await screen.findByText(/sweep is dead, wedged/i)).toBeInTheDocument();
    });
});

describe('Integrations', () => {
    it('runs no probe on load, and names the cost of the ones it offers', async () => {
        const calls = stubSystem();
        render(<SystemIntegrations />);

        await screen.findByText('SMTP');
        const integrationCalls = calls.filter((call) => call.url.includes('/system/integrations'));
        expect(integrationCalls).toHaveLength(1);
        // Not `?probe=`, not an empty value — absent. Opening an operations page must not be a
        // side effect.
        expect(new URL(integrationCalls[0].url, 'http://x').searchParams.has('probe')).toBe(false);
    });

    it('sends only the probes that were ticked', async () => {
        const calls = stubSystem();
        render(<SystemIntegrations />);

        await screen.findByText('SMTP');
        await userEvent.click(screen.getByLabelText('Check smtp'));

        await waitFor(() => {
            const latest = calls[calls.length - 1];
            expect(new URL(latest.url, 'http://x').searchParams.get('probe')).toBe('smtp');
        });
    });

    it('keeps configured and reachable in separate columns', async () => {
        stubSystem();
        render(<SystemIntegrations />);

        expect(await screen.findByRole('columnheader', { name: 'Configured' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Reachable' })).toBeInTheDocument();
        // "Not checked" must not read as "broken" — that is the whole reason the mode travels.
        expect(screen.getAllByText('Not checked').length).toBeGreaterThan(0);
    });

    it('explains why the mobile-money gateways report as unconfigured', async () => {
        stubSystem();
        render(<SystemIntegrations />);

        expect(await screen.findByText(/complete no payment/i)).toBeInTheDocument();
    });
});

describe('Metrics', () => {
    it('states the two coverage gaps that make a zero misleading', async () => {
        stubSystem();
        render(<SystemMetrics />);

        expect(
            await screen.findByText(/four of the thirteen workers are instrumented/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/connection-level errors only/i)).toBeInTheDocument();
    });

    it('renders label sets rather than trying to chart them', async () => {
        stubSystem();
        render(<SystemMetrics />);

        expect(await screen.findByText('jovimall_http_requests_total')).toBeInTheDocument();
        expect(
            screen.getByText(/method="GET" route_group="\/api\/products" status_class="2xx"/),
        ).toBeInTheDocument();
    });
});

describe('Maintenance', () => {
    it('renders the mode in force and hides the stored one while they agree', async () => {
        stubSystem();
        render(<SystemMaintenance />);

        expect(await screen.findByText('In force now')).toBeInTheDocument();
        expect(screen.queryByText('Still stored as')).not.toBeInTheDocument();
    });

    /**
     * They differ exactly when a window has passed its expiry: a read path must never write, so
     * the stored value lingers. Showing only that one would say the platform is in maintenance
     * when it is not.
     */
    it('shows both modes, and why, once the window has expired', async () => {
        stubSystem((call) =>
            call.url.includes('/system/maintenance')
                ? successResponse(
                      maintenanceFixture({ storedMode: 'down', effectiveMode: 'off' }),
                  )
                : undefined,
        );
        render(<SystemMaintenance />);

        expect(await screen.findByText('Still stored as')).toBeInTheDocument();
        expect(screen.getByText(/passed its expiry/i)).toBeInTheDocument();
    });

    it('offers no way to change it without developer_tools.maintenance.set', async () => {
        stubSystem();
        render(<SystemMaintenance />, 2);

        await screen.findByText('In force now');
        expect(
            screen.queryByRole('button', { name: /change maintenance mode/i }),
        ).not.toBeInTheDocument();
    });

    it('names the paths that stay up in every mode', async () => {
        stubSystem();
        render(<SystemMaintenance />);

        expect(await screen.findByText('/api/tracking/*')).toBeInTheDocument();
        expect(screen.getByText(/geo-tracker outage/i)).toBeInTheDocument();
    });

    it('refetches after a write, because the result carries no setBy', async () => {
        const calls = stubSystem((call) =>
            call.method === 'PUT' && call.url.includes('/dev-tools/maintenance')
                ? successResponse(setMaintenanceResultFixture(), {
                      message:
                          'Platform maintenance is now "readonly" (was "off"). Other jovi-mall instances converge within 30s.',
                  })
                : undefined,
        );
        render(<SystemMaintenance />);

        await screen.findByText('In force now');
        await userEvent.click(screen.getByRole('button', { name: /change maintenance mode/i }));
        await userEvent.type(
            screen.getByLabelText(/reason shown to refused callers/i),
            'Index migration',
        );
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Index work');
        await userEvent.click(screen.getByRole('button', { name: /go to readonly/i }));

        // The server's own sentence, plus this screen's restatement of the convergence window.
        expect((await screen.findAllByText(/converge within 30s/i)).length).toBeGreaterThan(0);
        await waitFor(() => {
            const reads = calls.filter(
                (call) => call.method === 'GET' && call.url.includes('/system/maintenance'),
            );
            expect(reads.length).toBeGreaterThanOrEqual(2);
        });
    });
});

/**
 * ── The masking backstop ──────────────────────────────────────────────────────
 *
 * `GET /system/errors` returns `details` **unmasked** by contract, and the tier-1
 * projection adds the stack and the cause chain. That makes this the widest
 * disclosure surface on the dashboard, and the only screen that needs both nets:
 * a credential can arrive named (`authorization`) or buried in a value.
 *
 * Every case here asserts the leaked token is **absent from the document**, not
 * merely that a sentinel is present — a masked value rendered twice, once masked
 * and once not, would pass the weaker assertion.
 */
describe('Error journal — masking', () => {
    function stubErrors(page: ReturnType<typeof systemErrorsPageFixture>) {
        return stubSystem((call) =>
            call.url.includes('/system/errors') ? successResponse(page) : undefined,
        );
    }

    /**
     * Its own render helper: this is the only screen in the file that reads
     * `useAdmin()` — it resolves the operator's timezone to stamp the `since`
     * filter, because the contract refuses date-only values.
     */
    function renderErrors(tier: AdminTier) {
        return renderWithProviders(<SystemErrors />, {
            route: '/dashboard/system/errors',
            permissions: { held: heldFixture(tier) },
            auth: {
                status: 'authenticated',
                admin: adminFixture({ tier, timezone: 'Africa/Douala' }),
            },
        });
    }

    async function openFirstEntry() {
        await userEvent.click(await screen.findByRole('button', { name: /PAYMENT_GATEWAY_TIMEOUT/ }));
    }

    it('masks a bearer token in the details and keeps the scheme', async () => {
        stubErrors(systemErrorsPageFixture({ view: 'admin', entries: [adminErrorFixture()] }));
        renderErrors(2);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        // Twice over: the fixture leaks it in `internalMessage` and again in `details.note`.
        expect(within(dialog).getAllByText(/Bearer \[secret-removed\]/).length).toBe(2);
        expect(dialog).not.toHaveTextContent(LEAKED_TOKEN);
    });

    it('reports the two nets separately, because they are different claims', async () => {
        stubErrors(systemErrorsPageFixture({ view: 'admin', entries: [adminErrorFixture()] }));
        renderErrors(2);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        // The key net: `authorization` gave itself away by name.
        expect(within(dialog).getByText(/credential-shaped name/i)).toBeInTheDocument();
        // The value net: `note` did not, and was caught by shape. Two notices, because
        // `internalMessage` leaked one as well and each field discloses its own.
        expect(within(dialog).getAllByText(/looking credential-shaped/i).length).toBe(2);
    });

    it('masks a token embedded in a stack while leaving the frames readable', async () => {
        stubErrors(
            systemErrorsPageFixture({ view: 'developer', entries: [developerErrorFixture()] }),
        );
        renderErrors(1);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('at StripeClient.charge');
        expect(dialog).not.toHaveTextContent(LEAKED_TOKEN);
    });

    it('never hides silently — a masked value always names what was withheld', async () => {
        stubErrors(
            systemErrorsPageFixture({ view: 'developer', entries: [developerErrorFixture()] }),
        );
        renderErrors(1);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getAllByText(/hidden by this dashboard/i).length).toBeGreaterThan(0);
    });

    it('does not mask the request reference, which is the cross-service join', async () => {
        stubErrors(
            systemErrorsPageFixture({ view: 'developer', entries: [developerErrorFixture()] }),
        );
        renderErrors(1);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d');
    });

    it('does not mask an email — personal data is deliberately not this layer’s job', async () => {
        stubErrors(systemErrorsPageFixture({ view: 'admin', entries: [adminErrorFixture()] }));
        renderErrors(2);
        await openFirstEntry();

        // ADR-015 D-3: redacting PII from free text would destroy the endpoint's reason to exist.
        expect(await screen.findByText(/ops@wimall\.cm/)).toBeInTheDocument();
    });

    it('does not render `raw`, pinning today’s decision so widening it is deliberate', async () => {
        stubErrors(
            systemErrorsPageFixture({ view: 'developer', entries: [developerErrorFixture()] }),
        );
        renderErrors(1);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        expect(dialog).not.toHaveTextContent('raw-sentinel-value');
    });

    /**
     * Driven by the **shape of the row**, not by the reader's tier: `isAdminEntry`
     * tests for `masked`, so a thin row renders thin however privileged the
     * viewer. Asserted at tier 2 because a tier-3 caller must narrow the query
     * before the screen will fetch at all, which is a different rule tested
     * elsewhere.
     */
    it('renders no details or stack block for a row that carried neither', async () => {
        stubErrors(systemErrorsPageFixture({ view: 'support', entries: [supportErrorFixture()] }));
        renderErrors(2);
        await openFirstEntry();

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByText('Details')).not.toBeInTheDocument();
        expect(within(dialog).queryByText('Stack')).not.toBeInTheDocument();
    });
});

describe('Integrations — masking', () => {
    it('masks a credential a probe failure echoed back, leaving the failure readable', async () => {
        stubSystem((call) =>
            call.url.includes('/system/integrations')
                ? successResponse(
                      integrationsFixture({
                          integrations: [
                              {
                                  key: 'smtp',
                                  configured: true,
                                  reachability: {
                                      mode: 'probed',
                                      status: 'error',
                                      error: `535 auth failed for Bearer ${LEAKED_TOKEN}`,
                                  },
                              },
                          ],
                      } as Parameters<typeof integrationsFixture>[0]),
                  )
                : undefined,
        );
        render(<SystemIntegrations />);

        expect(await screen.findByText(/535 auth failed/)).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(LEAKED_TOKEN);
    });
});
