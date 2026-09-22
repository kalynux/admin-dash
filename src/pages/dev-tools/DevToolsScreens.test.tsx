import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CacheInspector } from '@/pages/dev-tools/CacheInspector';
import { CatalogueTools } from '@/pages/dev-tools/CatalogueTools';
import { DatabaseInspector } from '@/pages/dev-tools/DatabaseInspector';
import { DevToolsConfig } from '@/pages/dev-tools/DevToolsConfig';
import { FeatureFlags } from '@/pages/dev-tools/FeatureFlags';
import { OutboxTools } from '@/pages/dev-tools/OutboxTools';
import { PlatformLogs } from '@/pages/dev-tools/PlatformLogs';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    FEATURE_FLAGS_FIXTURE,
    featureFlagFixture,
    flushResultFixture,
    overriddenFlagFixture,
    pruneResultFixture,
    replayResultFixture,
} from '@/test/dev-tools-fixtures';
import {
    cacheKeysFixture,
    databaseReportFixture,
    dependenciesFixture,
    errorHandlerLogLineFixture,
    exposedConfigFixture,
    platformConfigFixture,
    platformLogsFixture,
    queuesFixture,
} from '@/test/system-fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

type Answer = (call: FetchCall) => Response | undefined;

function stubDevTools(...overrides: Answer[]) {
    return stubFetch((call) => {
        for (const answer of overrides) {
            const response = answer(call);
            if (response) return response;
        }
        if (call.url.includes('/dev-tools/feature-flags')) {
            return successResponse({ flags: FEATURE_FLAGS_FIXTURE });
        }
        if (call.url.includes('/system/dependencies')) return successResponse(dependenciesFixture());
        if (call.url.includes('/system/platform/cache/keys')) {
            return successResponse(cacheKeysFixture());
        }
        if (call.url.includes('/system/platform/config')) {
            return successResponse(platformConfigFixture());
        }
        if (call.url.includes('/system/platform/logs')) {
            return successResponse(platformLogsFixture());
        }
        if (call.url.includes('/system/platform/database')) {
            return successResponse(databaseReportFixture());
        }
        if (call.url.includes('/system/config')) {
            return successResponse({ config: exposedConfigFixture() });
        }
        if (call.url.includes('/system/queues')) return successResponse(queuesFixture());
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * With a profile, because Platform logs reads the operator's timezone to print a
 * log line's instant in *their* day — every screen inside the shell has one.
 */
function render(ui: React.ReactElement, tier: AdminTier = 1) {
    return renderWithProviders(ui, {
        route: '/dashboard/dev-tools',
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held: heldFixture(tier) },
    });
}

/** The flag on, for the cases that are not about the gate. */
const flagsOn: Answer = (call) =>
    call.url.includes('/dev-tools/feature-flags') && call.method === 'GET'
        ? successResponse({
              flags: [overriddenFlagFixture({ name: 'dev_tools.enabled', enabled: true })],
          })
        : undefined;

describe('Feature flags', () => {
    it('renders the five fields the docs omit, not just the five they publish', async () => {
        stubDevTools((call) =>
            call.url.includes('/dev-tools/feature-flags')
                ? successResponse({ flags: [overriddenFlagFixture()] })
                : undefined,
        );
        render(<FeatureFlags />);

        expect(await screen.findByText('overridden')).toBeInTheDocument();
        // reason, updatedByEmail and updatedAt all come from the undocumented half.
        expect(screen.getByText(/after the 13\/08 outage/)).toBeInTheDocument();
        expect(screen.getByText(/dev@wimall\.cm/)).toBeInTheDocument();
    });

    /**
     * `isDefault` is not derivable from `enabled === default`: a flag deliberately set to the
     * value the catalog already had is *overridden*, and somebody's reason is recorded against it.
     */
    it('tells a flag tracking its default from one somebody set to the same value', async () => {
        stubDevTools((call) =>
            call.url.includes('/dev-tools/feature-flags')
                ? successResponse({
                      flags: [
                          featureFlagFixture({ name: 'audit.route_probe', enabled: true, default: true }),
                          overriddenFlagFixture({
                              name: 'audit.legacy_feed',
                              enabled: true,
                              default: true,
                          }),
                      ],
                  })
                : undefined,
        );
        render(<FeatureFlags />);

        expect(await screen.findByText('tracking the default')).toBeInTheDocument();
        expect(screen.getByText('overridden')).toBeInTheDocument();
    });

    it('marks the master switch and says what it gates', async () => {
        stubDevTools();
        render(<FeatureFlags />);

        expect(await screen.findByText(/this is the master switch/i)).toBeInTheDocument();
    });

    it('shows the server’s fleet-convergence sentence verbatim after a write', async () => {
        const message =
            '"dev_tools.enabled" is now on on this instance. Other instances converge within the flag cache TTL.';
        stubDevTools((call) =>
            call.method === 'PUT'
                ? successResponse(overriddenFlagFixture({ enabled: true }), { message })
                : undefined,
        );
        render(<FeatureFlags />);

        await screen.findByText('dev_tools.enabled');
        const row = screen.getByText('dev_tools.enabled').closest('li') as HTMLElement;
        await userEvent.click(within(row).getByRole('button', { name: /turn on/i }));
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Replay work');
        await userEvent.click(screen.getByRole('button', { name: /turn it on/i }));

        // The change is not instant across the fleet, and only the server's own sentence says so.
        expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it('offers no toggle without developer_tools.feature_flags.set', async () => {
        stubDevTools();
        render(<FeatureFlags />, 2);

        await screen.findByText('dev_tools.enabled');
        expect(screen.queryByRole('button', { name: /turn (on|off)/i })).not.toBeInTheDocument();
    });
});

describe('Configuration', () => {
    /**
     * The two endpoints are shaped differently — wi-admin's is `[{key, value}]` and the
     * platform's is `{entries: [{key, value, set}], wiring}`. Only the platform's carries `set`.
     */
    it('renders both services, and only the platform’s reports what is unset', async () => {
        stubDevTools();
        render(<DevToolsConfig />);

        // Both panels carry NODE_ENV — that is the comparison the screen exists for.
        expect((await screen.findAllByText('NODE_ENV')).length).toBe(2);
        expect(screen.getByText('EARNINGS_CRON')).toBeInTheDocument();
        // Only the platform's entries carry `set`, so only that panel can report "not set".
        expect(screen.getByText('not set')).toBeInTheDocument();
        expect(screen.getByText(/says what is in force/i)).toBeInTheDocument();
    });

    it('splits the comma-joined origins for display without treating them as an array', async () => {
        stubDevTools();
        render(<DevToolsConfig />);

        // Documented as an array; the service `String()`s anything non-scalar so the wire shape
        // stays flat. Typing it as an array would put `.map` on a string.
        await screen.findByText('ADMIN_DASHBOARD_ORIGINS');
        expect(screen.getByText('https://admin.wimall.cm')).toBeInTheDocument();
        expect(screen.getByText('https://ops.wimall.cm')).toBeInTheDocument();
    });

    it('renders the derived wiring block instead of any URL', async () => {
        stubDevTools();
        render(<DevToolsConfig />);

        expect(await screen.findByText('geoTrackerConfigured')).toBeInTheDocument();
        expect(screen.getAllByText(/no url or uri is exposed/i).length).toBeGreaterThan(0);
    });
});

describe('Platform logs', () => {
    it('warns that log lines can carry personal data', async () => {
        stubDevTools();
        render(<PlatformLogs />);

        expect(await screen.findByText(/free text and can contain personal data/i)).toBeInTheDocument();
    });

    it('says which store actually answered, not which was asked for', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(
                      platformLogsFixture({
                          sourceUsed: 'ring',
                          sourceReason: 'the durable collection is not available',
                      }),
                  )
                : undefined,
        );
        render(<PlatformLogs />);

        expect(await screen.findByText(/in-memory buffer/i)).toBeInTheDocument();
        expect(screen.getByText(/durable collection is not available/i)).toBeInTheDocument();
    });

    it('labels the level filter as at-or-above rather than equal-to', async () => {
        stubDevTools();
        render(<PlatformLogs />);

        await screen.findByText(/free text/i);
        await userEvent.click(screen.getByRole('combobox', { name: 'Level' }));
        expect(await screen.findByRole('option', { name: 'warn and above' })).toBeInTheDocument();
    });

    it('offers more only while the cursor says there is more', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(platformLogsFixture({ nextBefore: null }))
                : undefined,
        );
        render(<PlatformLogs />);

        await screen.findByText(/payment gateway did not respond/i);
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    /**
     * 🔴 **The reported bug.** On an error line jovi-mall's `msg` is only
     * `"internal 500 INTERNAL_SERVER_ERROR"`; what failed is in
     * `httpError.internalMessage`. The row rendered `msg` alone, so an operator
     * could see that something broke and never what.
     */
    it('shows what the code threw under the bare code line', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(platformLogsFixture({ entries: [errorHandlerLogLineFixture()] }))
                : undefined,
        );
        render(<PlatformLogs />);

        expect(await screen.findByText('internal 500 INTERNAL_SERVER_ERROR')).toBeInTheDocument();
        expect(
            screen.getByText(/Cannot read properties of undefined \(reading 'preferred_language'\)/),
        ).toBeInTheDocument();
    });

    it('opens the whole entry on a click', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(platformLogsFixture({ entries: [errorHandlerLogLineFixture()] }))
                : undefined,
        );
        render(<PlatformLogs />);

        await userEvent.click(await screen.findByRole('button', { name: /show full entry/i }));
        const dialog = await screen.findByRole('dialog');

        expect(within(dialog).getByText('What the code threw')).toBeInTheDocument();
        expect(within(dialog).getByText(/connect ECONNREFUSED 127\.0\.0\.1:6379/)).toBeInTheDocument();
        expect(within(dialog).getByText(/phone-verification\.service\.ts:136:41/)).toBeInTheDocument();
        expect(
            within(dialog).getByText(/POST \/api\/internal\/admin\/phone-verification\/request/),
        ).toBeInTheDocument();
        // A masked category: the caller's substituted sentence is shown AS that.
        expect(within(dialog).getByText('Something went wrong on our side')).toBeInTheDocument();
        expect(within(dialog).getByText(/"attempt": 2/)).toBeInTheDocument();
        expect(within(dialog).getByText('5d2c9a41-7e0b-4f3a-9b6c-1a2b3c4d5e6f')).toBeInTheDocument();
    });

    /** *"Anything else — the writer's context. Render it raw."* Not dropped. */
    it('renders the keys it does not know rather than dropping them', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(
                      platformLogsFixture({
                          entries: [
                              {
                                  at: '2026-09-21T10:02:11.004Z',
                                  level: 'warn',
                                  msg: 'payout sweep slow',
                                  worker: 'auto-threshold-sweep',
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<PlatformLogs />);

        await userEvent.click(await screen.findByRole('button', { name: /show full entry/i }));
        const dialog = await screen.findByRole('dialog');

        expect(within(dialog).getByText('Other fields')).toBeInTheDocument();
        expect(within(dialog).getByText(/auto-threshold-sweep/)).toBeInTheDocument();
    });

    /**
     * `system.md` claims *"nothing is truncated server-side"*; `parseLogLine`
     * cuts a stack at `LOG_MAX_STACK_BYTES` and marks it `…`. Saying so stops a
     * reader hunting for the rest of a stack that was never stored.
     */
    it('says when jovi-mall cut the stack as it wrote the line', async () => {
        const line = errorHandlerLogLineFixture();
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(
                      platformLogsFixture({
                          entries: [
                              {
                                  ...line,
                                  err: {
                                      type: 'TypeError',
                                      message: 'boom',
                                      stack: 'TypeError: boom\n    at frame (server.ts:2…',
                                  },
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<PlatformLogs />);

        await userEvent.click(await screen.findByRole('button', { name: /show full entry/i }));
        const dialog = await screen.findByRole('dialog');

        expect(within(dialog).getByText(/the rest was never stored/i)).toBeInTheDocument();
    });
});

describe('Database inspector', () => {
    it('leads with the missing indexes, which are the actionable bucket', async () => {
        stubDevTools();
        render(<DatabaseInspector />);

        expect(await screen.findByText(/Missing \(1\)/)).toBeInTheDocument();
        expect(screen.getByText(/declared but not built/i)).toBeInTheDocument();
    });

    it('says plainly that it never repairs', async () => {
        stubDevTools();
        render(<DatabaseInspector />);

        expect(await screen.findByText(/reports; it never repairs/i)).toBeInTheDocument();
    });

    /** Silent truncation reads as completeness, which is the worst failure this read can have. */
    it('surfaces an unfinished sweep rather than letting it read as a clean bill', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/database')
                ? successResponse(
                      databaseReportFixture({ truncated: true, notReached: ['orders', 'products'] }),
                  )
                : undefined,
        );
        render(<DatabaseInspector />);

        expect(await screen.findByText(/this sweep did not finish/i)).toBeInTheDocument();
        expect(screen.getByText(/orders, products/)).toBeInTheDocument();
    });
});

describe('Cache inspector', () => {
    /**
     * The three doc sources disagree on which logical databases exist, so a client constant would
     * have been wrong on the day it was written.
     */
    it('populates the database list from the platform’s live registry', async () => {
        stubDevTools();
        render(<CacheInspector />);

        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));

        expect(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'EMAIL_VERIFY_DB' })).toBeInTheDocument();
    });

    it('lists key names and TTLs, and never a value', async () => {
        stubDevTools();
        render(<CacheInspector />);

        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' }));

        expect(await screen.findByText('slot:665f1a2b:2026-08-16')).toBeInTheDocument();
        expect(screen.getByText(/values are never returned/i)).toBeInTheDocument();
    });

    it('reads the destructive verdict and blast radius off the response', async () => {
        stubDevTools();
        render(<CacheInspector />);

        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' }));

        // The server is the authority on which databases refuse a whole flush, not a client table.
        expect(await screen.findByText('Destructive database')).toBeInTheDocument();
        expect(screen.getAllByText(/drops live booking holds/i).length).toBeGreaterThan(0);
    });

    it('sends no typed confirmation on the read, deliberately', async () => {
        const calls = stubDevTools();
        render(<CacheInspector />);

        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' }));

        await waitFor(() => {
            const read = calls.find((call) => call.url.includes('/cache/keys'));
            expect(read).toBeTruthy();
            expect(new URL(read!.url, 'http://x').searchParams.has('confirm')).toBe(false);
        });
    });

    it('hides the flush entirely without developer_tools.cache.flush', async () => {
        stubDevTools();
        render(<CacheInspector />, 2);

        await screen.findByRole('combobox', { name: /database/i });
        expect(screen.queryByRole('button', { name: /^flush$/i })).not.toBeInTheDocument();
    });

    /**
     * The flush is the most dangerous verb on this surface: it deletes live keys, and on this
     * database those are booking holds. So the whole ceremony is pinned end to end.
     */
    it('runs the flush only after a dry run, a reason and the database name', async () => {
        const calls = stubDevTools(flagsOn, (call) =>
            call.url.includes('/cache/flush')
                ? successResponse(
                      flushResultFixture(
                          JSON.parse(call.body ?? '{}').dryRun === false
                              ? { dryRun: false, deleted: 8412 }
                              : {},
                      ),
                      {
                          message:
                              JSON.parse(call.body ?? '{}').dryRun === false
                                  ? '8412 key(s) deleted from SLOT_LOCK_DB'
                                  : 'DRY RUN — 8412 key(s) matched in SLOT_LOCK_DB; nothing was deleted',
                      },
                  )
                : undefined,
        );
        render(<CacheInspector />);

        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' }));
        await userEvent.click(await screen.findByRole('button', { name: /^flush$/i }));
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Clearing it');

        // Reason given, nothing checked yet: still refused.
        expect(screen.getByRole('button', { name: /delete the keys/i })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: /dry run/i }));
        await screen.findByText(/nothing was deleted/i);

        // Dry run seen, but the database name has not been typed: still refused.
        expect(screen.getByRole('button', { name: /delete the keys/i })).toBeDisabled();

        await userEvent.type(
            screen.getByLabelText(/type SLOT_LOCK_DB to confirm/i),
            'SLOT_LOCK_DB',
        );
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /delete the keys/i })).toBeEnabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /delete the keys/i }));

        expect(await screen.findByText(/8412 key\(s\) deleted/i)).toBeInTheDocument();

        // The name goes out; the numeric index comes back. Same key, two types.
        const live = calls.filter(
            (call) => call.url.includes('/cache/flush') && JSON.parse(call.body ?? '{}').dryRun === false,
        );
        expect(live).toHaveLength(1);
        expect(JSON.parse(live[0].body ?? '{}')).toMatchObject({
            db: 'SLOT_LOCK_DB',
            confirm: 'SLOT_LOCK_DB',
            dryRun: false,
        });
    });
});

