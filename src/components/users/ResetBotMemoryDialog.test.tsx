import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResetBotMemoryDialog } from '@/components/users/ResetBotMemoryDialog';
import { notify } from '@/lib/notify';
import { userDetailFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

const USER_ID = '665f1c2a9b3e4a91c7d2e5f0';
const RESET_PATH = `/users/${USER_ID}/bot-memory/reset`;

const RESULT = { userId: USER_ID, memoryEpoch: 4, resetAt: '2026-09-22T10:00:00.000Z' };
const SERVER_MESSAGE = 'Bot memory reset — the next conversation starts fresh';

function render(onReset = vi.fn(), onOpenChange = vi.fn()) {
    renderWithProviders(
        <ResetBotMemoryDialog
            user={userDetailFixture({ roles: ['customer'] })}
            open
            onOpenChange={onOpenChange}
            onReset={onReset}
        />,
    );
    return { onReset, onOpenChange };
}

/** Toasts are asserted at the seam: `<Toaster>` lives in `App`, not here. */
function spyToast(kind: 'success' | 'warning') {
    return vi.spyOn(notify, kind).mockImplementation(() => undefined as never);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the request', () => {
    it('posts no reason key at all when the field is left empty', async () => {
        // ⚠ `""` is a 400 on this strict body, so an untouched optional field must
        // not become `reason: ""`. Asserted on the parsed body, key by key.
        spyToast('success');
        const calls = stubFetch(() => successResponse(RESULT, { message: SERVER_MESSAGE }));
        render();

        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain(RESET_PATH);
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({});
    });

    it('treats a whitespace-only reason as empty, too', async () => {
        spyToast('success');
        const calls = stubFetch(() => successResponse(RESULT, { message: SERVER_MESSAGE }));
        render();

        await userEvent.type(screen.getByLabelText(/reason/i), '   ');
        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({});
    });

    it('sends a given reason trimmed, and nothing beside it', async () => {
        spyToast('success');
        const calls = stubFetch(() => successResponse(RESULT, { message: SERVER_MESSAGE }));
        render();

        await userEvent.type(
            screen.getByLabelText(/reason/i),
            '  Bot keeps quoting a cancelled order  ',
        );
        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({
            reason: 'Bot keeps quoting a cancelled order',
        });
    });

    it('refuses a reason under three characters before spending a request', async () => {
        const calls = stubFetch(() => successResponse(RESULT));
        render();

        await userEvent.type(screen.getByLabelText(/reason/i), 'no');
        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});

describe('the outcome', () => {
    it('toasts the server’s own sentence, closes and reloads the trail', async () => {
        const success = spyToast('success');
        stubFetch(() => successResponse(RESULT, { message: SERVER_MESSAGE }));
        const { onReset, onOpenChange } = render();

        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
        expect(success).toHaveBeenCalledWith(SERVER_MESSAGE, expect.anything());
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('never calls it deleting messages or clearing history', () => {
        // Administrators would read either as "the conversation is gone", and the
        // message records are untouched.
        stubFetch(() => successResponse(RESULT));
        render();

        const dialog = screen.getByRole('dialog');
        expect(dialog.textContent).not.toMatch(/delete|clear (the )?(chat )?history/i);
        expect(dialog.textContent).toMatch(/orders, message records and the account are not affected/i);
    });

    it('says an account with no customer profile has never used the bot', async () => {
        const warning = spyToast('warning');
        stubFetch((call: FetchCall) => {
            if (call.url.includes(RESET_PATH)) {
                return errorResponse(404, 'PLATFORM_OPERATION_REJECTED', {
                    message: 'This account has no customer profile',
                    details: { platformCode: 'AUTH_PROFILE_NOT_FOUND' },
                });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        const { onReset, onOpenChange } = render();

        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                expect.stringMatching(/never used the bot/i),
                expect.anything(),
            ),
        );
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onReset).not.toHaveBeenCalled();
    });

    it('says an unreachable platform may not have reset, and that pressing again is safe', async () => {
        // wi-admin never retries a write, so a 503 leaves the outcome unknown —
        // and a second reset is as harmless as the first.
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));
        const { onReset } = render();

        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        expect(await screen.findByText(/may not have happened/i)).toBeInTheDocument();
        expect(screen.getByText(/pressing again is safe/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reset memory/i })).toBeEnabled();
        expect(onReset).not.toHaveBeenCalled();
    });

    it('does not claim uncertainty on an ordinary refusal', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED'));
        render();

        await userEvent.click(screen.getByRole('button', { name: /reset memory/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.queryByText(/may not have happened/i)).not.toBeInTheDocument();
    });
});
