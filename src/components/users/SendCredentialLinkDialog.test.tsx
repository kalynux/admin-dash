import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SendCredentialLinkDialog } from '@/components/users/SendCredentialLinkDialog';
import { notify } from '@/lib/notify';
import { adminFixture, userDetailFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch } from '@/test/utils';

/**
 * The only credential-recovery dialog in the app — vendors, agencies and agents
 * all route through the same user record, so every "they cannot get back in"
 * ticket ends here.
 *
 * ── Why the throttle has its own describe ────────────────────────────────────
 * It read `details.scope` to choose between *wait* and *ask a colleague* until
 * 2026-09-09. **That key never arrives**: the refusal is forwarded at 429, and
 * `rate_limit` carries a closed `details` allowlist — `retryAfterSeconds` ·
 * `limit` · `windowSeconds`, plus `platformCode` since 2026-09-15. So every
 * throttle was reported as the party's, including the half where the operator
 * was the one being limited and a colleague could have sent it immediately.
 *
 * ⚠ The stubs below therefore send **exactly** the allowlisted keys, and none of
 * them sends `scope`. A stub that helpfully included it would pass against the
 * old broken branch too, which is the whole reason nothing caught this.
 *
 * ⚠ **`platformCode` arriving changed nothing here, and the last case pins
 * that.** BR-025 § 2 put it on the allowlist for a flow where two 429s wanted
 * opposite remedies; this refusal is one 429 whose remedy turns on `scope`,
 * which is still dropped. The branch matches the status, and it should stay
 * that way.
 */

/** Toasts are asserted at the seam: `<Toaster>` lives in `App`, not here. */
function watchWarnings() {
    return vi.spyOn(notify, 'warning').mockImplementation(() => undefined as never);
}

function open(kind: 'login' | 'password-reset' = 'password-reset') {
    const onSent = vi.fn();
    renderWithProviders(
        <SendCredentialLinkDialog
            user={userDetailFixture()}
            kind={kind}
            open
            onOpenChange={() => {}}
            onSent={onSent}
        />,
        { auth: { status: 'authenticated', admin: adminFixture() } },
    );
    return onSent;
}

async function submit() {
    await userEvent.type(screen.getByRole('textbox'), 'they called the support line');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
}

describe('the throttle', () => {
    /**
     * jovi-mall's own sentence is the only thing left carrying which of the two
     * limits was hit, so it is rendered verbatim rather than through
     * `resolveErrorMessage` — whose `MESSAGE_BEARING` set excludes `rate_limit`
     * and would answer with generic category copy.
     */
    it('renders the server’s sentence, which is the only thing that says whose limit it was', async () => {
        stubFetch(() =>
            errorResponse(429, 'PLATFORM_OPERATION_REJECTED', {
                category: 'rate_limit',
                message: 'You have sent too many credential links recently.',
                details: { retryAfterSeconds: 240, limit: 5, windowSeconds: 3600 },
            }),
        );
        const warning = watchWarnings();
        open();

        await submit();

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'Too many requests — nothing was sent',
                expect.anything(),
            ),
        );
        expect(warning.mock.calls[0][1]?.description).toMatch(
            /you have sent too many credential links recently/i,
        );
    });

    /** `retryAfterSeconds` is on the allowlist and does survive. */
    it('keeps the wait, which is the one detail that survives', async () => {
        stubFetch(() =>
            errorResponse(429, 'PLATFORM_OPERATION_REJECTED', {
                category: 'rate_limit',
                message: 'Too many links have been sent to this person.',
                details: { retryAfterSeconds: 240 },
            }),
        );
        const warning = watchWarnings();
        open();

        await submit();

        await waitFor(() => expect(warning).toHaveBeenCalled());
        expect(warning.mock.calls[0][1]?.description).toMatch(/about 4 minutes/i);
    });

    /**
     * ⚠ **Never invent a scope.** With no message and no `scope`, the copy has
     * to name both remedies rather than guess one — asserting the party's limit
     * when it was the operator's tells them to wait when a colleague could have
     * sent it now.
     */
    it('names both remedies when the server sent no sentence to distinguish them', async () => {
        stubFetch(() =>
            errorResponse(429, 'PLATFORM_OPERATION_REJECTED', {
                category: 'rate_limit',
                // No envelope at all — a proxy answered. The client synthesises
                // a message, which is exactly what must NOT be rendered here.
                message: '',
                details: { retryAfterSeconds: 60 },
            }),
        );
        const warning = watchWarnings();
        open();

        await submit();

        await waitFor(() => expect(warning).toHaveBeenCalled());
        const description = warning.mock.calls[0][1]?.description as string;
        expect(description).toMatch(/either on this party or on your own account/i);
        expect(description).toMatch(/about 1 minute\b/i);
    });

    /**
     * The wire as it is since 2026-09-15: `platformCode` survives a forwarded
     * 429 (BR-025 § 2) and `scope` still does not.
     *
     * ⚠ **The assertion is that nothing moved.** The code names the refusal,
     * which the status already did; the server's sentence is still the only
     * thing saying *whose* allowance ran out, so it is still what gets rendered.
     * If somebody re-points this branch at `platformCode` and drops the message,
     * this goes red — which is the point, because the screen would look correct
     * and tell half the operators to wait for no reason.
     */
    it('still renders the sentence now that platformCode survives a 429', async () => {
        stubFetch(() =>
            errorResponse(429, 'PLATFORM_OPERATION_REJECTED', {
                category: 'rate_limit',
                message: 'You have sent too many credential links recently.',
                details: {
                    retryAfterSeconds: 240,
                    platformCode: 'USER_CREDENTIAL_LINK_THROTTLED',
                },
            }),
        );
        const warning = watchWarnings();
        open();

        await submit();

        await waitFor(() => expect(warning).toHaveBeenCalled());
        expect(warning.mock.calls[0][1]?.description).toMatch(
            /you have sent too many credential links recently/i,
        );
    });
});

describe('the refusals that do carry a code', () => {
    /**
     * 409 is `conflict`, which carries `details` through — so these four still
     * arrive with their `platformCode` and still get their own sentence.
     */
    it('puts an unavailable channel on the channel field', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: { platformCode: 'USER_CHANNEL_UNAVAILABLE' },
            }),
        );
        open();

        await submit();

        expect(
            await screen.findByText(/no address on file for this channel/i),
        ).toBeInTheDocument();
    });

    it('explains that a sign-in link is for customers only', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: { platformCode: 'USER_LOGIN_LINK_ROLE_UNSUPPORTED' },
            }),
        );
        const warning = watchWarnings();
        open('login');

        await submit();

        await waitFor(() =>
            expect(warning).toHaveBeenCalledWith(
                'Sign-in links are for customers only',
                expect.anything(),
            ),
        );
    });
});