describe('the dry-run gate', () => {
    async function openPrune() {
        await screen.findByText(/prune delivered rows/i);
        await userEvent.click(screen.getByRole('button', { name: /^prune$/i }));
        // Over the ten-character floor on purpose: if the reason were short, every assertion
        // below would pass on *that* rather than on the dry-run gate they exist to pin.
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Shrinking it');
    }

    it('keeps the live run disabled until a dry run has been seen', async () => {
        stubDevTools(flagsOn);
        render(<OutboxTools />);

        await openPrune();
        await userEvent.type(screen.getByLabelText(/type 30 to confirm/i), '30');

        // Reason given and confirmation typed — and it is still refused, because nothing has
        // reported what would actually go.
        expect(screen.getByRole('button', { name: /delete them/i })).toBeDisabled();
        expect(screen.getByText(/nothing has been checked yet/i)).toBeInTheDocument();
    });

    it('arms after a dry run, and re-arms the moment the payload changes', async () => {
        stubDevTools(flagsOn, (call) =>
            call.url.includes('/outbox/prune')
                ? successResponse(pruneResultFixture(), {
                      message: 'DRY RUN — 412088 delivered row(s) older than 30 days matched',
                  })
                : undefined,
        );
        render(<OutboxTools />);

        await openPrune();
        await userEvent.type(screen.getByLabelText(/type 30 to confirm/i), '30');
        await userEvent.click(screen.getByRole('button', { name: /dry run/i }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /delete them/i })).toBeEnabled(),
        );

        // Editing the age spends the evidence: a dry run for 30 days says nothing about 7.
        await userEvent.clear(screen.getByLabelText(/delete delivered rows older than/i));
        await userEvent.type(screen.getByLabelText(/delete delivered rows older than/i), '7');

        expect(screen.getByRole('button', { name: /delete them/i })).toBeDisabled();
        expect(screen.getByText(/settings changed since the last check/i)).toBeInTheDocument();
    });

    it('requires the typed confirmation to equal the age, not a magic word', async () => {
        stubDevTools(flagsOn, (call) =>
            call.url.includes('/outbox/prune')
                ? successResponse(pruneResultFixture(), { message: 'DRY RUN — matched' })
                : undefined,
        );
        render(<OutboxTools />);

        await openPrune();
        await userEvent.click(screen.getByRole('button', { name: /dry run/i }));
        await userEvent.type(screen.getByLabelText(/type 30 to confirm/i), 'delete');

        expect(screen.getByRole('button', { name: /delete them/i })).toBeDisabled();
    });

    it('offers no way to prune anything but delivered rows', async () => {
        stubDevTools(flagsOn);
        render(<OutboxTools />);

        await screen.findByText(/prune delivered rows/i);
        // `status` is a literal in the service, so there is deliberately no control for it —
        // pruning failed rows would destroy the input to a replay.
        expect(screen.queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument();
        expect(screen.getByText(/only delivered rows can go/i)).toBeInTheDocument();
    });
});

