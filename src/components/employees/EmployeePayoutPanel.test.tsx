import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EmployeePayoutPanel } from '@/components/employees/EmployeePayoutPanel';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { EmployeePayoutMethod, EmployeeRecord } from '@/types/employees.types';

function recordFixture(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
    return {
        adminId: '6660112233445566778899aa',
        accountStatus: 'pending',
        fullName: 'Aminata Ngo Bell',
        dateOfBirth: null,
        placeOfBirth: null,
        gender: null,
        nationality: null,
        motherFullName: null,
        fatherFullName: null,
        phones: [],
        relatives: [],
        idNumber: null,
        idType: null,
        idExpiresOn: null,
        homeAddress: null,
        documents: [],
        payoutMethods: [],
        employment: null,
        readiness: {
            ready: false,
            gaps: [{ code: 'payout_missing', section: 'payout', message: 'Add a payout destination' }],
        },
        lastSelfUpdateAt: null,
        createdAt: '2026-09-20T08:00:00.000Z',
        updatedAt: '2026-09-20T08:00:00.000Z',
        ...overrides,
    };
}

const SAVED: EmployeePayoutMethod = {
    method: 'mobile_money',
    isPreferred: true,
    mobileMoney: {
        provider: 'MTN Mobile Money',
        phoneNumberMasked: '•••••••••1122',
        accountName: 'Aminata Ngo Bell',
    },
    bank: null,
    card: null,
};

describe('EmployeePayoutPanel', () => {
    it('lets a new employee add the destination the activation gate asks for', async () => {
        const user = userEvent.setup();
        const calls = stubFetch(() =>
            successResponse(recordFixture({ payoutMethods: [SAVED], readiness: { ready: true, gaps: [] } })),
        );
        let saved: EmployeeRecord | null = null;

        renderWithProviders(
            <EmployeePayoutPanel record={recordFixture()} onChange={(next) => (saved = next)} />,
        );

        expect(screen.getByText(/no payout destination yet/i)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /add a payout destination/i }));
        await user.type(screen.getByLabelText('Mobile money number 1'), '+237670001122');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('PATCH');
        expect(calls[0].url).toMatch(/\/employees\/me$/);
        /*
          `payoutMethods` alone — the schema is `.strict()` and every other key
          would re-state fields this panel never showed — in the write's
          snake_case, with the account name prefilled from the LEGAL name.
        */
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            payoutMethods: [
                {
                    method: 'mobile_money',
                    mobile_money: {
                        provider: 'MTN Mobile Money',
                        phone_number: '+237670001122',
                        account_name: 'Aminata Ngo Bell',
                    },
                },
            ],
        });
        expect(saved).not.toBeNull();
    });

    it('refuses a number without its country code before sending anything', async () => {
        const user = userEvent.setup();
        const calls = stubFetch(() => successResponse(recordFixture()));

        renderWithProviders(<EmployeePayoutPanel record={recordFixture()} onChange={() => {}} />);

        await user.click(screen.getByRole('button', { name: /add a payout destination/i }));
        await user.type(screen.getByLabelText('Mobile money number 1'), '670001122');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.getByText(/starting with \+237/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('shows a saved destination masked, and warns that replacing means re-entering it', async () => {
        const user = userEvent.setup();
        stubFetch(() => successResponse(recordFixture()));

        renderWithProviders(
            <EmployeePayoutPanel record={recordFixture({ payoutMethods: [SAVED] })} onChange={() => {}} />,
        );

        expect(screen.getByText('•••••••••1122')).toBeInTheDocument();
        expect(screen.getByText('Preferred')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Replace' }));
        expect(screen.getByText(/saving replaces every destination above/i)).toBeInTheDocument();
        // Starts blank: the stored number cannot be read back, so it cannot be prefilled.
        expect(screen.getByLabelText('Mobile money number 1')).toHaveValue('');
    });
});
