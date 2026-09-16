import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VerificationReviewDialog } from '@/components/verification/VerificationReviewDialog';
import {
    vendorVerificationFixture,
    verificationDocumentsFixture,
} from '@/test/verification-fixtures';
import { renderWithProviders } from '@/test/utils';
import type { PartyVerification, VerdictOption } from '@/types/verification.types';

const OPTIONS: VerdictOption[] = [
    {
        value: 'approve',
        label: 'Approve verification',
        description: 'Agencies will see this business as verified.',
        textMode: 'optional-note',
        textLabel: 'Note (optional)',
        estimates: 'approve',
    },
    {
        value: 'reject',
        label: 'Reject verification',
        description: 'Shows the vendor your reason.',
        textMode: 'required-reason',
        textLabel: 'Reason',
        estimates: 'reject',
    },
];

function open(
    record: PartyVerification | null,
    onSubmit: (verdict: string, text: string) => Promise<void> = async () => {},
) {
    return renderWithProviders(
        <VerificationReviewDialog
            open
            onOpenChange={() => {}}
            party="vendor"
            subjectName="Njoya Textiles"
            title="Review verification for Njoya Textiles"
            description="Check what the vendor supplied, then record a verdict."
            record={record}
            current={{ status: 'pending', reason: null, decidedAt: null, decidedBy: null }}
            options={OPTIONS}
            onSubmit={onSubmit}
            timeZone="Africa/Douala"
        />,
    );
}

describe('what the reviewer is shown before they decide', () => {
    /**
     * The complaint this dialog answers, asserted directly: the operator used to
     * pick a verdict from the toolbar with nothing on the screen to pick it from.
     */
    /**
     * ⚠ **The estimate is shown and the evidence is NOT repeated.** The checklist,
     * the documents and the record context sit on the Verification tab behind
     * this dialog; reprinting them made it taller than the viewport to answer a
     * question the operator had just answered.
     *
     * The estimate stays because it is the one thing not on the tab in this
     * form — it is what preselects the verdict and drafts the text, so without it
     * both would look like they came from nowhere.
     */
    it('shows the estimate without repeating the evidence', async () => {
        open(vendorVerificationFixture());

        expect(await screen.findByText(/evidence complete/i)).toBeInTheDocument();

        // The tab's content, which must not be duplicated here.
        expect(screen.queryByText('What the applicant was asked for')).not.toBeInTheDocument();
        expect(screen.queryByText('Selfie holding the ID card')).not.toBeInTheDocument();
    });

    /**
     * ⚠ `null` is "this screen could not read the record" — not loaded, refused,
     * or the request failed. It must read as a reason not to estimate, never as a
     * reason to refuse: the drafted rejection goes to the applicant.
     *
     * ⚠ **The per-row "Not readable" wording moved with the checklist** and is
     * asserted in `VerificationChecklist.test.tsx`. What this dialog still owes
     * is the refusal to GUESS — the estimate must decline rather than read an
     * unreadable record as an empty one.
     */
    it('declines to estimate when the record could not be read', async () => {
        open(null);

        expect(await screen.findByText(/cannot be estimated/i)).toBeInTheDocument();
        expect(screen.queryByText('Not supplied')).not.toBeInTheDocument();
    });

    /** A dialog that opens on a suggestion it cannot support has already decided. */
    it('preselects nothing when the estimate is indeterminate', async () => {
        open(null);

        const group = await screen.findByRole('radiogroup', { name: 'Verdict' });
        for (const radio of within(group).getAllByRole('radio')) {
            expect(radio).not.toBeChecked();
        }
        expect(screen.getByRole('button', { name: /choose a verdict/i })).toBeDisabled();
    });

    it('preselects the estimate when there is one, and drafts its text', async () => {
        open(
            vendorVerificationFixture({
                documents: verificationDocumentsFixture({ selfieWithId: null }),
            }),
        );

        const group = await screen.findByRole('radiogroup', { name: 'Verdict' });
        expect(within(group).getByRole('radio', { name: /reject verification/i })).toBeChecked();
        // `toHaveValue` compares exactly, so read the value and match on it.
        expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toContain(
            'holding your ID card',
        );
    });
});

describe('the drafted reason', () => {
    /**
     * ⚠ **The one thing a convenience feature here must never do.** A rejection
     * reason is forwarded to jovi-mall and stored on the party's record, so
     * silently replacing a sentence somebody wrote would put words the operator
     * did not choose in front of the applicant, under their name.
     */
    it('stops drafting as soon as the operator types', async () => {
        const user = userEvent.setup();
        open(
            vendorVerificationFixture({
                documents: verificationDocumentsFixture({ selfieWithId: null }),
            }),
        );

        const reason = await screen.findByLabelText('Reason');
        await user.clear(reason);
        await user.type(reason, 'Call them first.');

        await user.click(screen.getByRole('radio', { name: /approve verification/i }));
        await user.click(screen.getByRole('radio', { name: /reject verification/i }));

        expect(screen.getByLabelText('Reason')).toHaveValue('Call them first.');
    });

    it('refuses to submit a rejection with no reason', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn(async () => {});
        open(vendorVerificationFixture(), onSubmit);

        await user.click(await screen.findByRole('radio', { name: /reject verification/i }));
        await user.clear(screen.getByLabelText('Reason'));
        await user.click(screen.getByRole('button', { name: /reject verification/i }));

        expect(await screen.findByText(/a reason is required/i)).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('hands the caller the verdict and the trimmed text', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn(async () => {});
        open(vendorVerificationFixture(), onSubmit);

        await user.click(await screen.findByRole('radio', { name: /reject verification/i }));
        const reason = screen.getByLabelText('Reason');
        await user.clear(reason);
        await user.type(reason, '  The ID scan is illegible.  ');
        await user.click(screen.getByRole('button', { name: /reject verification/i }));

        expect(onSubmit).toHaveBeenCalledWith('reject', 'The ID scan is illegible.');
    });
});
