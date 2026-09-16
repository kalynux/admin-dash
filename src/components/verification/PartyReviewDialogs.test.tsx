import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { ReviewAgencyVerificationDialog } from '@/components/verification/ReviewAgencyVerificationDialog';
import { ReviewAgentVerificationDialog } from '@/components/verification/ReviewAgentVerificationDialog';
import { agencyDetailFixture } from '@/test/agency-fixtures';
import { agentVerificationFixture, vendorVerificationFixture } from '@/test/verification-fixtures';
import { agentDetailFixture } from '@/test/agent-fixtures';
import { renderWithProviders, stubFetch } from '@/test/utils';

/**
 * The two wrappers `VendorDetail.test.tsx` does not already mount.
 *
 * They exist mainly to catch a crash in the *record context* block — the section
 * that reads whatever the surface already carries — because that block reaches
 * into a different shape on every party and a `null` where an object was assumed
 * would otherwise only show up in front of an operator.
 */
/** The panel loads the record; these dialogs are handed it. */
const RECORD = vendorVerificationFixture({ role: 'agency' });
const AGENT_RECORD = agentVerificationFixture();

describe('the agency review', () => {
    /**
     * ⚠ **The two typed strings are NOT repeated in the dialog**, and that is the
     * change this pins. They are the agency's `registrationNumber` and
     * `transportLicenseId`, and they live on the agency's **Overview** tab
     * (`AgencyProfilePanels`) — the dialog used to reprint them, which made it
     * taller than the viewport to show what was already two clicks behind it.
     *
     * ⚠ They must keep existing SOMEWHERE: they are the only registration
     * evidence this service forwards at all (BR-024), so a change that removes
     * them from the profile panel too has taken away the thing the verdict is
     * reached on.
     */
    it('does not repeat the typed registration strings, which live on the profile', async () => {
        stubFetch(() => {
            throw new Error('the review dialog fetches nothing on open');
        });

        renderWithProviders(
            <ReviewAgencyVerificationDialog
                agency={agencyDetailFixture()}
                record={RECORD}
                open
                onOpenChange={() => {}}
                onDone={() => {}}
                timeZone="Africa/Douala"
            />,
        );

        // The verdict form is what this dialog is now for.
        expect(await screen.findByRole('radiogroup', { name: 'Verdict' })).toBeInTheDocument();

        expect(screen.queryByText('RC/DLA/2019/B/1174')).not.toBeInTheDocument();
        expect(screen.queryByText('TL-CM-88421')).not.toBeInTheDocument();
    });

    /**
     * ⚠ `kyc.status` and `kyc.rejectionReason`, not `verified` and `status`.
     *
     * `pending_verification` is where an agency sits **both before a review and
     * after a refused one**, so deriving the verdict from the agency's status —
     * which this dashboard did, because `agencies.md` omits both fields — made a
     * re-applying agency look like one nobody had opened, and hid the sentence
     * they were given. That is the commonest row in the queue.
     */
    it('shows a refusal as a refusal, and the reason the agency was given', async () => {
        stubFetch(() => {
            throw new Error('the review dialog fetches nothing on open');
        });

        renderWithProviders(
            <ReviewAgencyVerificationDialog
                agency={agencyDetailFixture({
                    verified: false,
                    verifiedLegacyMirror: false,
                    status: 'pending_verification',
                    kyc: {
                        registrationNumber: 'RC/DLA/2019/B/1174',
                        transportLicenseId: 'TL-CM-88421',
                        status: 'rejected',
                        rejectionReason: 'Transport licence has expired.',
                        verifiedAt: null,
                        verifiedBy: null,
                    },
                })}
                record={RECORD}
                open
                onOpenChange={() => {}}
                onDone={() => {}}
                timeZone="Africa/Douala"
            />,
        );

        expect(await screen.findByText('rejected')).toBeInTheDocument();
        expect(screen.getByText(/Transport licence has expired\./)).toBeInTheDocument();
    });

    /**
     * ⚠ `POST /agencies/:agencyId/verify` takes `{}` and the schema is strict, so
     * the approval must offer no text field at all — one would collect something
     * the route answers `400` to.
     */
    it('offers no text field on the approval, because the route takes no body', async () => {
        stubFetch(() => {
            throw new Error('the review dialog fetches nothing on open');
        });

        renderWithProviders(
            <ReviewAgencyVerificationDialog
                agency={agencyDetailFixture({
                    verified: false,
                    verifiedLegacyMirror: false,
                    status: 'pending_verification',
                    kyc: {
                        registrationNumber: 'RC/DLA/2019/B/1174',
                        transportLicenseId: 'TL-CM-88421',
                        status: 'pending',
                        rejectionReason: null,
                        verifiedAt: null,
                        verifiedBy: null,
                    },
                })}
                record={RECORD}
                open
                onOpenChange={() => {}}
                onDone={() => {}}
                timeZone="Africa/Douala"
            />,
        );

        const group = await screen.findByRole('radiogroup', { name: 'Verdict' });
        expect(within(group).getByRole('radio', { name: /verify agency/i })).toBeInTheDocument();
        // Nothing is preselected — the estimate is indeterminate with no evidence —
        // so no text field is rendered for either verdict yet.
        expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    });
});

