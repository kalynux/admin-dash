import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TicketFollowersPanel } from '@/components/support/TicketFollowersPanel';
import { heldFixture, userFixture } from '@/test/fixtures';
import { ticketDetailFixture, ticketFollowerFixture } from '@/test/support-fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { TicketDetail } from '@/types/support.types';
import type { User } from '@/types/users.types';

const TICKET_ID = '66a1b2c3d4e5f60718293a4b';
const VENDOR_USER_ID = '6640aa11bb22cc33dd44ee01';
const NEW_USER_ID = '66700000000000000000aa01';

const urlOf = (call: FetchCall) => new URL(call.url, 'http://localhost');

/**
 * Renders the panel and answers its three requests: the user search, the add
 * and the remove. Anything else throws — in particular **a `GET` of the
 * ticket**, because both writes answer the refreshed detail and the panel must
 * not re-read it.
 */
function panel(
    options: {
        ticket?: TicketDetail;
        held?: ReadonlySet<string>;
        users?: User[];
        onWrite?: (call: FetchCall) => Response;
    } = {},
) {
    const {
        ticket = ticketDetailFixture(),
        held = heldFixture(1),
        users = [userFixture({ id: NEW_USER_ID, roles: ['vendor'] })],
        onWrite = () => successResponse(ticket),
    } = options;

    const onTicket = vi.fn();
    const onStale = vi.fn();

    const calls = stubFetch((call) => {
        const url = urlOf(call);
        if (call.method === 'GET' && url.pathname === '/api/v1/users') {
            return successResponse(users, {
                meta: { total: users.length, page: 1, limit: 10, pages: 1 },
            });
        }
        if (url.pathname.startsWith(`/api/v1/support/tickets/${TICKET_ID}/followers`)) {
            return onWrite(call);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(
        <TicketFollowersPanel
            ticket={ticket}
            timeZone="Africa/Douala"
            onTicket={onTicket}
            onStale={onStale}
        />,
        { permissions: { held } },
    );

    return { calls, onTicket, onStale, ticket };
}

const writes = (calls: FetchCall[]) => calls.filter((call) => call.method !== 'GET');

async function searchFor(user: ReturnType<typeof userEvent.setup>, term: string) {
    await user.click(screen.getByRole('button', { name: /add follower/i }));
    await user.type(await screen.findByRole('searchbox', { name: /find the user/i }), term);
}

describe('the list', () => {
    it('shows each follower as a person, with why and since when', async () => {
        panel();

        const rows = within(screen.getByRole('list', { name: 'Followers' })).getAllByRole(
            'listitem',
        );
        expect(rows).toHaveLength(3);

        // The customer who opened it.
        expect(within(rows[0]).getByText('Awa Ndiaye')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Customer')).toBeInTheDocument();
        expect(within(rows[0]).getByText('+237600000001')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Opened it')).toBeInTheDocument();
        expect(within(rows[0]).getByText(/^Added /)).toBeInTheDocument();

        // The agency it is assigned to — business first, person as contact.
        expect(within(rows[1]).getByText('Rapide Livraison')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Contact: Jean Mbarga')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Assigned')).toBeInTheDocument();

        // The order's vendor, added by the platform.
        expect(within(rows[2]).getByText('Chez Paul')).toBeInTheDocument();
        expect(within(rows[2]).getByText('Order party')).toBeInTheDocument();
    });

    /** A deleted or closed account: the row stays, with the id and the role. */
    it('keeps a follower whose account resolves to nothing', async () => {
        panel({
            ticket: ticketDetailFixture({
                followers: [
                    ticketFollowerFixture({
                        role: 'agent',
                        userId: '6630aa11bb22cc33dd44ee03',
                        profileId: null,
                        name: null,
                        businessName: null,
                        phone: null,
                        email: null,
                        source: null,
                        addedAt: null,
                    }),
                ],
            }),
        });

        const row = within(screen.getByRole('list', { name: 'Followers' })).getByRole('listitem');
        expect(within(row).getByText('Agent')).toBeInTheDocument();
        expect(within(row).getByText('6630aa11bb22cc33dd44ee03')).toBeInTheDocument();
        // A row older than 2026-10-09 recorded no reason, and says so.
        expect(within(row).getByText('Reason not recorded')).toBeInTheDocument();
        expect(within(row).getByText('Date not recorded')).toBeInTheDocument();
    });

    it('does not read "not told" as "nobody follows"', () => {
        // A service older than this round sends no `followers` key at all.
        const { followers: _omitted, ...older } = ticketDetailFixture();
        void _omitted;
        panel({ ticket: older });

        expect(screen.getByText(/does not list a ticket.s followers/i)).toBeInTheDocument();
        expect(screen.queryByText(/nobody follows/i)).not.toBeInTheDocument();
    });
});

describe('who may be removed', () => {
    /** jovi-mall refuses the creator, the current assignee and an administrator. */
    it('offers Remove on the order party only', () => {
        panel();

        const rows = within(screen.getByRole('list', { name: 'Followers' })).getAllByRole(
            'listitem',
        );
        expect(within(rows[0]).queryByRole('button', { name: /remove/i })).toBeNull();
        expect(within(rows[1]).queryByRole('button', { name: /remove/i })).toBeNull();
        expect(within(rows[2]).getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('never offers it on an administrator follower', () => {
        panel({
            ticket: ticketDetailFixture({
                followers: [
                    ticketFollowerFixture({
                        role: 'admin',
                        userId: '66aa000000000000000000ff',
                        profileId: null,
                        name: 'Solange N.',
                        businessName: null,
                        phone: null,
                        email: null,
                        source: 'admin',
                    }),
                ],
            }),
        });

        expect(screen.getByText('Solange N.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^remove/i })).toBeNull();
    });
});

describe('who may manage followers', () => {
    /**
     * ⚠ Every tier, on any ticket that opens. The two routes skip the
     * assignment lock, so a ticket this administrator can neither claim nor
     * assign still offers both controls — to Support as much as anyone.
     */
    it('shows both controls to Support on a ticket somebody else holds', () => {
        panel({
            held: heldFixture(3),
            ticket: ticketDetailFixture({
                availableActions: { claim: false, assignableTiers: [] },
            }),
        });

        expect(screen.getByRole('button', { name: /add follower/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^remove/i })).toBeInTheDocument();
    });

    it.each([1, 2, 3] as const)('shows both controls to tier %i', (tier) => {
        panel({ held: heldFixture(tier) });

        expect(screen.getByRole('button', { name: /add follower/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^remove/i })).toBeInTheDocument();
    });

    it('shows the list and no control without the permission', () => {
        panel({ held: new Set(['support.tickets.read', 'users.read']) });

        expect(screen.getByText('Chez Paul')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /add follower/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^remove/i })).toBeNull();
    });
});

describe('adding a follower', () => {
    it('searches users, then sends the chosen id with the role they hold', async () => {
        const user = userEvent.setup();
        const { calls, onTicket, onStale, ticket } = panel();

        await searchFor(user, '+237670');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));

        // One role on the account, so there is nothing to choose.
        expect(screen.getByText(/they will follow as/i)).toHaveTextContent('a vendor');
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        await waitFor(() => expect(onTicket).toHaveBeenCalledTimes(1));

        const search = calls.find((call) => urlOf(call).pathname === '/api/v1/users');
        expect(urlOf(search!).searchParams.get('search')).toBe('+237670');
        // No filter chosen, so no `role` parameter — not an empty one.
        expect(urlOf(search!).searchParams.has('role')).toBe(false);

        const [write] = writes(calls);
        expect(write.method).toBe('POST');
        expect(urlOf(write).pathname).toBe(`/api/v1/support/tickets/${TICKET_ID}/followers`);
        expect(JSON.parse(write.body ?? '{}')).toEqual({ userId: NEW_USER_ID, role: 'vendor' });

        // ⚠ The ticket is replaced from the response. Nothing is re-read.
        expect(onTicket).toHaveBeenCalledWith(ticket);
        expect(onStale).not.toHaveBeenCalled();
    });

    it('sends the role that was filtered on', async () => {
        const user = userEvent.setup();
        const { calls, onTicket } = panel({
            users: [userFixture({ id: NEW_USER_ID, roles: ['customer', 'agent'] })],
        });

        await user.click(screen.getByRole('button', { name: /add follower/i }));
        await user.click(await screen.findByRole('radio', { name: 'Agents' }));
        await user.type(screen.getByRole('searchbox', { name: /find the user/i }), 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        await waitFor(() => expect(onTicket).toHaveBeenCalled());

        const searches = calls.filter((call) => urlOf(call).pathname === '/api/v1/users');
        expect(urlOf(searches[searches.length - 1]).searchParams.get('role')).toBe('agent');
        expect(JSON.parse(writes(calls)[0].body ?? '{}')).toEqual({
            userId: NEW_USER_ID,
            role: 'agent',
        });
    });

    it('asks which role when the account holds several, and will not send without one', async () => {
        const user = userEvent.setup();
        const { calls, onTicket } = panel({
            users: [userFixture({ id: NEW_USER_ID, roles: ['customer', 'agent'] })],
        });

        await searchFor(user, 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));

        const submit = screen.getByRole('button', { name: /^add follower$/i });
        expect(submit).toBeDisabled();

        const followAs = screen.getByRole('radiogroup', { name: 'Follow as' });
        // Only the roles the account holds are offered.
        expect(within(followAs).getAllByRole('radio')).toHaveLength(2);
        await user.click(within(followAs).getByRole('radio', { name: 'Customer' }));
        await user.click(submit);

        await waitFor(() => expect(onTicket).toHaveBeenCalled());
        expect(JSON.parse(writes(calls)[0].body ?? '{}').role).toBe('customer');
    });

    /** Adding somebody who already follows is a 200 that changes nothing. */
    it('marks a candidate who already follows, and does not offer them', async () => {
        const user = userEvent.setup();
        panel({ users: [userFixture({ id: VENDOR_USER_ID, roles: ['vendor'] })] });

        await searchFor(user, 'amina');

        const candidate = await screen.findByRole('button', { name: /amina@example\.cm/i });
        expect(candidate).toBeDisabled();
        expect(within(candidate).getByText('Already follows')).toBeInTheDocument();
    });

    it('says the search reads identifiers, not names, when nothing matches', async () => {
        const user = userEvent.setup();
        panel({ users: [] });

        await searchFor(user, 'Paul');

        expect(await screen.findByText(/no user matches that/i)).toHaveTextContent(/not names/i);
    });

    /**
     * `422 TICKET_FOLLOWER_ROLE_MISMATCH`, read off `details.platformCode`,
     * with `details.roles` naming what they do hold.
     */
    it('names the role the user does not hold, and the ones they do', async () => {
        const user = userEvent.setup();
        const { onTicket } = panel({
            onWrite: () =>
                errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'business_rule',
                    message: 'This user does not hold the vendor role',
                    details: {
                        platformCode: 'TICKET_FOLLOWER_ROLE_MISMATCH',
                        roles: ['customer', 'agent'],
                    },
                }),
        });

        await searchFor(user, 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This user is not a vendor.');
        expect(alert).toHaveTextContent('They hold: Customer, Agent.');
        // The platform's list replaces the search row's: pick from what they hold.
        expect(
            within(screen.getByRole('radiogroup', { name: 'Follow as' })).getAllByRole('radio'),
        ).toHaveLength(2);
        expect(onTicket).not.toHaveBeenCalled();
    });

    it('still explains the mismatch when the roles do not arrive', async () => {
        const user = userEvent.setup();
        panel({
            onWrite: () =>
                errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'business_rule',
                    details: { platformCode: 'TICKET_FOLLOWER_ROLE_MISMATCH' },
                }),
        });

        await searchFor(user, 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            /this user is not a vendor.*nothing was added/i,
        );
    });

    it('says no user has the id on USER_NOT_FOUND', async () => {
        const user = userEvent.setup();
        panel({
            onWrite: () =>
                errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'not_found',
                    message: 'No platform user has this id',
                    details: { platformCode: 'USER_NOT_FOUND' },
                }),
        });

        await searchFor(user, 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('No user has this id.');
    });

    it('says the ticket is gone or out of view on TICKET_NOT_FOUND', async () => {
        const user = userEvent.setup();
        panel({
            onWrite: () =>
                errorResponse(404, 'TICKET_NOT_FOUND', {
                    category: 'not_found',
                    message: 'Ticket not found',
                }),
        });

        await searchFor(user, 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        // The dialog stays open on the refusal.
        expect(screen.getByRole('searchbox', { name: /find the user/i })).toBeInTheDocument();
    });

    /** A service older than 2026-10-10 answers `data: undefined`. */
    it('re-reads instead when the answer is not a ticket', async () => {
        const user = userEvent.setup();
        const { onTicket, onStale } = panel({ onWrite: () => successResponse(null) });

        await searchFor(user, 'amina');
        await user.click(await screen.findByRole('button', { name: /amina@example\.cm/i }));
        await user.click(screen.getByRole('button', { name: /^add follower$/i }));

        await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
        expect(onTicket).not.toHaveBeenCalled();
    });
});

describe('removing a follower', () => {
    async function removeVendor(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole('button', { name: /^remove/i }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /remove follower/i }));
        return dialog;
    }

    it('deletes by the follower’s user id and replaces the ticket from the answer', async () => {
        const user = userEvent.setup();
        const after = ticketDetailFixture({ followers: [] });
        const { calls, onTicket, onStale } = panel({ onWrite: () => successResponse(after) });

        await removeVendor(user);

        await waitFor(() => expect(onTicket).toHaveBeenCalledWith(after));
        const [write] = writes(calls);
        expect(write.method).toBe('DELETE');
        expect(urlOf(write).pathname).toBe(
            `/api/v1/support/tickets/${TICKET_ID}/followers/${VENDOR_USER_ID}`,
        );
        expect(onStale).not.toHaveBeenCalled();
    });

    it('warns that an order party is not put back automatically', async () => {
        const user = userEvent.setup();
        panel();

        await user.click(screen.getByRole('button', { name: /^remove/i }));

        expect(await screen.findByRole('dialog')).toHaveTextContent(
            /does not put them back on its own/i,
        );
    });

    /**
     * 🔴 A forwarded 403 carries NO `platformCode` — wi-admin's `authorization`
     * allowlist drops it — so the rule has to be recognised from the bare
     * refusal, not from `TICKET_ACCESS_DENIED`.
     */
    it('says who cannot be removed on a bare 403, and re-reads the list', async () => {
        const user = userEvent.setup();
        const { onTicket, onStale } = panel({
            onWrite: () =>
                errorResponse(403, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'authorization',
                    message: 'Cannot remove current assignee from followers',
                }),
        });

        const dialog = await removeVendor(user);

        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            'The creator, the current assignee and administrators cannot be removed.',
        );
        expect(onStale).toHaveBeenCalledTimes(1);
        expect(onTicket).not.toHaveBeenCalled();
        // Nothing left to retry.
        expect(within(dialog).queryByRole('button', { name: /remove follower/i })).toBeNull();
    });

    /** `TICKET_NOT_FOUND` as a platformCode is the FOLLOWER row, not the ticket. */
    it('treats "no longer follows" as done, and re-reads', async () => {
        const user = userEvent.setup();
        const { onStale } = panel({
            onWrite: () =>
                errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                    category: 'not_found',
                    message: 'Follower not found',
                    details: { platformCode: 'TICKET_NOT_FOUND' },
                }),
        });

        await removeVendor(user);

        await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('keeps the dialog open with the reason on any other failure', async () => {
        const user = userEvent.setup();
        const { onStale } = panel({
            onWrite: () =>
                errorResponse(404, 'TICKET_NOT_FOUND', {
                    category: 'not_found',
                    message: 'Ticket not found',
                }),
        });

        const dialog = await removeVendor(user);

        expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /remove follower/i })).toBeEnabled();
        expect(onStale).not.toHaveBeenCalled();
    });
});
