import { describe, expect, it } from 'vitest';

import { ApiError } from '@/types/api.types';
import {
    buildSettingsPatch,
    classifyPaymentSettingsRefusal,
    collectCapabilities,
    draftFromSettings,
    formatSuccessRate,
    issueTarget,
    payoutTransferGateway,
    providerNames,
    readEffectiveProviders,
    switchesAggregator,
    turnsOffEveryMobileProvider,
    type PaymentSettingsView,
} from '@/types/payment-routing.types';

function settings(overrides: Partial<PaymentSettingsView> = {}): PaymentSettingsView {
    return {
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
        updatedBy: { id: 'a1', name: 'Jane Doe' },
        reason: 'NotchPay outage, moving collections',
        ...overrides,
    };
}

function rejection(status: number, details: Record<string, unknown>) {
    return new ApiError({
        status,
        code: 'PLATFORM_OPERATION_REJECTED',
        category: status === 409 ? 'conflict' : 'business_rule',
        message: 'refused',
        details,
    });
}

describe('buildSettingsPatch', () => {
    it('sends nothing when nothing changed', () => {
        const current = settings();
        expect(buildSettingsPatch(current, draftFromSettings(current))).toBeNull();
    });

    /**
     * The server merges `providers` per provider, so sending the whole map would overwrite a
     * second operator's toggle that this screen merely displayed.
     */
    it('sends only the fields and the providers that moved', () => {
        const current = settings();
        const draft = draftFromSettings(current);
        draft.collectionAggregator = 'MYCOOLPAY';
        draft.providers.ORANGE = false;

        expect(buildSettingsPatch(current, draft)).toEqual({
            collectionAggregator: 'MYCOOLPAY',
            providers: { ORANGE: { enabled: false } },
        });
    });

    it('reads a provider missing from the stored map as disabled, as routing.md says', () => {
        const current = settings({ providers: { MTN: { enabled: true } } });
        const draft = draftFromSettings(current);
        expect(draft.providers.ORANGE).toBe(false);
        // Leaving it off is not a change, so it is not sent.
        expect(buildSettingsPatch(current, draft)).toBeNull();
    });

    it('keeps a provider the catalogue does not know yet', () => {
        const current = settings({
            providers: { ...settings().providers, WAVE: { enabled: true } },
        });
        expect(providerNames(current)).toEqual(['MTN', 'ORANGE', 'MOOV', 'CARD', 'WAVE']);
    });
});

describe('the two confirmations', () => {
    it('treats either aggregator as a switch, and a provider toggle as not one', () => {
        expect(switchesAggregator({ collectionAggregator: 'MYCOOLPAY' })).toBe(true);
        expect(switchesAggregator({ payoutAggregator: 'NOTCHPAY' })).toBe(true);
        expect(switchesAggregator({ providers: { MTN: { enabled: false } } })).toBe(false);
        expect(switchesAggregator({ stripeEnabled: true })).toBe(false);
    });

    it('flags switching the last mobile provider off, and not card', () => {
        const current = settings();
        const draft = draftFromSettings(current);
        draft.providers.MTN = false;
        expect(turnsOffEveryMobileProvider(current, draft)).toBe(false);
        draft.providers.ORANGE = false;
        expect(turnsOffEveryMobileProvider(current, draft)).toBe(true);
    });

    it('does not re-flag a platform where mobile money was already off', () => {
        const current = settings({
            providers: { MTN: { enabled: false }, ORANGE: { enabled: false }, CARD: { enabled: true } },
        });
        const draft = draftFromSettings(current);
        draft.providers.CARD = false;
        expect(turnsOffEveryMobileProvider(current, draft)).toBe(false);
    });
});

