import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PaymentRouting } from '@/pages/dev-tools/PaymentRouting';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { PaymentRouting as PaymentRoutingData } from '@/types/payment-routing.types';

function routingFixture(overrides: Partial<PaymentRoutingData> = {}): PaymentRoutingData {
    return {
        platformSupported: true,
        settings: {
            collectionAggregator: 'NOTCHPAY',
            payoutAggregator: 'NOTCHPAY',
            stripeEnabled: false,
            providers: {
                MTN: { enabled: true },
                ORANGE: { enabled: true },
                MOOV: { enabled: false },
                CARD: { enabled: false },
            },
            version: 3,
            updatedAt: '2026-09-30T10:00:00.000Z',
            updatedBy: { id: '66a0aabbccddeeff00112233', name: 'Jane Doe' },
            reason: 'Back to NotchPay after the outage',
        },
        aggregators: [
            {
                name: 'NOTCHPAY',
                configured: true,
                capabilities: {
                    collect: {
                        MTN: { flow: 'PUSH', requires: ['phoneNumber'] },
                        ORANGE: { flow: 'PUSH', requires: ['phoneNumber'] },
                    },
                    settlesAsync: true,
                },
                payoutImplemented: true,
                payoutAvailable: true,
                refundAvailable: true,
                activeForCollections: true,
                activeForPayouts: true,
            },
            {
                name: 'MYCOOLPAY',
                configured: true,
                capabilities: {
                    collect: {
                        MTN: { flow: 'PUSH', requires: ['phoneNumber'] },
                        ORANGE: { flow: 'OTP', requires: ['phoneNumber'] },
                    },
                    settlesAsync: true,
                },
                payoutImplemented: false,
                payoutAvailable: false,
                refundAvailable: true,
                activeForCollections: false,
                activeForPayouts: false,
            },
            {
                // An aggregator this build has never heard of — it must simply appear.
                name: 'CAMPAY',
                configured: false,
                capabilities: { collect: {}, settlesAsync: true },
                payoutImplemented: false,
                payoutAvailable: false,
                refundAvailable: false,
                activeForCollections: false,
                activeForPayouts: false,
            },
            {
                name: 'STRIPE',
                configured: true,
                capabilities: { collect: { CARD: { flow: 'CARD_ELEMENT', requires: [] } }, settlesAsync: false },
                payoutImplemented: false,
                payoutAvailable: false,
                refundAvailable: true,
                activeForCollections: false,
                activeForPayouts: false,
            },
        ],
        effectiveProviders: [
            { provider: 'MTN', aggregator: 'NOTCHPAY', capability: { flow: 'PUSH', requires: ['phoneNumber'] } },
            { provider: 'ORANGE', aggregator: 'NOTCHPAY', capability: { flow: 'PUSH', requires: ['phoneNumber'] } },
        ],
        errors: [],
        warnings: [],
        stats: {
            window: '24h',
            since: '2026-09-29T12:00:00.000Z',
            stuckPendingAfterMinutes: 30,
            gateways: [
                {
                    gateway: 'NOTCHPAY',
                    total: 412,
                    succeeded: 371,
                    failed: 22,
                    pending: 19,
                    stuckPending: 4,
                    successRate: 0.944,
                    lastSuccessAt: '2026-09-30T11:58:12.000Z',
                    sources: [
                        {
                            source: 'payments',
                            total: 380,
                            succeeded: 344,
                            failed: 20,
                            pending: 16,
                            stuckPending: 3,
                            settleP50Seconds: 41,
                            settleP90Seconds: 118,
                            lastSuccessAt: '2026-09-30T11:58:12.000Z',
                        },
                    ],
                },
                {
                    gateway: 'MYCOOLPAY',
                    total: 3,
                    succeeded: 0,
                    failed: 0,
                    pending: 3,
                    stuckPending: 0,
                    successRate: null,
                    lastSuccessAt: null,
                    sources: [],
                },
            ],
        },
        ...overrides,
    };
}

function writeResult(changed: string[] = ['collectionAggregator']) {
    const before = routingFixture().settings!;
    return {
        previous: before,
        settings: { ...before, collectionAggregator: 'MYCOOLPAY', version: 4 },
        changed,
        warnings: [
            {
                code: 'PAYOUT_UNAVAILABLE',
                message: 'NOTCHPAY cannot send payouts right now',
                aggregator: 'NOTCHPAY',
            },
        ],
        convergenceSeconds: 5,
    };
}

type Answer = (call: FetchCall) => Response | undefined;

