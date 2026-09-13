import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
    ReinstateContractDialog,
    SuspendContractDialog,
    TerminateContractDialog,
} from '@/components/contracts/ContractWriteDialogs';
import { notify } from '@/lib/notify';
import { adminFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { ContractDetail } from '@/types/contracts.types';

/**
 * The three contract interventions, and the two refusals they share.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Both shared refusals were branched on a `details.platformCode` that could
 * never arrive, and **nothing caught it for months** because these dialogs had
 * no test at all. One was a code jovi-mall has never declared
 * (`CONTRACT_REQUEST_ALREADY_PENDING`, where the registry says
 * `CONTRACT_STATUS_REQUEST_ALREADY_PENDING`); the other is forwarded at 403,
 * whose `details` allowlist drops `platformCode` outright. So the assertions
 * below are deliberately about *which* refusal was recognised, not merely that
 * something was rendered — a generic error banner is what both bugs looked
 * like, and it looks like success from a distance.
 */

const CONTRACT_ID = '6661aabbccddeeff00112233';

function contractFixture(overrides: Partial<ContractDetail> = {}): ContractDetail {
    return {
        id: CONTRACT_ID,
        agentId: '6660112233445566778899aa',
        agencyId: '665c0011223344556677889a',
        status: 'active',
        origin: 'agency_invite',
        isPrimary: true,
        cod: { threshold: 200000, outstandingBalance: 0, lastSettledAt: null },
        payment: { outstandingToAgent: 0, lastPaidAt: null },
        terms: {
            employment: null,
            remittance: null,
            feeSplit: null,
            coverageRegions: [],
            shipmentValueCeiling: null,
            proposedBy: null,
            version: 1,
        },
        lifecycle: {
            approvedAt: '2026-08-01T09:00:00.000Z',
            suspendedAt: null,
            suspensionReason: null,
            deactivatedAt: null,
            deactivationReason: null,
            withdrawnAt: null,
            withdrawalReason: null,
        },
        createdAt: '2026-08-01T08:00:00.000Z',
        updatedAt: '2026-08-01T09:00:00.000Z',
        agent: {
            id: '6660112233445566778899aa',
            name: 'Ada Nkeng',
            status: 'active',
            kycStatus: 'verified',
            availability: 'available',
            banned: false,
        },
        agency: {
            id: '665c0011223344556677889a',
            businessName: 'Littoral Express Delivery',
            status: 'active',
            contactName: 'Paul Etoa',
            country: 'CM',
        },
        ...overrides,
    };
}

function render(node: React.ReactElement) {
    return renderWithProviders(node, {
        auth: { status: 'authenticated', admin: adminFixture() },
    });
}

/** Toasts are asserted at the seam: `<Toaster>` lives in `App`, not here. */
function watchWarnings() {
    return vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
}

async function submitWithReason(buttonName: RegExp) {
    await userEvent.type(
        screen.getByRole('textbox'),
        'the agency has been withholding assignments',
    );
    await userEvent.click(screen.getByRole('button', { name: buttonName }));
}

describe('a forwarded 403', () => {
    /**
     * `CONTRACT_TRANSITION_NOT_PERMITTED` is jovi-mall's, forwarded at **403**.
     * 403 is `authorization`, one of the two categories whose `details` allowlist
     * is closed — `required` · `requiredAny` · `mode` · `resource` · `action` ·
     * `hint` — so `platformCode` is dropped at the boundary and **the body below
     * is exactly what a client receives**. There is no code to compare against.
     *
     * ⚠ The stub therefore sends **no `details` at all**, which is the point of
     * the case: a version of this that helpfully included `platformCode` would
     * pass against the old broken branch too.
     */
    const forwardedRefusal = () =>
        errorResponse(403, 'PLATFORM_OPERATION_REJECTED', {
            category: 'authorization',
            message: 'Only the agency that opened this contract may suspend it.',
        });

    it('recognises it on Suspend, and reloads the screen', async () => {
        stubFetch(forwardedRefusal);
        const warning = watchWarnings();
        const onDone = vi.fn();
        render(
            <SuspendContractDialog
                contract={contractFixture()}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/suspend/i);

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'The platform refused this transition',
                expect.anything(),
            ),
        );
        // jovi-mall's own sentence is the only thing carrying *which* party and
        // *which* verb, so it is rendered verbatim rather than through the
        // catalog — `authorization` is not in `MESSAGE_BEARING`.
        expect(warning.mock.calls[0][1]?.description).toMatch(
            /only the agency that opened this contract may suspend it/i,
        );
        // The screen is showing a state the platform has already rejected.
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('recognises it on Reinstate, and reloads the screen', async () => {
        stubFetch(forwardedRefusal);
        const warning = watchWarnings();
        const onDone = vi.fn();
        render(
            <ReinstateContractDialog
                contract={contractFixture({ status: 'suspended' })}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/reinstate/i);

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'The platform refused this transition',
                expect.anything(),
            ),
        );
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('recognises it on Terminate, and asks the screen to re-read', async () => {
        stubFetch(forwardedRefusal);
        const warning = watchWarnings();
        const onDone = vi.fn();
        render(
            <TerminateContractDialog
                contract={contractFixture()}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/terminate/i);

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'The platform refused this transition',
                expect.anything(),
            ),
        );
        // `null` is the "nothing was written, go and re-read" signal.
        await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    });

    /**
     * ⚠ wi-admin's **own** 403 is a different answer and must not be swallowed
     * by the same branch: a permission this operator does not hold is not a
     * stale screen, and reloading teaches them the screen is flaky rather than
     * that they are not entitled.
     */
    it('leaves wi-admin’s own permission denial alone', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                category: 'authorization',
                details: { required: 'agents.contracts.manage', mode: 'all' },
            }),
        );
        const warning = watchWarnings();
        const onDone = vi.fn();
        render(
            <SuspendContractDialog
                contract={contractFixture()}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/suspend/i);

        // The form's own error banner is where a denial belongs.
        await screen.findByRole('alert');
        expect(warning).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
    });
});

