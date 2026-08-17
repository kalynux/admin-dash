import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditVendorSettingsDialog } from '@/components/vendors/EditVendorSettingsDialog';
import { adminFixture, vendorDetailFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { VendorDetail } from '@/types/vendors.types';

function open(vendor: VendorDetail = vendorDetailFixture(), onUpdated = vi.fn()) {
    renderWithProviders(
        <EditVendorSettingsDialog
            vendor={vendor}
            open
            onOpenChange={() => {}}
            onUpdated={onUpdated}
        />,
        { auth: { status: 'authenticated', admin: adminFixture() } },
    );
    return onUpdated;
}

const body = (call: FetchCall) => JSON.parse(call.body as string);

describe('what it offers', () => {
    /**
     * The read returns four settings and the PATCH accepts three. The fourth is
     * rejected **by name** by a strict schema, so offering it would buy a 400.
     */
    it('does not offer the expiry notice, which is the vendor’s own', () => {
        open();

        expect(screen.getByLabelText(/cancel unpaid orders after/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/expiry/i)).not.toBeInTheDocument();
    });

    it('says commission is not one of these', () => {
        open();

        // The permission's own catalogue summary used to claim otherwise.
        expect(screen.getByText(/commission rate lives on their billing plan/i)).toBeInTheDocument();
    });

    it('reads an absent cap as an empty box, not as zero', () => {
        open(); // fixture has `autoRedirectThresholdAmount: null`

        expect(screen.getByLabelText(/redirect cap/i)).toHaveValue('');
        expect(screen.getByText(/empty clears the cap/i)).toBeInTheDocument();
    });
});

describe('what it sends', () => {
    /**
     * Absent means "leave alone" on a strict body. Resending an unchanged value
     * would write an audit row claiming a change that did not happen, on a surface
     * where every mutation is recorded before it answers.
     */
    it('sends only the fields that actually changed', async () => {
        const calls = stubFetch(() =>
            successResponse({
                autoCancelUnpaidDays: 7,
                autoRedirectOrdersToAgency: false,
                autoRedirectThresholdAmount: null,
            }),
        );
        open();

        const days = screen.getByLabelText(/cancel unpaid orders after/i);
        await userEvent.clear(days);
        await userEvent.type(days, '7');
        await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(body(calls[0])).toEqual({ autoCancelUnpaidDays: 7 });
    });

    it('sends null to clear the cap rather than omitting the key', async () => {
        const calls = stubFetch(() =>
            successResponse({
                autoCancelUnpaidDays: 3,
                autoRedirectOrdersToAgency: false,
                autoRedirectThresholdAmount: null,
            }),
        );
        open(
            vendorDetailFixture({
                settings: {
                    autoRedirectOrdersToAgency: false,
                    autoRedirectThresholdAmount: 500_000,
                    autoCancelUnpaidDays: 3,
                    notifyDaysBeforeExpiry: 7,
                },
            }),
        );

        await userEvent.clear(screen.getByLabelText(/redirect cap/i));
        await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        // Omitting it would leave the cap in place; `null` removes it.
        expect(body(calls[0])).toEqual({ autoRedirectThresholdAmount: null });
    });

    /** An empty body is a `400 "Nothing to update"`. Saying so costs no round trip. */
    it('makes no request when nothing changed', async () => {
        const calls = stubFetch(() => {
            throw new Error('should not have been called');
        });
        const onUpdated = open();

        await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

        await waitFor(() => expect(onUpdated).toHaveBeenCalled());
        expect(calls).toHaveLength(0);
    });
});

describe('what it refuses before the wire', () => {
    it('rejects a cancellation window outside the platform’s own bounds', async () => {
        const calls = stubFetch(() => {
            throw new Error('should not have been called');
        });
        open();

        const days = screen.getByLabelText(/cancel unpaid orders after/i);
        await userEvent.clear(days);
        await userEvent.type(days, '120');
        await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

        expect(await screen.findByText(/between 1 and 90 days/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('rejects a negative cap', async () => {
        const calls = stubFetch(() => {
            throw new Error('should not have been called');
        });
        open();

        await userEvent.type(screen.getByLabelText(/redirect cap/i), '-5');
        await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

        expect(await screen.findByText(/cannot be negative/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});
