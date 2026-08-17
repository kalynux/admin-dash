import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PayoutDestinationReveal } from '@/components/money/PayoutDestinationReveal';
import {
    maskedDestinationFixture,
    revealedCardDestinationFixture,
    revealedDestinationFixture,
} from '@/test/money-fixtures';
import { heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

/**
 * The disclosure endpoint writes an audit row before it reads the value, so the
 * assertions that matter most here are about **how many requests fire, and
 * when** — not about rendering. A false row against an operator's name is a
 * worse defect than a broken layout.
 */

const PAYOUT_ID = '66a2aabbccddeeff00112233';

function destinationCalls(calls: FetchCall[]) {
    return calls.filter((call) => call.url.includes('/destination'));
}

function render(
    destination = maskedDestinationFixture(),
    permissions?: Parameters<typeof renderWithProviders>[1],
) {
    return renderWithProviders(
        <PayoutDestinationReveal
            payoutId={PAYOUT_ID}
            destination={destination}
            timeZone="Africa/Douala"
        />,
        permissions,
    );
}

describe('before any action is taken', () => {
    it('fires no request when it renders', async () => {
        const calls = stubFetch(() => successResponse(revealedDestinationFixture()));

        render();

        expect(await screen.findByText(/MTN/)).toBeInTheDocument();
        expect(destinationCalls(calls)).toHaveLength(0);
    });

    it('shows the provider and account name, and no digits', () => {
        stubFetch(() => successResponse(revealedDestinationFixture()));

        render();

        expect(screen.getByText(/Nadège Mbarga/)).toBeInTheDocument();
        expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
        expect(screen.queryByText('+237677003456')).not.toBeInTheDocument();
    });

    it('fires no request when the confirm is merely opened', async () => {
        // Opening a dialog is not consent to being on the record.
        const calls = stubFetch(() => successResponse(revealedDestinationFixture()));
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));

        expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
        expect(destinationCalls(calls)).toHaveLength(0);
    });

    it('fires no request when the confirm is cancelled', async () => {
        const calls = stubFetch(() => successResponse(revealedDestinationFixture()));
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /cancel/i }));

        expect(destinationCalls(calls)).toHaveLength(0);
    });

    it('offers no reveal at all without the permission', () => {
        stubFetch(() => successResponse(revealedDestinationFixture()));

        render(maskedDestinationFixture(), {
            permissions: { held: heldFixture(3) },
        });

        expect(
            screen.queryByRole('button', { name: /reveal account number/i }),
        ).not.toBeInTheDocument();
    });

    it('offers no reveal on a payout with no destination on file', () => {
        // Nothing to disclose, so an audit row would record a disclosure that
        // disclosed nothing.
        stubFetch(() => successResponse(revealedDestinationFixture()));

        render(null as never);

        expect(
            screen.queryByRole('button', { name: /reveal account number/i }),
        ).not.toBeInTheDocument();
        expect(screen.getByText(/predates the destination snapshot/i)).toBeInTheDocument();
    });
});

describe('confirming the disclosure', () => {
    it('issues exactly one request', async () => {
        const calls = stubFetch(() => successResponse(revealedDestinationFixture()));
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /reveal and record/i }));

        expect(await screen.findByText('+237677003456')).toBeInTheDocument();
        expect(destinationCalls(calls)).toHaveLength(1);
    });

    it('shows the number, the masked form and that it was recorded', async () => {
        stubFetch(() => successResponse(revealedDestinationFixture()));
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /reveal and record/i }));

        expect(await screen.findByText('+237677003456')).toBeInTheDocument();
        expect(screen.getByText('••••3456')).toBeInTheDocument();
        expect(screen.getByText(/this is recorded/i)).toBeInTheDocument();
    });

    it('reports a card as disclosed with nothing to give, not as a failure', async () => {
        /*
         * `revealed: true` with every `full` member null. A component that
         * inferred disclosure from `full` would render this as an error.
         */
        stubFetch(() => successResponse(revealedCardDestinationFixture()));
        const user = userEvent.setup();

        render(maskedDestinationFixture({ method: 'card' }));
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /reveal and record/i }));

        expect(
            await screen.findByText(/nothing further to give/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/still on the record/i)).toBeInTheDocument();
        expect(screen.queryByText(/could not/i)).not.toBeInTheDocument();
    });

    it('hides the number again without claiming to un-record it', async () => {
        stubFetch(() => successResponse(revealedDestinationFixture()));
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /reveal and record/i }));
        expect(await screen.findByText('+237677003456')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /hide/i }));

        await waitFor(() =>
            expect(screen.queryByText('+237677003456')).not.toBeInTheDocument(),
        );
    });
});

describe('failures', () => {
    it('renders a 422 as an answer rather than an error state', async () => {
        // The payout exists and carries no snapshot — a legacy row an operator
        // resolves by asking the beneficiary, not a fault.
        stubFetch(() =>
            errorResponse(422, 'PAYOUT_DESTINATION_ABSENT', {
                message: 'This payout carries no destination',
                category: 'business_rule',
            }),
        );
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /reveal and record/i }));

        expect(
            await screen.findByText(/no account number is recorded against this payout/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/the attempt is on the record/i)).toBeInTheDocument();
    });

    it('states that nothing was disclosed when the service is unavailable', async () => {
        // The audit row commits first, so a failure means nothing left the
        // database. An operator must not assume a leak.
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'The platform is unavailable',
                category: 'external_service',
            }),
        );
        const user = userEvent.setup();

        render();
        await user.click(screen.getByRole('button', { name: /reveal account number/i }));
        await user.click(await screen.findByRole('button', { name: /reveal and record/i }));

        expect(await screen.findByText(/nothing was disclosed/i)).toBeInTheDocument();
    });
});
