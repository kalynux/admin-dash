import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { notify } from '@/lib/notify';
import { ClawbacksList } from '@/pages/money/ClawbacksList';
import { ReferralApplications } from '@/pages/referrals/ReferralApplications';
import { ReferralPartnerDetail } from '@/pages/referrals/ReferralPartnerDetail';
import { ReferralPartnersList } from '@/pages/referrals/ReferralPartnersList';
import { ReferralRewardDetailScreen } from '@/pages/referrals/ReferralRewardDetail';
import { ReferralRewardsList } from '@/pages/referrals/ReferralRewardsList';
import { ReferralSettingsScreen } from '@/pages/referrals/ReferralSettingsScreen';
import { ReferralSummary } from '@/pages/referrals/ReferralSummary';
import { AccountsList } from '@/pages/accounts/AccountsList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { ReferralPartner, ReferralReward, ReferralSettings } from '@/types/referrals.types';

const PARTNER_ID = '6900a1b2c3d4e5f6a7b8c901';
const USER_ID = '6900a1b2c3d4e5f6a7b8c902';
const ORDER_ID = '6900a1b2c3d4e5f6a7b8c903';
const REWARD_ID = '6900a1b2c3d4e5f6a7b8c904';

const meta = (total: number) => ({ total, page: 1, limit: 20, pages: total > 0 ? 1 : 0 });

const ROW = {
    id: PARTNER_ID,
    userId: USER_ID,
    name: 'Ulrich Mbarga',
    phone: '+237699000000',
    email: null,
    appliedAsRole: 'customer',
    status: 'pending',
    code: null,
    appliedAt: '2026-11-01T10:00:00.000Z',
    approvedAt: null,
    balances: { currency: 'XAF', pending: 0, available: 0, requested: 0, clawback: 0 },
};

function partner(overrides: Partial<ReferralPartner> = {}): ReferralPartner {
    return {
        ...ROW,
        status: 'active',
        code: 'ULRICH123',
        approvedAt: '2026-11-02T10:00:00.000Z',
        balances: { currency: 'XAF', pending: 630, available: 2100, requested: 0, clawback: 0 },
        motivation: 'I know many shops',
        termsAcceptedAt: '2026-11-01T10:00:00.000Z',
        statusReason: null,
        canReapply: false,
        balanceFrozen: false,
        balanceReleased: null,
        terms: {
            vendor: { ratePercent: 5, rateIsCustom: true, durationMonths: 6, durationIsCustom: false },
            customer: { ratePercent: 3, rateIsCustom: false, durationMonths: 6, durationIsCustom: false },
            agency: { ratePercent: 3, rateIsCustom: false, durationMonths: 6, durationIsCustom: false },
        },
        referred: { referred: 12, earning: 9 },
        history: [
            { from: null, to: 'pending', at: '2026-11-01T10:00:00.000Z', by: null, reason: null },
            { from: 'pending', to: 'active', at: '2026-11-02T10:00:00.000Z', by: 'Ada Admin', reason: null },
        ],
        ...overrides,
    };
}

function reward(overrides: Partial<ReferralReward> = {}): ReferralReward {
    return {
        id: REWARD_ID,
        partnerId: PARTNER_ID,
        relationshipId: '6900a1b2c3d4e5f6a7b8c905',
        referredUserId: '6900a1b2c3d4e5f6a7b8c906',
        referredName: 'Carine N',
        category: 'customer',
        sourceType: 'order',
        orderId: ORDER_ID,
        bookingId: null,
        vendorId: '6900a1b2c3d4e5f6a7b8c907',
        commissionId: '6900a1b2c3d4e5f6a7b8c908',
        commissionWithheld: false,
        commissionEarned: 7000,
        sharePercent: 100,
        ratePercent: 3,
        rateSource: 'global',
        amount: 210,
        clawedAmount: 90,
        remaining: 120,
        currency: 'XAF',
        status: 'released',
        earnedAt: '2026-10-01T10:00:00.000Z',
        availableFrom: '2026-10-15T10:00:00.000Z',
        releasedAt: '2026-10-15T10:00:00.000Z',
        reversedAt: null,
        adjustments: [],
        ...overrides,
    };
}