describe('classifyPaymentSettingsRefusal', () => {
    it('reads the conflict off details.platformCode, not error.code', () => {
        expect(
            classifyPaymentSettingsRefusal(
                rejection(409, { platformCode: 'PAYMENT_SETTINGS_VERSION_CONFLICT' }),
            ),
        ).toEqual({ kind: 'version-conflict' });
    });

    it('keeps every issue on an invalid write, unknown codes included', () => {
        const refusal = classifyPaymentSettingsRefusal(
            rejection(422, {
                platformCode: 'PAYMENT_SETTINGS_INVALID',
                errors: [
                    { code: 'COLLECTION_AGGREGATOR_NOT_CONFIGURED', message: 'MYCOOLPAY has no key', aggregator: 'MYCOOLPAY' },
                    { code: 'SOMETHING_NEW_NEXT_YEAR', message: 'A rule this build has never seen' },
                    { nonsense: true },
                ],
            }),
        );
        expect(refusal).toEqual({
            kind: 'invalid',
            issues: [
                { code: 'COLLECTION_AGGREGATOR_NOT_CONFIGURED', message: 'MYCOOLPAY has no key', aggregator: 'MYCOOLPAY' },
                { code: 'SOMETHING_NEW_NEXT_YEAR', message: 'A rule this build has never seen' },
            ],
        });
    });

    it('recognises a platform too old for routing', () => {
        expect(
            classifyPaymentSettingsRefusal(
                rejection(422, { platformCode: 'NOT_FOUND', platformSupported: false }),
            ),
        ).toEqual({ kind: 'platform-too-old' });
    });

    it('leaves anything else to the generic path', () => {
        expect(classifyPaymentSettingsRefusal(new Error('boom'))).toBeNull();
        expect(
            classifyPaymentSettingsRefusal(
                new ApiError({ status: 400, code: 'VALIDATION_ERROR', category: 'validation', message: 'x' }),
            ),
        ).toBeNull();
    });
});

describe('reading what jovi-mall passes through', () => {
    it('tells an empty offer apart from no answer', () => {
        expect(readEffectiveProviders([])).toEqual([]);
        expect(readEffectiveProviders(null)).toBeNull();
        expect(
            readEffectiveProviders([
                { provider: 'MTN', aggregator: 'NOTCHPAY', capability: { flow: 'PUSH', requires: ['phoneNumber'] } },
            ]),
        ).toEqual([
            { provider: 'MTN', aggregator: 'NOTCHPAY', capability: { flow: 'PUSH', requires: ['phoneNumber'] } },
        ]);
    });

    it('lists what an aggregator collects, in catalogue order, and survives junk', () => {
        expect(
            collectCapabilities({
                collect: {
                    ORANGE: { flow: 'OTP', requires: ['phoneNumber'] },
                    MTN: { flow: 'PUSH', requires: ['phoneNumber'] },
                },
                settlesAsync: true,
            }).map(([provider, capability]) => `${provider}:${capability.flow}`),
        ).toEqual(['MTN:PUSH', 'ORANGE:OTP']);
        expect(collectCapabilities({ '…': '…' })).toEqual([]);
        expect(collectCapabilities(null)).toEqual([]);
    });

    it('never reads a null success rate as 0%', () => {
        expect(formatSuccessRate(null)).toBeNull();
        expect(formatSuccessRate(0)).toBe('0.0%');
        expect(formatSuccessRate(0.944)).toBe('94.4%');
    });

    it('points an issue at its control, and leaves an unknown one untargeted', () => {
        expect(issueTarget({ code: 'COLLECTION_AGGREGATOR_IS_STRIPE', message: '' })).toEqual({
            kind: 'collectionAggregator',
        });
        expect(issueTarget({ code: 'PAYOUT_UNAVAILABLE', message: '' })).toEqual({
            kind: 'payoutAggregator',
        });
        expect(issueTarget({ code: 'PROVIDER_UNROUTABLE', message: '', provider: 'MOOV' })).toEqual({
            kind: 'provider',
            provider: 'MOOV',
        });
        expect(issueTarget({ code: 'NO_MOBILE_PROVIDER_ENABLED', message: '' })).toBeNull();
    });
});

describe('payoutTransferGateway', () => {
    it('shows the stamped aggregator as recorded', () => {
        expect(
            payoutTransferGateway({ transferGateway: 'CAMPAY', transferGatewayRef: 'x', status: 'paid' }),
        ).toEqual({ gateway: 'CAMPAY', inferred: false });
    });

    /** Every payout before routing existed went through NotchPay (brief § 3). */
    it('defaults a sent payout with no stamp to NotchPay, and says it was inferred', () => {
        expect(
            payoutTransferGateway({ transferGateway: null, transferGatewayRef: 'NP-TR-1', status: 'paid' }),
        ).toEqual({ gateway: 'NOTCHPAY', inferred: true });
        expect(
            payoutTransferGateway({ transferGateway: null, transferGatewayRef: null, status: 'failed' }),
        ).toEqual({ gateway: 'NOTCHPAY', inferred: true });
    });

    it('gives no aggregator to a payout never attempted, or one recorded as paid by hand', () => {
        expect(
            payoutTransferGateway({ transferGateway: null, transferGatewayRef: null, status: 'pending' }),
        ).toBeNull();
        expect(
            payoutTransferGateway({ transferGateway: null, transferGatewayRef: null, status: 'paid' }),
        ).toBeNull();
    });
});