describe('the agent review', () => {
    /**
     * The complaint, on the surface where it is sharpest: `kyc.reference` is a
     * pointer to documents held somewhere this service cannot see, and it has been
     * the whole evidence base.
     */
    it('keeps the off-platform reference, under the verdict rather than above the checklist', async () => {
        stubFetch(() => {
            throw new Error('the review dialog fetches nothing on open');
        });

        renderWithProviders(
            <ReviewAgentVerificationDialog
                agent={agentDetailFixture()}
                record={AGENT_RECORD}
                open
                onOpenChange={() => {}}
                onDone={() => {}}
                timeZone="Africa/Douala"
            />,
        );

        expect(await screen.findByLabelText(/reference \(optional\)/i)).toHaveValue(
            'KYC-2025-00871',
        );
        expect(screen.getByText(/stores no documents of its own/i)).toBeInTheDocument();
    });

    /** Four statuses, not two — and this route publishes no conflict code, so none is filtered. */
    it('offers all four KYC statuses', async () => {
        stubFetch(() => {
            throw new Error('the review dialog fetches nothing on open');
        });

        renderWithProviders(
            <ReviewAgentVerificationDialog
                agent={agentDetailFixture()}
                record={AGENT_RECORD}
                open
                onOpenChange={() => {}}
                onDone={() => {}}
                timeZone="Africa/Douala"
            />,
        );

        const group = await screen.findByRole('radiogroup', { name: 'Verdict' });
        expect(within(group).getAllByRole('radio')).toHaveLength(4);
    });

    /**
     * ⚠ **The vehicle evidence is NOT repeated in the dialog either.** The
     * checklist row that asks for a photograph *with the agent beside the
     * vehicle* is on the Verification tab, built by `buildChecks` from
     * `documents.vehicleWithAgent` — so the distinction it draws against the
     * plain `vehicle.photoFileId` on the record survives this removal. What must
     * not come back is a second copy of it here.
     */
    it('does not repeat the vehicle evidence, which lives on the tab', async () => {
        stubFetch(() => {
            throw new Error('the review dialog fetches nothing on open');
        });

        renderWithProviders(
            <ReviewAgentVerificationDialog
                agent={agentDetailFixture()}
                record={AGENT_RECORD}
                open
                onOpenChange={() => {}}
                onDone={() => {}}
                timeZone="Africa/Douala"
            />,
        );

        expect(await screen.findByRole('radiogroup', { name: 'Verdict' })).toBeInTheDocument();

        expect(
            screen.queryByText('Vehicle photograph, with the agent beside it'),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/bike · red · LT-4471-CM/)).not.toBeInTheDocument();
    });
});