function stub(...overrides: Answer[]) {
    return stubFetch((call) => {
        for (const answer of overrides) {
            const response = answer(call);
            if (response) return response;
        }
        if (call.url.includes('/dev-tools/payments') && call.method === 'GET') {
            return successResponse(routingFixture());
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function render(tier: 1 | 2 | 3 = 1, held = heldFixture(tier)) {
    return renderWithProviders(<PaymentRouting />, {
        route: '/dashboard/dev-tools/payments',
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held },
    });
}

const REASON = 'NotchPay refusing pushes since 14:02';

async function openSaveDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /review and save/i }));
    return screen.findByRole('dialog');
}

async function chooseCollection(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByLabelText('Collection aggregator'));
    await user.click(await screen.findByRole('option', { name }));
}

describe('Payments (developer tools)', () => {
    it('shows the settings, what customers see, every aggregator and the outcomes', async () => {
        const calls = stub();
        render();

        expect(await screen.findByText(/what customers can pay with right now/i)).toBeInTheDocument();
        expect(screen.getByText(/Back to NotchPay after the outage/)).toBeInTheDocument();
        expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();

        // An aggregator this build does not know is listed like any other.
        expect(screen.getByRole('listitem', { name: 'CAMPAY' })).toBeInTheDocument();

        const notchpay = screen.getByRole('listitem', { name: 'NOTCHPAY outcomes' });
        expect(within(notchpay).getByText('94.4%')).toBeInTheDocument();
        // `successRate: null` is "nothing decided", never 0%; `lastSuccessAt: null` is not "never".
        const mycoolpay = screen.getByRole('listitem', { name: 'MYCOOLPAY outcomes' });
        expect(within(mycoolpay).getByText(/nothing decided in this window/i)).toBeInTheDocument();
        expect(within(mycoolpay).getByText(/none in this window/i)).toBeInTheDocument();
        expect(within(mycoolpay).queryByText('0.0%')).not.toBeInTheDocument();

        expect(calls[0].url).toContain('/dev-tools/payments?window=24h');
    });

    /**
     * The switch is exempt from `dev_tools.enabled`, like maintenance — so the screen must not
     * even ask about the flag, let alone hide behind it.
     */
    it('never reads the dev-tools flag', async () => {
        const calls = stub();
        render();
        await screen.findByText(/what customers can pay with right now/i);
        expect(calls.some((call) => call.url.includes('feature-flags'))).toBe(false);
        expect(screen.queryByText(/developer tools are switched off/i)).not.toBeInTheDocument();
    });

    it('reads the chosen window', async () => {
        const user = userEvent.setup();
        const calls = stub();
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByRole('combobox', { name: /outcome window/i }));
        await user.click(await screen.findByRole('option', { name: /last 7 days/i }));

        await waitFor(() =>
            expect(calls.some((call) => call.url.includes('window=7d'))).toBe(true),
        );
    });

    it('puts standing errors in a red "payments are broken" banner, unknown codes by message', async () => {
        stub((call) =>
            call.method === 'GET'
                ? successResponse(
                      routingFixture({
                          errors: [
                              {
                                  code: 'COLLECTION_AGGREGATOR_NOT_CONFIGURED',
                                  message: 'NOTCHPAY has no credentials on this deployment',
                                  aggregator: 'NOTCHPAY',
                              },
                              { code: 'A_RULE_FROM_THE_FUTURE', message: 'Something only next year knows' },
                          ],
                          warnings: [],
                      }),
                  )
                : undefined,
        );
        render();

        const banner = await screen.findByRole('alert');
        expect(within(banner).getByText('Payments are broken')).toBeInTheDocument();
        expect(within(banner).getByText('Something only next year knows')).toBeInTheDocument();
        expect(within(banner).getByText(/fix it at: collection aggregator/i)).toBeInTheDocument();
        // An empty warnings list under a red banner means "not checked", and says so.
        expect(within(banner).getByText(/softer problems are not checked/i)).toBeInTheDocument();
    });

    it('puts standing warnings in a yellow note', async () => {
        stub((call) =>
            call.method === 'GET'
                ? successResponse(
                      routingFixture({
                          warnings: [
                              { code: 'PROVIDER_UNROUTABLE', message: 'MOOV is on but nothing carries it', provider: 'MOOV' },
                          ],
                      }),
                  )
                : undefined,
        );
        render();

        const note = await screen.findByRole('status');
        expect(within(note).getByText(/payments work, but check these/i)).toBeInTheDocument();
        expect(screen.queryByText('Payments are broken')).not.toBeInTheDocument();
    });

    it('says "deploy jovi-mall first" rather than showing an empty configuration', async () => {
        stub((call) =>
            call.method === 'GET'
                ? successResponse(
                      routingFixture({
                          platformSupported: false,
                          settings: null,
                          aggregators: [],
                          effectiveProviders: null,
                      }),
                  )
                : undefined,
        );
        render();

        expect(await screen.findByText(/deploy jovi-mall first/i)).toBeInTheDocument();
        expect(screen.queryByLabelText('Collection aggregator')).not.toBeInTheDocument();
        // The stats are still real.
        expect(screen.getByText('94.4%')).toBeInTheDocument();
    });

    it('offers only configured aggregators as switch targets', async () => {
        const user = userEvent.setup();
        stub();
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByLabelText('Collection aggregator'));
        expect(await screen.findByRole('option', { name: /CAMPAY \(not configured\)/ })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        expect(screen.getByRole('option', { name: /STRIPE \(has its own switch\)/ })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        expect(screen.getByRole('option', { name: 'MYCOOLPAY' })).not.toHaveAttribute(
            'aria-disabled',
            'true',
        );
    });

    it('switches the aggregator with only the changed field, the loaded version and a reason', async () => {
        const user = userEvent.setup();
        const calls = stub((call) =>
            call.method === 'PUT'
                ? successResponse(writeResult(), {
                      message: 'Payment routing updated (collectionAggregator).',
                  })
                : undefined,
        );
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await chooseCollection(user, 'MYCOOLPAY');
        const dialog = await openSaveDialog(user);

        // It says only NEW payments move.
        expect(within(dialog).getByText(/only new payments move/i)).toBeInTheDocument();

        const save = within(dialog).getByRole('button', { name: /save routing/i });
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), REASON);
        // An aggregator switch also needs the new name typed.
        expect(save).toBeDisabled();
        await user.type(within(dialog).getByLabelText(/type MYCOOLPAY to confirm/i), 'MYCOOLPAY');
        await user.click(save);

        expect(await within(dialog).findByText(/takes effect within 5s/i)).toBeInTheDocument();
        expect(within(dialog).getByText('collectionAggregator')).toBeInTheDocument();
        expect(within(dialog).getByText('NOTCHPAY cannot send payouts right now')).toBeInTheDocument();

        const put = calls.find((call) => call.method === 'PUT')!;
        expect(JSON.parse(put.body!)).toEqual({
            collectionAggregator: 'MYCOOLPAY',
            expectedVersion: 3,
            reason: REASON,
        });
        // …and it reloads.
        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(1),
        );
    });

    it('refuses to send without a reason of at least ten characters', async () => {
        const user = userEvent.setup();
        stub();
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByLabelText('MOOV'));
        const dialog = await openSaveDialog(user);
        const save = within(dialog).getByRole('button', { name: /save routing/i });
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), 'too short');
        expect(save).toBeDisabled();
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), '!');
        expect(save).toBeEnabled();
    });

    it('asks for a louder confirmation before switching every mobile provider off', async () => {
        const user = userEvent.setup();
        const calls = stub((call) =>
            call.method === 'PUT'
                ? successResponse({
                      ...writeResult(['providers']),
                      warnings: [
                          { code: 'NO_MOBILE_PROVIDER_ENABLED', message: 'No mobile money will be offered' },
                      ],
                  })
                : undefined,
        );
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByLabelText('MTN'));
        await user.click(screen.getByLabelText('ORANGE'));
        const dialog = await openSaveDialog(user);

        expect(within(dialog).getByText(/switches every mobile-money provider off/i)).toBeInTheDocument();
        const save = within(dialog).getByRole('button', { name: /save routing/i });
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), REASON);
        expect(save).toBeDisabled();
        await user.type(within(dialog).getByLabelText(/type STOP MOBILE MONEY/i), 'STOP MOBILE MONEY');
        await user.click(save);

        expect(await within(dialog).findByText('No mobile money will be offered')).toBeInTheDocument();
        const put = calls.find((call) => call.method === 'PUT')!;
        expect(JSON.parse(put.body!).providers).toEqual({
            MTN: { enabled: false },
            ORANGE: { enabled: false },
        });
    });

    it('on a version conflict, reloads and asks again — and never retries the write', async () => {
        const user = userEvent.setup();
        let gets = 0;
        const calls = stub((call) => {
            if (call.method === 'PUT') {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'conflict',
                    details: { platformCode: 'PAYMENT_SETTINGS_VERSION_CONFLICT' },
                });
            }
            gets += 1;
            const base = routingFixture();
            return successResponse(
                gets === 1
                    ? base
                    : routingFixture({
                          settings: {
                              ...base.settings!,
                              version: 4,
                              updatedBy: { id: 'b2', name: 'Paul Mbarga' },
                              reason: 'Moved payouts while testing',
                          },
                      }),
            );
        });
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByLabelText('MOOV'));
        const dialog = await openSaveDialog(user);
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), REASON);
        await user.click(within(dialog).getByRole('button', { name: /save routing/i }));

        expect(await screen.findByText(/someone else saved first/i)).toBeInTheDocument();
        expect(await screen.findByText(/Paul Mbarga/)).toBeInTheDocument();
        expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);

        // The draft survives; the next save is made against the version now on screen.
        await openSaveDialog(user);
        const again = screen.getByRole('dialog');
        await user.type(within(again).getByLabelText(/why are you doing this/i), REASON);
        await user.click(within(again).getByRole('button', { name: /save routing/i }));
        await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2));
        expect(JSON.parse(calls.filter((call) => call.method === 'PUT')[1].body!).expectedVersion).toBe(4);
    });

    /**
     * A reload under a pending draft — the Refresh button here, a tab-return in real life — must
     * not quietly advance `expectedVersion`. Sending the newer version would overwrite another
     * operator's switch that this operator never looked at, with no conflict raised.
     */
    it('sends the version the draft was started from, even after a reload moved it', async () => {
        const user = userEvent.setup();
        let gets = 0;
        const calls = stub((call) => {
            if (call.method === 'PUT') return successResponse(writeResult(['providers']));
            gets += 1;
            const base = routingFixture();
            return successResponse(
                gets === 1 ? base : routingFixture({ settings: { ...base.settings!, version: 4 } }),
            );
        });
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByLabelText('MOOV'));
        await user.click(screen.getByRole('button', { name: /refresh/i }));
        expect(await screen.findByText(/changed since you started editing/i)).toBeInTheDocument();

        const dialog = await openSaveDialog(user);
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), REASON);
        await user.click(within(dialog).getByRole('button', { name: /save routing/i }));

        await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
        const put = calls.find((call) => call.method === 'PUT')!;
        expect(JSON.parse(put.body!).expectedVersion).toBe(3);
    });

    it('lists every broken rule on an invalid write, and saves nothing', async () => {
        const user = userEvent.setup();
        stub((call) =>
            call.method === 'PUT'
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'business_rule',
                      details: {
                          platformCode: 'PAYMENT_SETTINGS_INVALID',
                          errors: [
                              {
                                  code: 'COLLECTION_AGGREGATOR_NO_ENABLED_PROVIDER',
                                  message: 'MYCOOLPAY can serve none of the enabled providers',
                                  aggregator: 'MYCOOLPAY',
                              },
                              { code: 'BRAND_NEW_RULE', message: 'A rule added after this build' },
                          ],
                      },
                  })
                : undefined,
        );
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await chooseCollection(user, 'MYCOOLPAY');
        const dialog = await openSaveDialog(user);
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), REASON);
        await user.type(within(dialog).getByLabelText(/type MYCOOLPAY to confirm/i), 'MYCOOLPAY');
        await user.click(within(dialog).getByRole('button', { name: /save routing/i }));

        expect(await within(dialog).findByText(/refused — nothing was saved/i)).toBeInTheDocument();
        expect(within(dialog).getByText('A rule added after this build')).toBeInTheDocument();
        expect(within(dialog).getByText('BRAND_NEW_RULE')).toBeInTheDocument();
    });

    it('asks for jovi-mall to be deployed when the platform is too old for the write', async () => {
        const user = userEvent.setup();
        stub((call) =>
            call.method === 'PUT'
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'business_rule',
                      details: { platformCode: 'NOT_FOUND', platformSupported: false },
                  })
                : undefined,
        );
        render();
        await screen.findByText(/what customers can pay with right now/i);

        await user.click(screen.getByLabelText('MOOV'));
        const dialog = await openSaveDialog(user);
        await user.type(within(dialog).getByLabelText(/why are you doing this/i), REASON);
        await user.click(within(dialog).getByRole('button', { name: /save routing/i }));

        expect(await within(dialog).findByText(/deploy jovi-mall first/i)).toBeInTheDocument();
    });

    it('is read-only without developer_tools.payments.set', async () => {
        stub();
        const held = new Set([...heldFixture(1)].filter((name) => name !== 'developer_tools.payments.set'));
        render(1, held);
        await screen.findByText(/what customers can pay with right now/i);

        expect(screen.queryByRole('button', { name: /review and save/i })).not.toBeInTheDocument();
        expect(screen.getByLabelText('MTN')).toBeDisabled();
        expect(screen.getByText(/you can see these settings but not change them/i)).toBeInTheDocument();
    });
});