describe('replay', () => {
    it('uses the eligible-row count as its pre-flight, since it has no dry run', async () => {
        stubDevTools(flagsOn);
        render(<OutboxTools />);

        await screen.findByText(/replay failed events/i);
        await userEvent.click(screen.getByRole('button', { name: /^replay$/i }));

        expect(screen.getByText(/1 row\(s\) are eligible right now/i)).toBeInTheDocument();
        expect(screen.getByText(/no dry run, so the queue depth is the check/i)).toBeInTheDocument();
    });

    it('warns that downstream services will see the events twice', async () => {
        stubDevTools(flagsOn);
        render(<OutboxTools />);

        expect(await screen.findByText(/see these events a second time/i)).toBeInTheDocument();
    });

    it('replays once the ceremony is complete', async () => {
        const calls = stubDevTools(flagsOn, (call) =>
            call.url.includes('/outbox/replay')
                ? successResponse(replayResultFixture(), {
                      message: '4 outbox row(s) queued for redelivery',
                  })
                : undefined,
        );
        render(<OutboxTools />);

        await screen.findByText(/replay failed events/i);
        await userEvent.click(screen.getByRole('button', { name: /^replay$/i }));
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Outage fix');
        await userEvent.click(screen.getByRole('button', { name: /replay them/i }));

        expect(await screen.findByText(/4 outbox row\(s\) queued/i)).toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/outbox/replay'))).toBe(true);
    });
});

