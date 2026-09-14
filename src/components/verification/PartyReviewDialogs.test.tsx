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
    it('shows the two strings the verdict has been reached on, and says what they are worth', async () => {
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

        expect(await screen.findByText('RC/DLA/2019/B/1174')).toBeInTheDocument();
        expect(screen.getByText('TL-CM-88421')).toBeInTheDocument();
        expect(screen.getByText(/identify a claim rather than corroborate one/i)).toBeInTheDocument();
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
     * ⚠ `vehicle.photoFileId` is *"photo of the vehicle"*; the checklist row asks
     * for one with the agent in the frame. They are rendered in different sections
     * so nobody ticks the second by looking at the first.
     */
    it('separates the vehicle photograph on the record from the vehicle check', async () => {
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

        expect(
            await screen.findByText('Vehicle photograph, with the agent beside it'),
        ).toBeInTheDocument();
        expect(screen.getByText(/bike · red · LT-4471-CM/)).toBeInTheDocument();
    });
});