describe('a 409 the contract moved under', () => {
    /**
     * `CONTRACT_INVALID_TRANSITION` is forwarded at 409 (`conflict`), a category
     * that carries `details` through — so this one *does* arrive with its code,
     * and with the `from` that makes the sentence specific.
     */
    it('names the status the contract is actually in', async () => {
        const warning = watchWarnings();
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: {
                    platformCode: 'CONTRACT_INVALID_TRANSITION',
                    transition: 'suspend',
                    from: 'deactivated',
                    allowedFrom: ['active', 'paused'],
                },
            }),
        );
        const onDone = vi.fn();
        render(
            <SuspendContractDialog
                contract={contractFixture()}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/suspend/i);

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'The contract has moved since you loaded it',
                expect.anything(),
            ),
        );
        expect(warning.mock.calls[0][1]?.description).toMatch(/it is now "deactivated"/i);
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });
});

describe('a termination asked for twice', () => {
    /**
     * ⚠ The code is **`CONTRACT_STATUS_REQUEST_ALREADY_PENDING`**.
     *
     * This dialog compared against `CONTRACT_REQUEST_ALREADY_PENDING` until
     * 2026-09-09 — a name jovi-mall has never declared
     * (`api-doc/jovi-mall/error-codes.ts:1011`) — so the branch never matched and
     * an operator asking twice got a generic failure instead of being told their
     * first attempt had landed.
     */
    it('says a request is already open rather than failing generically', async () => {
        const warning = watchWarnings();
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: {
                    platformCode: 'CONTRACT_STATUS_REQUEST_ALREADY_PENDING',
                    requestId: '665d00112233445566778899',
                },
            }),
        );
        const onDone = vi.fn();
        render(
            <TerminateContractDialog
                contract={contractFixture()}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/terminate/i);

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'A termination request is already open',
                expect.anything(),
            ),
        );
        // The open request is on the record and this screen is not showing it.
        await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    });
});

describe('a termination that only opened a request', () => {
    /**
     * ⚠ **A `200` here does not mean the contract ended.** `contract: null` means
     * the termination was only *requested* — telling an operator a relationship
     * ended while it is still live and still owes somebody money is the failure
     * this branch exists to design out.
     */
    it('reports it as requested, not as terminated', async () => {
        const warning = watchWarnings();
        stubFetch(() =>
            successResponse({
                contract: null,
                pendingRequest: { id: '665d00112233445566778899' },
                blockers: { outstandingCod: 45000, outstandingPayment: 0, clear: false },
            }),
        );
        const onDone = vi.fn();
        render(
            <TerminateContractDialog
                contract={contractFixture()}
                open
                onOpenChange={() => {}}
                onDone={onDone}
            />,
        );

        await submitWithReason(/terminate/i);

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'Termination requested — the contract has not ended',
                expect.anything(),
            ),
        );
        await waitFor(() => expect(onDone).toHaveBeenCalled());
        expect(onDone.mock.calls[0][0]).toMatchObject({ contract: null });
    });
});
