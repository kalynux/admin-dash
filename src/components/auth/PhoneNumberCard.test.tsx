import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PhoneNumberCard } from '@/components/auth/PhoneNumberCard';
import { adminFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AdminProfile } from '@/types/auth.types';

function renderCard(admin: Partial<AdminProfile> = {}, onChanged = vi.fn()) {
    renderWithProviders(<PhoneNumberCard admin={adminFixture(admin)} onChanged={onChanged} />, {
        auth: { status: 'authenticated', admin: adminFixture(admin) },
    });
    return onChanged;
}

/** The send response, as `admin-phone.service.ts` returns it. */
function codeSent(delivery = 'text') {
    return successResponse({
        phoneMasked: '+237•••••3456',
        expiresAt: '2026-09-14T12:10:00.000Z',
        delivery,
    });
}

describe('what the card shows', () => {
    it('names the number and marks it unverified', () => {
        renderCard({ phone: '+237600123456', phoneVerified: false });

        expect(screen.getByText('+237600123456')).toBeInTheDocument();
        expect(screen.getByText('Not verified')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /verify this number/i })).toBeInTheDocument();
    });

    /**
     * A verified number offers no verify button — there is nothing left to prove
     * and the send would only spend a code.
     */
    it('marks a proved number verified and withdraws the affordance', () => {
        renderCard({ phone: '+237600123456', phoneVerified: true });

        expect(screen.getByText('Verified')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /verify this number/i })).not.toBeInTheDocument();
    });

    /**
     * ⚠ With no number saved there is nothing to verify: `requestCode` refuses
     * with a 422 before it reaches jovi-mall. The affordance is withheld rather
     * than offered and refused.
     */
    it('offers only "add a number" when there is none', () => {
        renderCard({ phone: null, phoneVerified: false });

        expect(screen.getByText(/no number saved/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add a number/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /verify this number/i })).not.toBeInTheDocument();
    });

    /**
     * The card must not read as a security control. Nothing in wi-admin's auth
     * path reads `phoneVerified`, so copy implying otherwise would tell an
     * administrator they had hardened a login that has not changed.
     */
    it('says outright that this is not a sign-in step', () => {
        renderCard({ phone: '+237600123456' });

        expect(screen.getByText(/not a sign-in step/i)).toBeInTheDocument();
    });
});

describe('saving a number', () => {
    it('PATCHes /auth/me/phone and refreshes the profile', async () => {
        const calls = stubFetch(() => successResponse({ phone: '+237600999888', verified: false }));
        const onChanged = renderCard({ phone: null });

        await userEvent.click(screen.getByRole('button', { name: /add a number/i }));
        await userEvent.type(await screen.findByLabelText('Phone number'), '+237600999888');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onChanged).toHaveBeenCalled());

        const write = calls.find((call) => call.method === 'PATCH');
        expect(write?.url).toContain('/auth/me/phone');
        expect(JSON.parse(write?.body ?? '{}')).toEqual({ phone: '+237600999888' });
    });

    /**
     * ⚠ The warning has to precede the write. `setPhone` clears `phone_verified`
     * unconditionally — including when the number is unchanged — so once the
     * response is back there is nothing to undo.
     */
    it('warns a verified administrator that saving un-verifies, before they save', async () => {
        renderCard({ phone: '+237600123456', phoneVerified: true });

        await userEvent.click(screen.getByRole('button', { name: 'Change' }));

        expect(await screen.findByText(/marks it unverified again/i)).toBeInTheDocument();
    });

    it('shows no such warning when the number was never proved', async () => {
        renderCard({ phone: '+237600123456', phoneVerified: false });

        await userEvent.click(screen.getByRole('button', { name: 'Change' }));
        await screen.findByLabelText('Phone number');

        expect(screen.queryByText(/marks it unverified again/i)).not.toBeInTheDocument();
    });
});

