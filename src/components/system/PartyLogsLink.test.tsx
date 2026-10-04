import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { PartyLogsLink } from '@/components/system/PartyLogsLink';
import { platformLogsPathFor } from '@/lib/log-entry';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';

const USER_ID = 'a1'.repeat(12);

describe('PartyLogsLink', () => {
    it('links a developer to Platform logs already narrowed to this person', () => {
        renderWithProviders(<PartyLogsLink userId={USER_ID} />, {
            permissions: { held: heldFixture(1) },
        });

        expect(screen.getByRole('link', { name: /view logs/i })).toHaveAttribute(
            'href',
            `/dashboard/dev-tools/logs?actorId=${USER_ID}`,
        );
    });

    /** Log lines carry personal data; the link must not lead tier 2 or 3 to a refusal. */
    it.each([2, 3] as const)('is absent for tier %i, who cannot read the logs', (tier) => {
        renderWithProviders(<PartyLogsLink userId={USER_ID} />, {
            permissions: { held: heldFixture(tier) },
        });

        expect(screen.queryByRole('link', { name: /view logs/i })).not.toBeInTheDocument();
    });

    it('renders nothing without a user id', () => {
        const { container } = renderWithProviders(<PartyLogsLink userId={null} />, {
            permissions: { held: heldFixture(1) },
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('encodes the id as a query value', () => {
        expect(platformLogsPathFor(USER_ID)).toBe(`/dashboard/dev-tools/logs?actorId=${USER_ID}`);
    });
});
