import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { TICKET_TYPES } from '@/types/support.types';

const body = (call: FetchCall) => JSON.parse(call.body as string);

function open() {
    renderWithProviders(
        <CreateTicketDialog open onOpenChange={() => {}} onCreated={() => {}} />,
        { auth: { status: 'authenticated', admin: adminFixture() } },
    );
}

async function fillRequired() {
    await userEvent.type(screen.getByLabelText(/^subject$/i), 'Payout has not arrived');
    await userEvent.type(screen.getByLabelText(/what happened/i), 'Opened on the vendor’s behalf.');
}

describe('the vocabularies are offered, not typed', () => {
    it('offers every one of the 39 ticket types', async () => {
        // Hard-coded from a mirror rather than fetched, because no endpoint
        // serves them and none should — they are jovi-mall's.
        open();
        await userEvent.click(screen.getByLabelText(/^type$/i));

        const options = await screen.findAllByRole('option');
        expect(options.length).toBe(TICKET_TYPES.length);
        expect(TICKET_TYPES.length).toBe(39);
    });

    it('offers importance, and says it cannot be changed later', () => {
        /**
         * ⚠ Importance is the requester's view and is **immutable**; priority is
         * the desk's and is not set on a create at all. Saying so stops an
         * operator reaching for this to escalate something.
         */
        open();

        expect(screen.getByLabelText(/importance/i)).toBeInTheDocument();
        expect(screen.getByText(/cannot be changed afterwards/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/^priority$/i)).not.toBeInTheDocument();
    });
});

describe('the entityId rule wi-admin does not enforce', () => {
    it('asks for no id when the ticket is about nothing in particular', async () => {
        // `OTHER` is the one entity type jovi-mall accepts without an id, so
        // showing an empty required field would invent a rule the API lacks.
        open();

        expect(screen.queryByLabelText(/other id/i)).not.toBeInTheDocument();

        const calls = stubFetch(() => successResponse({ id: 'abc' }));
        await fillRequired();
        await userEvent.click(screen.getByRole('button', { name: /open the ticket/i }));

        const sent = body(calls[calls.length - 1]);
        expect(sent.entityType).toBe('OTHER');
        // Omitted, not sent empty — an empty string is not "no value".
        expect('entityId' in sent).toBe(false);
    });

    it('blocks the submit when an entity type needs an id and has none', async () => {
        /**
         * ⚠ **wi-admin does not check this** — a miss arrives as a
         * `PLATFORM_OPERATION_REJECTED` after the delegated hop rather than as a
         * local `400`. So the dialog is the only thing between the operator and
         * a round trip that was never going to succeed.
         */
        const calls = stubFetch(() => successResponse({ id: 'abc' }));
        open();
        await fillRequired();

        await userEvent.click(screen.getByLabelText(/what it is about/i));
        await userEvent.click(await screen.findByRole('option', { name: /^order$/i }));

        expect(await screen.findByLabelText(/order id/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /open the ticket/i })).toBeDisabled();
        expect(calls).toHaveLength(0);
    });

    it('clears a stale id when switching back to the type that takes none', async () => {
        open();
        await fillRequired();

        await userEvent.click(screen.getByLabelText(/what it is about/i));
        await userEvent.click(await screen.findByRole('option', { name: /^order$/i }));
        await userEvent.type(await screen.findByLabelText(/order id/i), '6612a4f0c1a2b3d4e5f60718');

        await userEvent.click(screen.getByLabelText(/what it is about/i));
        await userEvent.click(await screen.findByRole('option', { name: /^other$/i }));

        const calls = stubFetch(() => successResponse({ id: 'abc' }));
        await userEvent.click(screen.getByRole('button', { name: /open the ticket/i }));

        expect('entityId' in body(calls[calls.length - 1])).toBe(false);
    });
});

describe('attachments are ids, not uploads', () => {
    it('says so, and takes no file input', () => {
        // wi-admin accepts no multipart body on any route.
        open();

        expect(screen.getByText(/file ids, not uploads/i)).toBeInTheDocument();
        expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it('refuses anything that is not a 24-hex id', async () => {
        open();

        await userEvent.type(screen.getByLabelText(/attachments/i), 'not-an-id');

        expect(await screen.findByText(/24 hexadecimal characters/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /attach/i })).toBeDisabled();
    });

    it('stops at five', async () => {
        // ⚠ `fireEvent.change` rather than `userEvent.type`, deliberately: five
        // ids is 120 keystrokes, each one a re-render, and the typed version
        // passed alone and timed out under a full-suite run. A test that only
        // fails under contention measures the machine, not the code — the same
        // reasoning behind this repo's 20 s `testTimeout`. Nothing here is about
        // per-keystroke behaviour, so the whole value is set at once.
        open();

        for (let index = 0; index < 5; index += 1) {
            fireEvent.change(screen.getByLabelText(/attachments/i), {
                target: { value: `6612a4f0c1a2b3d4e5f6071${index}` },
            });
            await userEvent.click(screen.getByRole('button', { name: /attach/i }));
        }

        expect(screen.getByLabelText(/attachments/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: /attach/i })).toBeDisabled();
    });

    it('sends no attachments key at all when none were named', async () => {
        const calls = stubFetch(() => successResponse({ id: 'abc' }));
        open();
        await fillRequired();
        await userEvent.click(screen.getByRole('button', { name: /open the ticket/i }));

        expect('attachments' in body(calls[calls.length - 1])).toBe(false);
    });
});

describe('what the body carries', () => {
    it('does not name the creating administrator', async () => {
        /**
         * ⚠ It is read from the caller's own `admin_accounts` row server-side. A
         * client-supplied name would let an administrator record somebody else
         * as handling a ticket; a client-supplied tier would decide who may
         * subsequently see it.
         */
        const calls = stubFetch(() => successResponse({ id: 'abc' }));
        open();
        await fillRequired();
        await userEvent.click(screen.getByRole('button', { name: /open the ticket/i }));

        const sent = body(calls[calls.length - 1]);
        expect(sent).not.toHaveProperty('createdBy');
        expect(sent).not.toHaveProperty('administrator');
        expect(sent).not.toHaveProperty('tier');
        expect(sent).toEqual({
            subject: 'Payout has not arrived',
            description: 'Opened on the vendor’s behalf.',
            type: 'GENERAL_SUPPORT',
            importance: 'medium',
            entityType: 'OTHER',
        });
    });
});
