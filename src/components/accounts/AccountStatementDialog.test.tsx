import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountStatementButton } from '@/components/accounts/AccountStatementDialog';
import { heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';

const OWNER = '6650aa11bb22cc33dd44ee55';

function renderButton(held: ReadonlySet<string>) {
    return renderWithProviders(
        <AccountStatementButton ownerType="vendor" ownerId={OWNER} timeZone="Africa/Douala" />,
        { permissions: { status: 'ready', held: new Set(held) } },
    );
}

async function openAndChooseEmail() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /statement/i }));
    await user.click(screen.getByRole('radio', { name: /email to the account holder/i }));
    return user;
}

function statementBody(index: number, calls: { body?: string }[]) {
    return JSON.parse(calls[index].body!) as Record<string, unknown>;
}

beforeEach(() => {
    // jsdom has neither; the download path calls both.
    URL.createObjectURL = vi.fn(() => 'blob:statement');
    URL.revokeObjectURL = vi.fn();
    // jsdom cannot navigate, and the saved file is not what these tests are about.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AccountStatementButton', () => {
    it('is offered to Support — every tier holds money.statements.send', () => {
        renderButton(heldFixture(3));
        expect(screen.getByRole('button', { name: /statement/i })).toBeInTheDocument();
    });

    it('is hidden without the permission', () => {
        renderButton(new Set(['vendors.read']));
        expect(screen.queryByRole('button', { name: /statement/i })).not.toBeInTheDocument();
    });

    it('confirms an email with the masked recipient, and sends no recipient', async () => {
        const calls = stubFetch(() =>
            successResponse({
                delivery: 'email',
                fileName: 'statement-vendor-44ee55-2026-09-01-to-2026-09-27.xlsx',
                sent: true,
                recipient: 'j***@example.com',
                bytes: 48213,
            }),
        );
        renderButton(heldFixture(3));
        const user = await openAndChooseEmail();

        await user.click(screen.getByRole('button', { name: /email statement/i }));

        expect(await screen.findByText(/emailed to j\*\*\*@example\.com/i)).toBeInTheDocument();
        const body = statementBody(0, calls);
        expect(Object.keys(body).sort()).toEqual(['delivery', 'format', 'from', 'to']);
        expect(body.delivery).toBe('email');
    });

    it.each([
        ['STATEMENT_RECIPIENT_MISSING'],
        ['STATEMENT_RECIPIENT_UNVERIFIED'],
    ])('turns %s into "no verified email, download instead"', async (platformCode) => {
        const calls = stubFetch((call) =>
            JSON.parse(call.body!).delivery === 'email'
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'conflict',
                      details: { platformCode },
                  })
                : new Response('PK', { status: 200 }),
        );
        renderButton(heldFixture(3));
        const user = await openAndChooseEmail();

        await user.click(screen.getByRole('button', { name: /email statement/i }));
        expect(await screen.findByText(/no verified email address/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /download instead/i }));

        await waitFor(() => expect(calls).toHaveLength(2));
        // The same period and format, as a download.
        expect(statementBody(1, calls)).toEqual({ ...statementBody(0, calls), delivery: 'download' });
        await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    });

    it('turns a 413 into "too large, download or shorten the period"', async () => {
        stubFetch(() =>
            errorResponse(413, 'STATEMENT_TOO_LARGE_TO_EMAIL', {
                category: 'validation',
                details: { bytes: 9_000_000, maxBytes: 8_388_608 },
            }),
        );
        renderButton(heldFixture(3));
        const user = await openAndChooseEmail();

        await user.click(screen.getByRole('button', { name: /email statement/i }));

        expect(await screen.findByText(/too large to email/i)).toBeInTheDocument();
        expect(screen.getByText(/choose a shorter period/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /download instead/i })).toBeInTheDocument();
    });

    it('refuses a period over 366 days before asking the server', async () => {
        const calls = stubFetch(() => successResponse(null));
        renderButton(heldFixture(3));
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /statement/i }));

        const from = screen.getByLabelText(/first day/i);
        await user.clear(from);
        await user.type(from, '2025-01-01');
        const to = screen.getByLabelText(/last day/i);
        await user.clear(to);
        await user.type(to, '2026-01-02');
        await user.click(screen.getByRole('button', { name: /download statement/i }));

        expect(await screen.findByText(/at most 366 days/i, { selector: '[role="alert"]' }))
            .toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});