describe('proving it', () => {
    /**
     * ⚠ Opening the dialog must send nothing. A send messages a real person and
     * starts a 60-second account-scoped cooldown, so a misclick would spend both.
     */
    it('sends no code merely because the dialog opened', async () => {
        const calls = stubFetch(() => codeSent());
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await screen.findByRole('button', { name: 'Send code' });

        expect(calls).toHaveLength(0);
    });

    it('requests a code on the click and then takes one', async () => {
        const calls = stubFetch((call) =>
            call.url.includes('/verify/confirm')
                ? successResponse({ phone: '+237600123456', verified: true })
                : codeSent(),
        );
        const onChanged = renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

        expect(await screen.findByText(/\+237•••••3456/)).toBeInTheDocument();

        await userEvent.type(await screen.findByLabelText('Code'), '123456');
        await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

        await waitFor(() => expect(onChanged).toHaveBeenCalled());

        const confirm = calls.find((call) => call.url.includes('/verify/confirm'));
        expect(confirm?.method).toBe('POST');
        // ⚠ `code` ALONE. The body is `.strict()`; sending `phone` beside it is a
        // 400, because a caller that could name the number could prove control
        // of one and have another marked verified.
        expect(JSON.parse(confirm?.body ?? '{}')).toEqual({ code: '123456' });
    });

    /** The request takes no body at all — the target is chosen server-side. */
    it('names no number when asking for a code', async () => {
        const calls = stubFetch(() => codeSent());
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));
        await screen.findByLabelText('Code');

        const request = calls.find((call) => call.url.includes('/verify/request'));
        expect(request?.body).toBeUndefined();
    });

    /**
     * ⚠ The regression this guards is the reason the branch reads `platformCode`
     * rather than `isPlatformRejection`. A refused send is a **502
     * `SERVICE_DEPENDENCY_UNAVAILABLE`** — wi-admin remaps every delegated 5xx —
     * so the usual delegated-refusal predicate is false here. Its *message* is
     * replaced with a registry default too, which is why the explanation is ours.
     */
    it('explains a refused WhatsApp send instead of showing a generic dependency error', async () => {
        stubFetch(() =>
            errorResponse(502, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'A service we depend on did not respond',
                category: 'external_service',
                details: {
                    platformCode: 'PHONE_VERIFICATION_DELIVERY_FAILED',
                    platformStatus: 502,
                },
            }),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

        expect(await screen.findByText(/would not deliver the code/i)).toBeInTheDocument();
        // The remedy that costs nothing first — a delivery failure is unusual
        // again now that the AUTHENTICATION template is approved (2026-09-15).
        expect(screen.getByText(/try again in a moment/i)).toBeInTheDocument();
        // The in-window trick survives as a FALLBACK, and only as one.
        expect(screen.getByText(/if it keeps failing/i)).toBeInTheDocument();
        // And the reassurance, because the account is genuinely unaffected.
        expect(screen.getByText(/not a sign-in requirement/i)).toBeInTheDocument();
    });

    /**
     * ⚠ **The copy must not blame the operator's own silence.** It read *"this
     * usually means nobody has messaged the platform from that number in the
     * last 24 hours"*, which was true while the deployment had no approved
     * template and every send failed. It has one now, so leading with that sends
     * somebody chasing a remedy they do not need.
     */
    it('does not present the 24-hour window as the usual cause', async () => {
        stubFetch(() =>
            errorResponse(502, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'A service we depend on did not respond',
                category: 'external_service',
                details: { platformCode: 'PHONE_VERIFICATION_DELIVERY_FAILED' },
            }),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

        await screen.findByText(/would not deliver the code/i);
        expect(screen.queryByText(/usually means/i)).not.toBeInTheDocument();
    });

    /**
     * A wrong code is a delegated 422 at `business_rule`, where both
     * `platformCode` and `attemptsLeft` survive wi-admin's scrub — so the copy
     * comes from `errors.platform`, and the code box stays open to retype into.
     */
    it('keeps the form open on a wrong code and says so', async () => {
        stubFetch((call) =>
            call.url.includes('/verify/confirm')
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'That code is not right',
                      category: 'business_rule',
                      details: {
                          platformCode: 'PHONE_VERIFICATION_CODE_INVALID',
                          attemptsLeft: 4,
                      },
                  })
                : codeSent(),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));
        await userEvent.type(await screen.findByLabelText('Code'), '000000');
        await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

        expect(await screen.findByText(/that code is not right/i)).toBeInTheDocument();
        expect(screen.getByLabelText('Code')).toBeInTheDocument();
    });

    /**
     * `attemptsLeft` is the one counter jovi-mall discloses, and only on
     * `CODE_INVALID`. `errors.md` states the reasoning outright: it tells the
     * holder of the real code that they mistyped and how much room is left, and
     * it tells an attacker something they could count themselves. **The secret
     * is the code, not the counter.**
     */
    it('says how many tries are left, beside the catalogued sentence', async () => {
        stubFetch((call) =>
            call.url.includes('/verify/confirm')
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'That code is not right',
                      category: 'business_rule',
                      details: {
                          platformCode: 'PHONE_VERIFICATION_CODE_INVALID',
                          attemptsLeft: 2,
                      },
                  })
                : codeSent(),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));
        await userEvent.type(await screen.findByLabelText('Code'), '000000');
        await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

        expect(await screen.findByText(/2 tries left on this code/i)).toBeInTheDocument();
        // Beside, never instead of — the remedy is still the catalogued line.
        expect(screen.getByText(/that code is not right/i)).toBeInTheDocument();
    });

    /**
     * 🔴 **The two 429s want OPPOSITE remedies**, and until 2026-09-15 they
     * arrived indistinguishable: wi-admin's `rate_limit` allowlist was
     * `retryAfterSeconds`/`limit`/`windowSeconds` and dropped `platformCode`, so
     * this dialog had to name both at once. BR-025 § 2 added the key.
     *
     * The cooldown is the half where guessing wrong is *cheap* — but its true
     * statement is what the operator needs, because the code in their hand still
     * works and asking for another only restarts the wait.
     */
    it('tells a cooled-down resend that the code in hand still works', async () => {
        stubFetch((call) =>
            call.url.includes('/verify/request') && call.method === 'POST'
                ? errorResponse(429, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'Another code can be requested in 45s',
                      category: 'rate_limit',
                      details: {
                          retryAfterSeconds: 45,
                          platformCode: 'PHONE_VERIFICATION_RESEND_TOO_SOON',
                      },
                  })
                : codeSent(),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

        expect(await screen.findByText(/a code was just sent — try again in 45s/i)).toBeInTheDocument();
        expect(screen.getByText(/still works/i)).toBeInTheDocument();
        // ⚠ The opposite remedy must be GONE, not merely accompanied. Telling
        // somebody their code was destroyed when it was not sends them back for
        // another and restarts the cooldown they are already inside.
        expect(screen.queryByText(/has been destroyed/i)).not.toBeInTheDocument();
    });

    /**
     * 🔴 The half where guessing wrong is **not** recoverable: the code is gone,
     * so "wait a moment" leaves the operator at a form that cannot succeed
     * however long they wait. The dialog drops back to **Send code** for the
     * same reason — the form in front of them is dead.
     */
    it('tells a spent code that it is destroyed, and puts the send button back', async () => {
        stubFetch((call) =>
            call.url.includes('/verify/confirm')
                ? errorResponse(429, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'Too many attempts',
                      category: 'rate_limit',
                      details: { platformCode: 'PHONE_VERIFICATION_TOO_MANY_ATTEMPTS' },
                  })
                : codeSent(),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));
        await userEvent.type(await screen.findByLabelText('Code'), '000000');
        await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

        expect(await screen.findByText(/that code has been destroyed/i)).toBeInTheDocument();
        expect(screen.getByText(/send a new one and use that/i)).toBeInTheDocument();
        expect(screen.queryByText(/still works/i)).not.toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Send code' })).toBeInTheDocument();
    });

    /**
     * ⚠ **wi-admin's own per-identity ceiling is not a verdict on the code**, so
     * it must not say anything about one. It arrives as a plain
     * `RATE_LIMIT_EXCEEDED` with no `platformCode` — which is exactly what the
     * delegated refusals looked like before the allowlist widened, so this is
     * also the case that stops the unnamed arm being deleted as dead.
     */
    it('treats our own rate ceiling as a plain wait', async () => {
        stubFetch((call) =>
            call.url.includes('/verify/request') && call.method === 'POST'
                ? errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
                      message: 'Too many requests',
                      category: 'rate_limit',
                      details: { retryAfterSeconds: 30 },
                  })
                : codeSent(),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

        expect(await screen.findByText(/too many requests — try again in 30s/i)).toBeInTheDocument();
        expect(screen.getByText(/wait a moment and try again/i)).toBeInTheDocument();
        expect(screen.queryByText(/has been destroyed/i)).not.toBeInTheDocument();
    });

    /**
     * ⚠ **`ADMIN_PHONE_VERIFICATION_MISMATCH` is wi-admin's own code**, named on
     * 2026-09-14 — BR-025 read it as a `VALIDATION_ERROR` and said it was not
     * asking for a named one, hours after one shipped.
     *
     * Nothing is written on the mismatch, and the code proved a number that is
     * no longer the account's, so the only way forward is a fresh code against
     * the current number: the dialog goes back to **Send code**.
     */
    it('sends an administrator back for a new code when the number moved under it', async () => {
        stubFetch((call) =>
            call.url.includes('/verify/confirm')
                ? errorResponse(409, 'ADMIN_PHONE_VERIFICATION_MISMATCH', {
                      message: 'The verified number no longer matches this account',
                      category: 'conflict',
                  })
                : codeSent(),
        );
        renderCard({ phone: '+237600123456' });

        await userEvent.click(screen.getByRole('button', { name: /verify this number/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));
        await userEvent.type(await screen.findByLabelText('Code'), '123456');
        await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

        // The catalogued sentence, not the server's — this code has copy.
        expect(await screen.findByText(/ask for a new one/i)).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Send code' })).toBeInTheDocument();
    });
});