const SETTINGS: ReferralSettings = {
    enabled: false,
    terms: {
        vendor: { ratePercent: 3, durationMonths: 6 },
        customer: { ratePercent: 3, durationMonths: 6 },
        agency: { ratePercent: 3, durationMonths: 6 },
    },
    minPayoutAmount: 1000,
    rewardWaitDays: 14,
    updatedAt: null,
    updatedBy: null,
};

function render(ui: React.ReactElement, tier: 1 | 2 | 3, route = '/') {
    return renderWithProviders(ui, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { status: 'ready', held: heldFixture(tier) },
    });
}

/** A detail stub: the read answers `current`, a write answers `{ partner, result }`. */
function stubDetail(current: ReferralPartner, after?: ReferralPartner | null) {
    return stubFetch((call) => {
        if (call.method !== 'GET') {
            return successResponse(
                { partner: after === undefined ? current : after, result: { id: PARTNER_ID } },
                { message: 'Partner suspended' },
            );
        }
        if (call.url.includes('/referrals/settings')) return successResponse(SETTINGS);
        if (call.url.includes(`/partners/${PARTNER_ID}/referred`) || call.url.includes(`/partners/${PARTNER_ID}/rewards`)) {
            return successResponse([], { meta: meta(0) });
        }
        if (call.url.includes('/audit')) return successResponse([], { meta: meta(0) });
        return successResponse(current);
    });
}

function renderDetail(tier: 1 | 2 | 3) {
    return render(
        <Routes>
            <Route path="/dashboard/referrals/partners/:partnerId" element={<ReferralPartnerDetail />} />
        </Routes>,
        tier,
        `/dashboard/referrals/partners/${PARTNER_ID}`,
    );
}

const writes = (calls: FetchCall[]) => calls.filter((call) => call.method !== 'GET');

afterEach(() => vi.restoreAllMocks());

