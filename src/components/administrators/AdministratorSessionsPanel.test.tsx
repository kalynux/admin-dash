import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdministratorSessionsPanel } from '@/components/administrators/AdministratorSessionsPanel';
import {
    administratorFixture,
    administratorSessionFixture,
    endedAdministratorSessionFixture,
} from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { AdministratorSession } from '@/types/administrators.types';

const administrator = administratorFixture({ tier: 3 });

function renderPanel(
    rows: AdministratorSession[] = [administratorSessionFixture()],
    { canRevoke = true }: { canRevoke?: boolean } = {},
) {
    const calls = stubFetch(() => successResponse(rows));

    renderWithProviders(
        <AdministratorSessionsPanel
            administrator={administrator}
            timeZone="Africa/Douala"
            reloadToken={0}
            canRevoke={canRevoke}
        />,
        {},
    );

    return calls;
}

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('the session list', () => {
    it('renders a readable device name and the address', async () => {
        renderPanel();

        expect(await screen.findByText(/chrome on windows/i)).toBeInTheDocument();
        expect(screen.getByText(/102\.244\.18\.7/)).toBeInTheDocument();
    });

    /**
     * `current` is always `false` on this projection — every session here belongs
     * to somebody else. A "this device" badge would be a lie.
     */
    it('never shows a this-device badge', async () => {
        renderPanel();

        await screen.findByText(/chrome on windows/i);

        expect(screen.queryByText(/this device/i)).not.toBeInTheDocument();
    });

    /** The endpoint is unpaginated and sends no `meta`. */
    it('renders no pager', async () => {
        renderPanel();

        await screen.findByText(/chrome on windows/i);

        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument();
    });

    it('flags a live session issued at a level they no longer hold', async () => {
        // The fixture logs in at tier 2; the record is tier 3.
        renderPanel();

        expect(await screen.findByText(/signed in as admin; now support/i)).toBeInTheDocument();
    });

    it('renders an unknown end reason raw rather than blanking it', async () => {
        renderPanel([
            endedAdministratorSessionFixture({ endReason: 'something_new_shipped' }),
        ]);

        expect(await screen.findByText('something_new_shipped')).toBeInTheDocument();
    });

    it('labels the reasons that need a sentence', async () => {
        renderPanel([endedAdministratorSessionFixture({ endReason: 'tier_changed' })]);

        expect(await screen.findByText(/no longer true/i)).toBeInTheDocument();
    });
});

describe('includeEnded', () => {
    it('asks for live sessions only by default', async () => {
        const calls = renderPanel();

        await screen.findByText(/chrome on windows/i);

        // `false` is a real filter value and is sent as such.
        expect(queryOf(calls[0]).get('includeEnded')).toBe('false');
    });

    it('refetches with includeEnded=true when toggled', async () => {
        const calls = renderPanel();
        await screen.findByText(/chrome on windows/i);

        await userEvent.click(screen.getByRole('switch', { name: /include ended sessions/i }));

        await waitFor(() => expect(calls.length).toBeGreaterThan(1));
        expect(queryOf(calls[calls.length - 1]).get('includeEnded')).toBe('true');
    });
});

describe('revoking', () => {
    it('hides both controls without the revoke permission', async () => {
        renderPanel([administratorSessionFixture()], { canRevoke: false });

        await screen.findByText(/chrome on windows/i);

        expect(screen.queryByRole('button', { name: /^end$/i })).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /sign out everywhere/i }),
        ).not.toBeInTheDocument();
    });

    it('offers no End on a session that has already ended', async () => {
        renderPanel([endedAdministratorSessionFixture()]);

        await screen.findByText(/chrome on windows/i);

        expect(screen.queryByRole('button', { name: /^end$/i })).not.toBeInTheDocument();
    });

    /**
     * `ADMIN_SESSION_NOT_FOUND` means it already ended between the fetch and the
     * click. Not a failure — the operator wanted it gone and it is gone — so it
     * refetches quietly rather than reporting an error.
     */
    it('treats an already-gone session as nothing to report', async () => {
        let call = 0;
        stubFetch(() => {
            call += 1;
            if (call === 2) return errorResponse(404, 'ADMIN_SESSION_NOT_FOUND');
            return successResponse([administratorSessionFixture()]);
        });

        renderWithProviders(
            <AdministratorSessionsPanel
                administrator={administrator}
                timeZone="Africa/Douala"
                reloadToken={0}
                canRevoke
            />,
            {},
        );

        await screen.findByText(/chrome on windows/i);
        await userEvent.click(screen.getByRole('button', { name: /^end$/i }));
        await userEvent.click(screen.getByRole('button', { name: /end session/i }));

        await waitFor(() => expect(call).toBeGreaterThan(2));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