describe('the dev_tools.enabled gate', () => {
    it('warns before a gated tool is attempted', async () => {
        stubDevTools();
        render(<OutboxTools />);

        expect(await screen.findByText(/developer tools are switched off/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /go to feature flags/i })).toBeInTheDocument();
    });

    /**
     * `409 DEV_TOOLS_DISABLED`, not `403`. A 403 would send an administrator to inspect their own
     * grants, which is the wrong place — they hold the permission and the service is refusing.
     */
    it('renders a refusal as a service state rather than a permission problem', async () => {
        stubDevTools(flagsOn, (call) =>
            call.url.includes('/catalogue/vectorise')
                ? errorResponse(409, 'DEV_TOOLS_DISABLED', {
                      message: 'Developer tools are switched off',
                      category: 'business_rule',
                  })
                : undefined,
        );
        render(<CatalogueTools />);

        await screen.findByText(/rebuild search vectors/i);
        await userEvent.click(screen.getByRole('button', { name: /rebuild now/i }));
        await userEvent.type(screen.getByLabelText(/why are you doing this/i), 'Search fix');
        await userEvent.click(screen.getByRole('button', { name: /rebuild the catalogue/i }));

        expect(await screen.findByText(/did not run/i)).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: /go to feature flags/i }).length).toBeGreaterThan(
            0,
        );
    });
});