describe('Applications', () => {
    function stubList() {
        return stubFetch(() => successResponse([ROW], { meta: meta(1) }));
    }

    it('asks only for pending partners, longest waiting first', async () => {
        const calls = stubList();
        render(<ReferralApplications />, 3, '/dashboard/referrals/applications');

        await screen.findByRole('link', { name: 'Ulrich Mbarga' });
        const url = new URL(calls[0].url, 'http://x');
        expect(url.searchParams.get('status')).toBe('pending');
        expect(url.searchParams.get('sort')).toBe('appliedAt');
    });

    it('offers Support approve and reject, because the owner gave them the decision', async () => {
        stubList();
        render(<ReferralApplications />, 3);

        const row = (await screen.findByRole('link', { name: 'Ulrich Mbarga' })).closest('tr') as HTMLElement;
        expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('hides both from someone who does not hold the permission', async () => {
        stubList();
        const held = new Set([...heldFixture(3)].filter((name) => name !== 'referrals.partners.decide'));
        renderWithProviders(<ReferralApplications />, {
            auth: { status: 'authenticated', admin: adminFixture() },
            permissions: { status: 'ready', held },
        });

        await screen.findByRole('link', { name: 'Ulrich Mbarga' });
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('requires a reason to reject, and labels it as shown to the partner', async () => {
        const user = userEvent.setup();
        const calls = stubList();
        render(<ReferralApplications />, 3);

        await user.click(await screen.findByRole('button', { name: 'Reject' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByLabelText(/shown to the partner/i)).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Reject application' }));
        await within(dialog).findByText(/at least 3 characters/i);
        expect(writes(calls)).toHaveLength(0);
    });

    it('sends an approval with no reason as no key at all', async () => {
        const user = userEvent.setup();
        const success = vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubFetch((call) =>
            call.method === 'POST'
                ? successResponse({ partner: partner(), result: { id: PARTNER_ID } }, { message: 'Application approved' })
                : successResponse([ROW], { meta: meta(1) }),
        );
        render(<ReferralApplications />, 3);

        await user.click(await screen.findByRole('button', { name: 'Approve' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

        await waitFor(() => expect(writes(calls)).toHaveLength(1));
        expect(writes(calls)[0].url).toContain(`/referrals/partners/${PARTNER_ID}/approve`);
        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({});
        await waitFor(() => expect(success).toHaveBeenCalledWith('Application approved'));
    });
});

describe('Partners', () => {
    it('says a search matches the start of a code, phone or email', async () => {
        stubFetch(() => successResponse([], { meta: meta(0) }));
        render(<ReferralPartnersList />, 3, '/dashboard/referrals/partners?search=carine');

        expect(await screen.findByText(/never a name/i)).toBeInTheDocument();
    });

    it('says when a partner has no code yet', async () => {
        stubFetch(() => successResponse([ROW], { meta: meta(1) }));
        render(<ReferralPartnersList />, 3);

        expect(await screen.findByText('No code yet')).toBeInTheDocument();
    });
});

describe('a partner’s verbs', () => {
    it('offers Support suspend and terminate on an active partner, and no term edits', async () => {
        stubDetail(partner());
        renderDetail(3);

        expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'End partnership' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Change /i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Reset /i })).not.toBeInTheDocument();
    });

    it('withholds Release balance from Support, and offers it to Admin', async () => {
        const frozen = partner({ status: 'suspended', balanceFrozen: true });

        stubDetail(frozen);
        const support = renderDetail(3);
        expect(await screen.findByRole('button', { name: 'Reinstate' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Release balance' })).not.toBeInTheDocument();
        support.unmount();

        stubDetail(frozen);
        renderDetail(2);
        expect(await screen.findByRole('button', { name: 'Release balance' })).toBeInTheDocument();
    });

    it('never offers a way to change a referrer', async () => {
        stubDetail(partner());
        renderDetail(1);

        await screen.findByRole('button', { name: 'Suspend' });
        expect(screen.queryByRole('button', { name: /referrer/i })).not.toBeInTheDocument();
    });

    it('labels a suspension’s reason as public and adopts the answered detail without a re-read', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubDetail(partner(), partner({ status: 'suspended', balanceFrozen: true, statusReason: 'Under review' }));
        renderDetail(3);

        await user.click(await screen.findByRole('button', { name: 'Suspend' }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/shown to the partner/i), 'Under review');
        await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));

        expect(await screen.findByRole('button', { name: 'Reinstate' })).toBeInTheDocument();
        expect(screen.getByText('Under review')).toBeInTheDocument();
        expect(screen.getByText(/this balance is frozen/i)).toBeInTheDocument();

        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({ reason: 'Under review' });
        const reads = calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/partners/${PARTNER_ID}`));
        expect(reads).toHaveLength(1);
    });

    it('re-reads when the write answers no partner, rather than reporting a failure', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubDetail(partner(), null);
        renderDetail(3);

        await user.click(await screen.findByRole('button', { name: 'Suspend' }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/shown to the partner/i), 'Under review');
        await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));

        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/partners/${PARTNER_ID}`))).toHaveLength(2),
        );
    });

    it('closes and re-reads when another administrator got there first', async () => {
        const user = userEvent.setup();
        const warning = vi.spyOn(notify, 'warning').mockImplementation(() => 'id');
        const calls = stubFetch((call) => {
            if (call.method === 'POST') {
                return errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                    details: { platformCode: 'REFERRAL_PARTNER_STATUS_CONFLICT', status: 'terminated' },
                });
            }
            if (call.url.includes('/referrals/settings')) return successResponse(SETTINGS);
            return successResponse(partner());
        });
        renderDetail(3);

        await user.click(await screen.findByRole('button', { name: 'Suspend' }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/shown to the partner/i), 'Under review');
        await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));

        await waitFor(() => expect(warning).toHaveBeenCalledWith('Someone else already changed this partner', expect.anything()));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/partners/${PARTNER_ID}`))).toHaveLength(2);
    });

    it('does not call a new applicant’s empty wallet frozen, though the field says true', async () => {
        stubDetail(partner({ status: 'pending', code: null, balanceFrozen: true, balances: ROW.balances }));
        renderDetail(3);

        await screen.findByRole('button', { name: 'Approve' });
        expect(screen.queryByText(/this balance is frozen/i)).not.toBeInTheDocument();
    });
});

describe('per-partner terms', () => {
    it('shows each field’s value and whether it is custom, to every tier', async () => {
        stubDetail(partner());
        renderDetail(3);

        const vendor = (await screen.findByRole('rowheader', { name: 'Vendor' })).closest('tr') as HTMLElement;
        expect(within(vendor).getByText('5%')).toBeInTheDocument();
        expect(within(vendor).getByText('Custom')).toBeInTheDocument();
        expect(within(vendor).getByText('Global')).toBeInTheDocument();
    });

    it('offers tier 1 a reset only on a custom field, and it sends null for that field alone', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubDetail(partner());
        renderDetail(1);

        await screen.findByRole('rowheader', { name: 'Vendor' });
        expect(screen.queryByRole('button', { name: 'Reset Vendor duration' })).not.toBeInTheDocument();
        await user.click(await screen.findByRole('button', { name: 'Reset Vendor rate' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/global rate \(3% today\)/i)).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'Reset rate' }));

        await waitFor(() => expect(writes(calls)).toHaveLength(1));
        expect(writes(calls)[0].method).toBe('PATCH');
        expect(writes(calls)[0].url).toContain(`/partners/${PARTNER_ID}/terms`);
        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({ terms: { vendor: { ratePercent: null } } });
    });

    it('withholds both controls from Admin', async () => {
        stubDetail(partner());
        renderDetail(2);

        await screen.findByRole('rowheader', { name: 'Vendor' });
        expect(screen.queryByRole('button', { name: /^Change /i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Reset /i })).not.toBeInTheDocument();
    });
});

describe('Settings', () => {
    function stubSettings(onPatch?: (body: unknown) => ReferralSettings) {
        return stubFetch((call) =>
            call.method === 'PATCH'
                ? successResponse(onPatch?.(JSON.parse(call.body as string)) ?? SETTINGS)
                : successResponse(SETTINGS),
        );
    }

    it('says how a rate and a duration differ, to everyone', async () => {
        stubSettings();
        render(<ReferralSettingsScreen />, 3);

        const note = await screen.findByRole('note');
        expect(note).toHaveTextContent(/next commission, on referrals that already exist/i);
        expect(note).toHaveTextContent(/new referrals only/i);
    });

    it('gives Admin and Support the facts and no inputs', async () => {
        stubSettings();
        render(<ReferralSettingsScreen />, 2);

        await screen.findByRole('note');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /switch the program/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    });

    it('sends tier 1’s single changed field and nothing else', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubSettings();
        render(<ReferralSettingsScreen />, 1);

        const rate = await screen.findByLabelText('Customer rate (%)');
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
        await user.clear(rate);
        await user.type(rate, '2');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(writes(calls)).toHaveLength(1));
        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({ terms: { customer: { ratePercent: 2 } } });
    });

    it('refuses a rate above 25 without calling the service', async () => {
        const user = userEvent.setup();
        const calls = stubSettings();
        render(<ReferralSettingsScreen />, 1);

        const rate = await screen.findByLabelText('Vendor rate (%)');
        await user.clear(rate);
        await user.type(rate, '26');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByText(/from 0 to 25/i)).toBeInTheDocument();
        expect(writes(calls)).toHaveLength(0);
    });

    it('switches the program only after a confirmation that names the consequence', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubSettings(() => ({ ...SETTINGS, enabled: true, updatedAt: '2026-11-03T10:00:00.000Z' }));
        render(<ReferralSettingsScreen />, 1);

        await user.click(await screen.findByRole('button', { name: 'Switch the program on' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/earned while it was off stay unpaid/i)).toBeInTheDocument();
        expect(writes(calls)).toHaveLength(0);

        await user.click(within(dialog).getByRole('button', { name: 'Switch on' }));
        await waitFor(() => expect(writes(calls)).toHaveLength(1));
        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({ enabled: true });
        expect(await screen.findByRole('button', { name: 'Switch the program off' })).toBeInTheDocument();
    });
});

describe('Rewards', () => {
    it('shows a withheld commission as Hidden, never as zero', async () => {
        stubFetch(() =>
            successResponse([reward({ commissionWithheld: true, commissionEarned: null })], { meta: meta(1) }),
        );
        render(<ReferralRewardsList />, 2);

        expect(await screen.findByText('Hidden')).toBeInTheDocument();
        expect(screen.getByText(/hidden is not zero/i)).toBeInTheDocument();
        expect(screen.queryByText(/XAF\s*0|0\s*XAF|0\s*FCFA/)).not.toBeInTheDocument();
    });

    it('shows the commission to tier 1', async () => {
        stubFetch(() => successResponse([reward()], { meta: meta(1) }));
        render(<ReferralRewardsList />, 1);

        await screen.findByRole('link', { name: 'Carine N' });
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    });

    it('holds back a half-typed order id rather than earning a 400', async () => {
        const calls = stubFetch(() => successResponse([], { meta: meta(0) }));
        render(<ReferralRewardsList />, 3, '/dashboard/referrals/rewards?orderId=6900a1');

        expect(await screen.findByText(/not applied yet/i)).toBeInTheDocument();
        expect(new URL(calls[0].url, 'http://x').searchParams.get('orderId')).toBeNull();
    });

    it('sends a whole order id', async () => {
        const calls = stubFetch(() => successResponse([], { meta: meta(0) }));
        render(<ReferralRewardsList />, 3, `/dashboard/referrals/rewards?orderId=${ORDER_ID}`);

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(new URL(calls[0].url, 'http://x').searchParams.get('orderId')).toBe(ORDER_ID);
    });
});

describe('a reward', () => {
    function renderReward(tier: 1 | 2 | 3) {
        return render(
            <Routes>
                <Route path="/dashboard/referrals/rewards/:rewardId" element={<ReferralRewardDetailScreen />} />
            </Routes>,
            tier,
            `/dashboard/referrals/rewards/${REWARD_ID}`,
        );
    }

    it('links to the order and lists the others on the same commission', async () => {
        stubFetch(() =>
            successResponse({
                reward: reward(),
                onSameCommission: [reward({ id: '6900a1b2c3d4e5f6a7b8c9aa', referredName: 'Paul T', category: 'vendor' })],
            }),
        );
        renderReward(1);

        expect(await screen.findByRole('link', { name: 'Paul T' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'On the same commission' })).toBeInTheDocument();
        const order = document.querySelector(`a[href="/dashboard/orders/${ORDER_ID}"]`);
        expect(order).not.toBeNull();
    });

    it('survives a reward the service could not find among its commission’s', async () => {
        stubFetch(() => successResponse({ reward: null, onSameCommission: [] }));
        renderReward(3);

        expect(await screen.findByText(/could not find this reward/i)).toBeInTheDocument();
    });
});

describe('Summary', () => {
    const SUMMARY = {
        rewards: [
            { currency: 'XAF', status: 'held', amount: 630, count: 3 },
            { currency: 'XAF', status: 'released', amount: 2100, count: 10 },
            { currency: 'XAF', status: 'reversed', amount: 0, count: 1 },
        ],
        partners: { pending: 2, active: 14, suspended: 1 },
    };

    it('prints the rows, a total labelled as computed here, and every status', async () => {
        stubFetch(() => successResponse(SUMMARY));
        render(<ReferralSummary />, 3);

        expect(await screen.findByText('Total so far')).toBeInTheDocument();
        expect(screen.getByText(/added up on this page/i)).toBeInTheDocument();
        // 630 + 2100, and the reversed row adds nothing.
        expect(screen.getByText(/2[\s.,]?730/)).toBeInTheDocument();
        const statuses = screen.getByText('Terminated').closest('li') as HTMLElement;
        expect(within(statuses).getByText('0')).toBeInTheDocument();
        expect(screen.getByText(/dates above do not apply here/i)).toBeInTheDocument();
    });
});

describe('the money screens', () => {
    it('sends a partner’s row on Accounts to their partner page, because /accounts refuses the type', async () => {
        stubFetch(() =>
            successResponse(
                [
                    {
                        owner: { type: 'referral_partner', id: PARTNER_ID, name: 'ULRICH123' },
                        currency: 'XAF',
                        available: 2100,
                        pending: 630,
                        reserve: 0,
                        requested: 0,
                        paidOut: 0,
                        clawback: 0,
                    },
                ],
                { meta: meta(1) },
            ),
        );
        render(<AccountsList />, 2);

        expect(await screen.findByText('ULRICH123')).toBeInTheDocument();
        expect(document.querySelector(`a[href="/dashboard/referrals/partners/${PARTNER_ID}"]`)).not.toBeNull();
        expect(document.querySelector('a[href^="/dashboard/accounts/referral_partner"]')).toBeNull();
    });

    it('sends a partner’s row on Refund debt to their partner page too', async () => {
        stubFetch(() =>
            successResponse(
                [
                    {
                        owner: { type: 'referral_partner', id: PARTNER_ID, name: 'ULRICH123' },
                        clawback: 500,
                        currency: 'XAF',
                        updatedAt: '2026-11-01T10:00:00.000Z',
                    },
                ],
                { meta: { ...meta(1), totals: [] } },
            ),
        );
        render(<ClawbacksList />, 2);

        expect(await screen.findByText('ULRICH123')).toBeInTheDocument();
        expect(document.querySelector(`a[href="/dashboard/referrals/partners/${PARTNER_ID}"]`)).not.toBeNull();
        expect(screen.getByRole('button', { name: /write off/i })).toBeInTheDocument();
    });
});

describe('the provider category (2026-11-08)', () => {
    const PAYMENT_ID = '6900a1b2c3d4e5f6a7b8c9bb';
    const WITH_PROVIDER: ReferralSettings = {
        ...SETTINGS,
        terms: { ...SETTINGS.terms, provider: { ratePercent: 3, durationMonths: 6 } },
    };

    /** A provider reward as wi-admin sends it below tier 1: `commissionWithheld` is still true. */
    const providerReward = (overrides: Partial<ReferralReward> = {}) =>
        reward({
            category: 'provider',
            sourceType: 'credit_topup',
            orderId: null,
            bookingId: null,
            commissionId: null,
            commissionWithheld: true,
            commissionEarned: null,
            paymentKind: 'credits',
            payment: { kind: 'credits', id: PAYMENT_ID, amountPaid: 3000 },
            amount: 90,
            clawedAmount: 0,
            remaining: 90,
            ...overrides,
        });

    it('lets tier 1 set the service provider rate, and sends only it', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubFetch(() => successResponse(WITH_PROVIDER));
        render(<ReferralSettingsScreen />, 1);

        const rate = await screen.findByLabelText('Service provider rate (%)');
        await user.clear(rate);
        await user.type(rate, '4');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(writes(calls)).toHaveLength(1));
        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({ terms: { provider: { ratePercent: 4 } } });
    });

    it('offers no provider row against an older service that reports none, and still saves the rest', async () => {
        const user = userEvent.setup();
        vi.spyOn(notify, 'success').mockImplementation(() => 'id');
        const calls = stubFetch(() => successResponse(SETTINGS));
        render(<ReferralSettingsScreen />, 1);

        const rate = await screen.findByLabelText('Vendor rate (%)');
        expect(screen.queryByLabelText('Service provider rate (%)')).not.toBeInTheDocument();
        await user.clear(rate);
        await user.type(rate, '4');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(writes(calls)).toHaveLength(1));
        expect(JSON.parse(writes(calls)[0].body as string)).toEqual({ terms: { vendor: { ratePercent: 4 } } });
    });

    it('🔴 shows Admin a provider reward’s credit pack and price paid — never "Hidden"', async () => {
        stubFetch(() => successResponse([providerReward()], { meta: meta(1) }));
        render(<ReferralRewardsList />, 2);

        expect(await screen.findByText('Credit pack')).toBeInTheDocument();
        expect(screen.getByText('Service provider')).toBeInTheDocument();
        expect(screen.getByText('price paid')).toBeInTheDocument();
        expect(screen.getByText(/3\D?000/)).toBeInTheDocument();
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
        expect(screen.queryByText(/hidden is not zero/i)).not.toBeInTheDocument();
    });

    it('still says Hidden for a commission reward beside it', async () => {
        stubFetch(() =>
            successResponse(
                [providerReward(), reward({ id: '6900a1b2c3d4e5f6a7b8c9cc', commissionWithheld: true, commissionEarned: null })],
                { meta: meta(2) },
            ),
        );
        render(<ReferralRewardsList />, 2);

        expect(await screen.findByText('Credit pack')).toBeInTheDocument();
        expect(screen.getAllByText('Hidden')).toHaveLength(1);
    });

    it('shows Support a provider reward by its payment, and its siblings as the same payment', async () => {
        stubFetch(() =>
            successResponse({
                reward: providerReward({ paymentKind: 'plan', payment: { kind: 'plan', id: PAYMENT_ID, amountPaid: 15000 }, sourceType: 'plan_purchase' }),
                onSameCommission: [],
            }),
        );
        render(
            <Routes>
                <Route path="/dashboard/referrals/rewards/:rewardId" element={<ReferralRewardDetailScreen />} />
            </Routes>,
            3,
            `/dashboard/referrals/rewards/${REWARD_ID}`,
        );

        expect(await screen.findByText('Price paid')).toBeInTheDocument();
        expect(screen.getAllByText('Plan purchase').length).toBeGreaterThan(0);
        expect(screen.getByText(/of the price paid/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Other rewards on this payment' })).toBeInTheDocument();
        expect(screen.getByText('No other reward came from this payment.')).toBeInTheDocument();
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
        expect(screen.queryByText('Commission')).not.toBeInTheDocument();
        expect(document.querySelector('a[href^="/dashboard/money/allocations/"]')).toBeNull();
    });

    it('says what reversed a provider reward, with no commission line', async () => {
        stubFetch(() =>
            successResponse({
                reward: providerReward({
                    status: 'reversed',
                    reversedAt: '2026-11-05T10:00:00.000Z',
                    clawedAmount: 90,
                    remaining: 0,
                    adjustments: [
                        { at: '2026-11-05T10:00:00.000Z', refundKey: 'credit_topup_reversed', commissionRetained: null, amountBefore: 90, amountAfter: 0 },
                    ],
                }),
                onSameCommission: [],
            }),
        );
        render(
            <Routes>
                <Route path="/dashboard/referrals/rewards/:rewardId" element={<ReferralRewardDetailScreen />} />
            </Routes>,
            2,
            `/dashboard/referrals/rewards/${REWARD_ID}`,
        );

        expect(await screen.findByText('Reversals')).toBeInTheDocument();
        expect(screen.getByText(/credit topup reversed/)).toBeInTheDocument();
        expect(screen.queryByText(/Commission kept/)).not.toBeInTheDocument();
    });
});
