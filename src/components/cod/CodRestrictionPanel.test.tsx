import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CodRestrictionPanel } from '@/components/cod/CodRestrictionPanel';
import { notify } from '@/lib/notify';
import {
    getAgencyCodRestriction,
    liftAgencyCodRestriction,
    restrictAgencyCod,
} from '@/services/agencies.service';
import {
    getUserCodRestriction,
    liftUserCodRestriction,
    restrictUserCod,
} from '@/services/users.service';
import {
    COD_AGENCY_ID,
    COD_CUSTOMER_USER_ID,
    NOT_RESTRICTED,
    agencyCodReportFixture,
    codRestrictionFixture,
    customerCodReportFixture,
} from '@/test/cod-restriction-fixtures';
import { adminFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { CodRestriction, CodRestrictionReport } from '@/types/cod-restriction.types';

/**
 * The administrator's cash-on-delivery switch (2026-10-10), on the customer
 * mount unless a test says otherwise — both mounts answer the same body and
 * share this panel.
 *
 * What is pinned is what a reasonable change gets backwards: the reason is
 * required to **lift** as well as to restrict, the body is `{ reason }` and
 * nothing else, a stale `409` is a re-read and not a retry, and after a
 * `502`/`503` the state is read back before the button is offered again.
 */
const CAN_WRITE = new Set(['users.read', 'users.cod.restrict']);
const SUPPORT = new Set(['users.read']);

const RESTRICT = { name: /^restrict cash on delivery$/i };
const LIFT = { name: /^lift restriction$/i };
const PATH = `/users/${COD_CUSTOMER_USER_ID}/cod-restriction`;

afterEach(() => {
    vi.restoreAllMocks();
});

function renderPanel({
    restriction = null,
    held = CAN_WRITE,
    offerWrite,
}: {
    restriction?: CodRestriction | null;
    held?: Set<string>;
    offerWrite?: boolean;
} = {}) {
    const onChanged = vi.fn<(report: CodRestrictionReport) => void>();
    renderWithProviders(
        <CodRestrictionPanel
            subject="customer"
            subjectName="Amina B."
            restriction={restriction}
            permission="users.cod.restrict"
            timeZone="Africa/Douala"
            offerWrite={offerWrite}
            actions={{
                read: () => getUserCodRestriction(COD_CUSTOMER_USER_ID),
                restrict: (body) => restrictUserCod(COD_CUSTOMER_USER_ID, body),
                lift: (body) => liftUserCodRestriction(COD_CUSTOMER_USER_ID, body),
            }}
            onChanged={onChanged}
        />,
        {
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
    return { onChanged };
}

/** Open the dialog for the offered direction, type a reason, and submit. */
async function submit(button: { name: RegExp }, reason: string) {
    await userEvent.click(screen.getByRole('button', button));
    const dialog = await screen.findByRole('dialog');
    if (reason) await userEvent.type(within(dialog).getByRole('textbox'), reason);
    await userEvent.click(within(dialog).getByRole('button', button));
    return dialog;
}

const unchanged = () =>
    errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
        category: 'conflict',
        message: 'Cash on delivery is already restricted',
        details: { platformCode: 'COD_RESTRICTION_UNCHANGED' },
    });

describe('what it shows', () => {
    it('says a customer is not restricted, and offers to restrict', () => {
        stubFetch(() => {
            throw new Error('the state is on the page — no request is needed');
        });
        renderPanel();

        expect(screen.getByText('Not restricted')).toBeInTheDocument();
        expect(screen.getByRole('button', RESTRICT)).toBeInTheDocument();
        expect(screen.queryByRole('button', LIFT)).not.toBeInTheDocument();
    });

    it('shows who restricted, when, and the reason labelled internal', () => {
        renderPanel({ restriction: codRestrictionFixture() });

        expect(screen.getByText('Restricted')).toBeInTheDocument();
        expect(screen.getByText(/by Ada Admin/)).toBeInTheDocument();
        expect(
            screen.getByText('Internal reason — never shown to the customer'),
        ).toBeInTheDocument();
        expect(screen.getByText(/Refused three parcels without a reason/)).toBeInTheDocument();
        // One button at a time, chosen from the stored state.
        expect(screen.getByRole('button', LIFT)).toBeInTheDocument();
        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('falls back to the source when no name was recorded', () => {
        renderPanel({ restriction: codRestrictionFixture({ restrictedByName: null }) });

        expect(screen.getByText(/by admin/)).toBeInTheDocument();
    });

    it('shows Support the state and the reason, with no button either way', () => {
        renderPanel({ restriction: codRestrictionFixture(), held: SUPPORT });

        expect(screen.getByText('Restricted')).toBeInTheDocument();
        expect(screen.getByText(/Refused three parcels without a reason/)).toBeInTheDocument();
        expect(screen.queryByRole('button', LIFT)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('withholds the button when the page says not to offer it', () => {
        renderPanel({ offerWrite: false });

        expect(screen.getByText('Not restricted')).toBeInTheDocument();
        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('never predicts an order: it describes the switch', () => {
        renderPanel();

        expect(
            screen.getByText(/the amount limits still decide each order/i),
        ).toBeInTheDocument();
    });
});

describe('restricting', () => {
    it('refuses to send without a reason', async () => {
        const calls = stubFetch(() => {
            throw new Error('nothing may be sent without a reason');
        });
        renderPanel();

        const dialog = await submit(RESTRICT, '');

        expect(await within(dialog).findByText(/at least 3 characters/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('sends the reason alone, and hands the answer to the page', async () => {
        const success = vi.spyOn(notify, 'success');
        const calls = stubFetch(() =>
            successResponse(customerCodReportFixture(), {
                message: 'Cash on delivery restricted for this customer',
            }),
        );
        const { onChanged } = renderPanel();

        await submit(RESTRICT, 'Refused three parcels without a reason');

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('PUT');
        expect(new URL(calls[0].url).pathname).toBe(`/api/v1${PATH}`);
        // No `restricted` boolean: the direction is the route.
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            reason: 'Refused three parcels without a reason',
        });
        expect(onChanged.mock.calls[0][0].restricted).toBe(true);
        expect(success).toHaveBeenCalledWith(
            'Cash on delivery restricted for this customer',
            expect.anything(),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says what happens and what does not, and that the reason is internal', async () => {
        renderPanel();

        await userEvent.click(screen.getByRole('button', RESTRICT));
        const dialog = await screen.findByRole('dialog');

        expect(dialog).toHaveTextContent(/no longer be able to place a cash-on-delivery order/i);
        expect(dialog).toHaveTextContent(/orders already placed.*are not affected/i);
        expect(dialog).toHaveTextContent(/nobody is notified/i);
        expect(dialog).toHaveTextContent(/internal — never shown to the customer/i);
    });
});

describe('lifting', () => {
    it('needs a reason too — unlike Restore', async () => {
        const calls = stubFetch(() => {
            throw new Error('nothing may be sent without a reason');
        });
        renderPanel({ restriction: codRestrictionFixture() });

        const dialog = await submit(LIFT, '');

        expect(await within(dialog).findByText(/at least 3 characters/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('posts to /lift with the reason alone', async () => {
        const calls = stubFetch(() => successResponse(customerCodReportFixture(NOT_RESTRICTED)));
        const { onChanged } = renderPanel({ restriction: codRestrictionFixture() });

        await submit(LIFT, 'Customer explained; the parcels were damaged');

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(calls[0].method).toBe('POST');
        expect(new URL(calls[0].url).pathname).toBe(`/api/v1${PATH}/lift`);
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            reason: 'Customer explained; the parcels were damaged',
        });
        expect(onChanged.mock.calls[0][0]).toMatchObject(NOT_RESTRICTED);
    });

    it('shows what is about to be erased, and says the trail is the only record', async () => {
        renderPanel({ restriction: codRestrictionFixture() });

        await userEvent.click(screen.getByRole('button', LIFT));
        const dialog = await screen.findByRole('dialog');

        expect(dialog).toHaveTextContent(/Restricted by Ada Admin/);
        expect(dialog).toHaveTextContent(/Refused three parcels without a reason/);
        expect(dialog).toHaveTextContent(/activity trail becomes the only record/i);
    });
});

describe('a stale page — 409 COD_RESTRICTION_UNCHANGED', () => {
    it('re-reads and shows the other administrator’s restriction, not an error to retry', async () => {
        const info = vi.spyOn(notify, 'info');
        const error = vi.spyOn(notify, 'error');
        const stored = customerCodReportFixture({
            restriction: codRestrictionFixture({
                reason: 'Second refused parcel this week',
                restrictedByName: 'Bola Okafor',
            }),
        });
        const calls = stubFetch((call: FetchCall) =>
            call.method === 'GET' ? successResponse(stored) : unchanged(),
        );
        const { onChanged } = renderPanel();

        await submit(RESTRICT, 'Refused three parcels without a reason');

        await waitFor(() => expect(onChanged).toHaveBeenCalledWith(stored));
        expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET']);
        expect(info).toHaveBeenCalledWith(
            'Cash on delivery was already restricted by Bola Okafor.',
            expect.anything(),
        );
        expect(error).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says a restriction was already lifted when lifting finds none', async () => {
        const info = vi.spyOn(notify, 'info');
        const stored = customerCodReportFixture(NOT_RESTRICTED);
        stubFetch((call: FetchCall) =>
            call.method === 'GET' ? successResponse(stored) : unchanged(),
        );
        const { onChanged } = renderPanel({ restriction: codRestrictionFixture() });

        await submit(LIFT, 'Customer explained');

        await waitFor(() => expect(onChanged).toHaveBeenCalledWith(stored));
        expect(info).toHaveBeenCalledWith(
            'The restriction had already been lifted.',
            expect.anything(),
        );
    });

    it('keeps the refusal on screen when even the re-read fails', async () => {
        stubFetch((call: FetchCall) =>
            call.method === 'GET'
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE')
                : unchanged(),
        );
        const { onChanged } = renderPanel();

        const dialog = await submit(RESTRICT, 'Refused three parcels');

        expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
        expect(onChanged).not.toHaveBeenCalled();
    });
});

describe('no answer from the platform — 502 / 503', () => {
    const noAnswer = () => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE');

    it('reads the state back, and settles when the write did land', async () => {
        const success = vi.spyOn(notify, 'success');
        const calls = stubFetch((call: FetchCall) =>
            call.method === 'GET' ? successResponse(customerCodReportFixture()) : noAnswer(),
        );
        const { onChanged } = renderPanel();

        await submit(RESTRICT, 'Refused three parcels');

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET']);
        expect(onChanged.mock.calls[0][0].restricted).toBe(true);
        expect(success).toHaveBeenCalledWith(
            'Cash on delivery is restricted',
            expect.objectContaining({ description: expect.stringMatching(/did not confirm/i) }),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says nothing changed when the read shows it did not, and offers it again', async () => {
        stubFetch((call: FetchCall) =>
            call.method === 'GET'
                ? successResponse(customerCodReportFixture(NOT_RESTRICTED))
                : noAnswer(),
        );
        renderPanel();

        const dialog = await submit(RESTRICT, 'Refused three parcels');

        expect(await within(dialog).findByText('Nothing changed.')).toBeInTheDocument();
        expect(dialog).toHaveTextContent(/still not restricted/i);
        expect(within(dialog).getByRole('button', RESTRICT)).toBeEnabled();
    });

    it('withholds the button until the state can be read', async () => {
        let readable = false;
        const calls = stubFetch((call: FetchCall) => {
            if (call.method !== 'GET') return noAnswer();
            return readable ? successResponse(customerCodReportFixture()) : noAnswer();
        });
        const { onChanged } = renderPanel();

        const dialog = await submit(RESTRICT, 'Refused three parcels');

        expect(
            await within(dialog).findByText(/may or may not have been set/i),
        ).toBeInTheDocument();
        // Not offered again blind: the first attempt may have landed.
        expect(within(dialog).queryByRole('button', RESTRICT)).not.toBeInTheDocument();
        expect(onChanged).not.toHaveBeenCalled();

        readable = true;
        await userEvent.click(within(dialog).getByRole('button', { name: /check again/i }));

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        // One write, two reads — the check never re-sends the write.
        expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET', 'GET']);
    });
});

describe('the other refusals', () => {
    it('says an account with no customer profile has nothing to restrict', async () => {
        const warning = vi.spyOn(notify, 'warning');
        stubFetch(() =>
            errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                details: { platformCode: 'AUTH_PROFILE_NOT_FOUND' },
            }),
        );
        const { onChanged } = renderPanel();

        await submit(RESTRICT, 'Refused three parcels');

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'This account has no customer profile',
                expect.anything(),
            ),
        );
        expect(onChanged).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows an ordinary refusal in the form, with no claim of uncertainty', async () => {
        const calls = stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED'));
        renderPanel();

        const dialog = await submit(RESTRICT, 'Refused three parcels');

        expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
        expect(dialog).not.toHaveTextContent(/may or may not/i);
        // A 403 is an answer; nothing is re-read.
        expect(calls).toHaveLength(1);
    });
});

describe('the agency mount', () => {
    function renderAgency(restriction: CodRestriction | null = null) {
        const onChanged = vi.fn<(report: CodRestrictionReport) => void>();
        renderWithProviders(
            <CodRestrictionPanel
                subject="agency"
                subjectName="Littoral Express"
                restriction={restriction}
                permission="agencies.cod.restrict"
                timeZone="Africa/Douala"
                actions={{
                    read: () => getAgencyCodRestriction(COD_AGENCY_ID),
                    restrict: (body) => restrictAgencyCod(COD_AGENCY_ID, body),
                    lift: (body) => liftAgencyCodRestriction(COD_AGENCY_ID, body),
                }}
                onChanged={onChanged}
            />,
            {
                auth: { status: 'authenticated', admin: adminFixture() },
                permissions: { held: new Set(['agencies.read', 'agencies.cod.restrict']) },
            },
        );
        return { onChanged };
    }

    it('is gated on its own permission, not the customer one', () => {
        renderWithProviders(
            <CodRestrictionPanel
                subject="agency"
                subjectName="Littoral Express"
                restriction={null}
                permission="agencies.cod.restrict"
                timeZone="Africa/Douala"
                actions={{
                    read: () => getAgencyCodRestriction(COD_AGENCY_ID),
                    restrict: (body) => restrictAgencyCod(COD_AGENCY_ID, body),
                    lift: (body) => liftAgencyCodRestriction(COD_AGENCY_ID, body),
                }}
                onChanged={vi.fn()}
            />,
            {
                auth: { status: 'authenticated', admin: adminFixture() },
                permissions: { held: new Set(['agencies.read', 'users.cod.restrict']) },
            },
        );

        expect(screen.queryByRole('button', RESTRICT)).not.toBeInTheDocument();
    });

    it('labels the reason as never shown to the agency', () => {
        renderAgency(codRestrictionFixture({ reason: 'Three remittances short in two weeks' }));

        expect(
            screen.getByText('Internal reason — never shown to the agency'),
        ).toBeInTheDocument();
    });

    it('says what a restriction leaves alone, and that force does not get past it', async () => {
        renderAgency();

        await userEvent.click(screen.getByRole('button', RESTRICT));
        const dialog = await screen.findByRole('dialog');

        expect(dialog).toHaveTextContent(/even by forcing it/i);
        expect(dialog).toHaveTextContent(/parcels it already holds run to the end/i);
        expect(dialog).toHaveTextContent(/cash hand-overs.*carry on/i);
        expect(dialog).toHaveTextContent(/prepaid deliveries/i);
    });

    it('restricts through the agency route', async () => {
        const calls = stubFetch(() => successResponse(agencyCodReportFixture()));
        const { onChanged } = renderAgency();

        await submit(RESTRICT, 'Three remittances short in two weeks');

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(calls[0].method).toBe('PUT');
        expect(new URL(calls[0].url).pathname).toBe(
            `/api/v1/agencies/${COD_AGENCY_ID}/cod-restriction`,
        );
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            reason: 'Three remittances short in two weeks',
        });
    });
});