describe('Catalogue', () => {
    it('admits it has nothing to check first rather than inventing a pre-flight', async () => {
        stubDevTools(flagsOn);
        render(<CatalogueTools />);

        await userEvent.click(await screen.findByRole('button', { name: /rebuild now/i }));

        // Said on the card and again in the dialog — there is genuinely nothing to check.
        expect(screen.getAllByText(/nothing to check first/i).length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /dry run/i })).not.toBeInTheDocument();
    });

    it('says the request is synchronous and long', async () => {
        stubDevTools(flagsOn);
        render(<CatalogueTools />);

        expect(await screen.findByText(/runs synchronously and can take minutes/i)).toBeInTheDocument();
    });
});

/**
 * ── The masking backstop ──────────────────────────────────────────────────────
 *
 * These three screens render whatever the far side sent: a config value, a log
 * line, a cache key name. The platform scrubs its own output first, but ADR-015
 * D-1 calls that scrubber "a net, not a boundary" — so this is the second net,
 * and each case here pairs a "hides the secret" assertion with a "does not
 * mangle ordinary output" one. The second half is what keeps the layer trusted.
 */
describe('Configuration — masking', () => {
    it('withholds a value whose key is credential-shaped, and calls it a defect', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/config')
                ? successResponse(
                      platformConfigFixture({
                          entries: [
                              { key: 'SMTP_PASSWORD', value: 'hunter22ok', set: true },
                              { key: 'NODE_ENV', value: 'production', set: true },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<DevToolsConfig />);

        await screen.findByText('SMTP_PASSWORD');
        expect(document.body).not.toHaveTextContent('hunter22ok');
        // Both services assert a config allowlist at boot, so reaching this is a finding.
        expect(await screen.findByText(/worth reporting/i)).toBeInTheDocument();
    });

    it('masks a connection string but keeps the host, which is the diagnosis', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/config')
                ? successResponse(
                      platformConfigFixture({
                          entries: [
                              {
                                  key: 'PRIMARY_STORE',
                                  value: 'mongodb://svc:p4ssw0rd@cluster0.example.net/jovi_mall',
                                  set: true,
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<DevToolsConfig />);

        expect(await screen.findByText(/cluster0\.example\.net\/jovi_mall/)).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('p4ssw0rd');
    });

    it('leaves the wiring block and "not set" exactly as they are', async () => {
        stubDevTools();
        render(<DevToolsConfig />);

        // `stripeKeyMode: test` is the whole point of the derived wiring block, and
        // `not set` is the answer the screen exists to give — ADR-015 D-4.
        expect(await screen.findByText('test')).toBeInTheDocument();
        expect(screen.getByText('not set')).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('[secret-removed]');
    });
});

describe('Platform logs — masking', () => {
    it('masks a credential in a log line and says so once for the page', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(
                      platformLogsFixture({
                          entries: [
                              {
                                  at: '2026-08-16T09:14:02.331Z',
                                  level: 'error',
                                  msg: 'retry failed with Bearer dXNlcjpwYXNzd29yZDEyMw== for ops@wimall.cm',
                                  requestId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<PlatformLogs />);

        expect(await screen.findByText(/Bearer \[secret-removed\]/)).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('dXNlcjpwYXNzd29yZDEyMw==');
        expect(screen.getByText(/1 line on this page had a credential-shaped value/i)).toBeInTheDocument();
    });

    it('leaves the personal data alone, deliberately, and the reference too', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(
                      platformLogsFixture({
                          entries: [
                              {
                                  at: '2026-08-16T09:14:02.331Z',
                                  level: 'warn',
                                  msg: 'SMTP send failed for ops@wimall.cm (+237650000000)',
                                  requestId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<PlatformLogs />);

        // ADR-015 D-3: this is why the endpoint exists. Masking it would be the bug.
        expect(await screen.findByText(/ops@wimall\.cm/)).toBeInTheDocument();
        expect(screen.getByText(/8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d/)).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('[secret-removed]');
    });

    /**
     * ⚠ The full entry is where the unscrubbed free text lives — a stack, a
     * cause, a driver message — so it gets the same nets as the row, and the
     * row's own preview of the thrown message counts toward the banner.
     */
    it('masks a credential in the preview and in every field of the full entry', async () => {
        const token = 'dXNlcjpwYXNzd29yZDEyMw==';
        const line = errorHandlerLogLineFixture();
        stubDevTools((call) =>
            call.url.includes('/system/platform/logs')
                ? successResponse(
                      platformLogsFixture({
                          entries: [
                              {
                                  ...line,
                                  httpError: {
                                      ...(line.httpError as Record<string, unknown>),
                                      internalMessage: `gateway refused Bearer ${token}`,
                                      causeMessage: `retrying with Bearer ${token}`,
                                  },
                                  err: {
                                      type: 'Error',
                                      message: 'gateway refused',
                                      stack: `Error: gateway refused\n    headers: Bearer ${token}`,
                                  },
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<PlatformLogs />);

        expect(await screen.findByText(/gateway refused Bearer \[secret-removed\]/)).toBeInTheDocument();
        expect(screen.getByText(/1 line on this page had a credential-shaped value/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /show full entry/i }));
        await screen.findByRole('dialog');

        expect(document.body).not.toHaveTextContent(token);
    });
});

describe('Cache inspector — masking', () => {
    it('masks the value half of a key name and keeps the namespace', async () => {
        stubDevTools((call) =>
            call.url.includes('/system/platform/cache/keys')
                ? successResponse(
                      cacheKeysFixture({
                          constant: 'DOWNLOAD_TOKEN_DB',
                          keys: [
                              {
                                  key: 'download:token:9f2b1ce4aa7d',
                                  type: 'string',
                                  ttlMs: 540_000,
                                  sizeBytes: null,
                              },
                          ],
                      }),
                  )
                : undefined,
        );
        render(<CacheInspector />);
        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' }));

        // The namespace survives, so the key is still identifiable and countable.
        expect(await screen.findByText('download:token:[secret-removed]')).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('9f2b1ce4aa7d');
    });

    it('leaves an ordinary slot-lock key completely unmangled', async () => {
        stubDevTools();
        render(<CacheInspector />);
        await userEvent.click(await screen.findByRole('combobox', { name: /database/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'SLOT_LOCK_DB' }));

        expect(await screen.findByText('slot:665f1a2b:2026-08-16')).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('[secret-removed]');
    });
});
