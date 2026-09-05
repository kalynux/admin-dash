import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { PartyValue } from '@/components/common/PartyValue';
import { resolvePartyName } from '@/lib/party';
import { renderWithProviders } from '@/test/utils';

const ID = '6650aa11bb22cc33dd44ee55';

describe('a party that has a name', () => {
    it('shows the name over the id, with the id copyable and the name linked', () => {
        renderWithProviders(
            <PartyValue
                party={resolvePartyName(
                    [{ source: 'businessName', value: 'Douala Fresh Market' }],
                    { source: 'id', value: ID },
                )}
                id={ID}
                idLabel="vendor ID"
                to="/dashboard/vendors/x"
            />,
        );

        expect(screen.getByRole('link', { name: 'Douala Fresh Market' })).toBeInTheDocument();
        expect(screen.getByText(ID)).toBeInTheDocument();
        // ⚠ The affordance is on the id, never on the name: a copy button beside
        // a name copies a *name*, which is not a value anybody pastes anywhere.
        expect(screen.getByRole('button', { name: /copy vendor id/i })).toBeInTheDocument();
    });

    /**
     * ⚠ **The BR-006 trap.** `businessName` is the business and `contactName` is
     * a person, so a column headed "Vendor" or "Agency" that fell through to a
     * contact has been showing a human's name where a company was meant. The
     * fallback is allowed; the silence is not.
     */
    it('says so when the label is a contact person rather than the party', () => {
        renderWithProviders(
            <PartyValue
                party={resolvePartyName(
                    [
                        { source: 'businessName', value: null },
                        { source: 'contactName', value: 'Ada Nkemelu' },
                    ],
                    { source: 'id', value: ID },
                )}
                id={ID}
                idLabel="agency ID"
            />,
        );

        expect(screen.getByText('Ada Nkemelu')).toBeInTheDocument();
        expect(screen.getByText(/contact person/i)).toBeInTheDocument();
    });
});

describe('a party that has none', () => {
    /**
     * ⚠ Branching on `kind`, not on `party.value === id`. The two agree here and
     * would stop agreeing the moment a fallback chain grew an email — four of
     * the five domain helpers already have one — and the failure would be a
     * silently duplicated line rather than a compile error.
     */
    it('renders the id once, not as a heading over itself', () => {
        renderWithProviders(
            <PartyValue
                party={resolvePartyName([{ source: 'name', value: null }], {
                    source: 'id',
                    value: ID,
                })}
                id={ID}
                idLabel="vendor ID"
                to="/dashboard/vendors/x"
            />,
        );

        expect(screen.getAllByText(ID)).toHaveLength(1);
        // The link moves onto the id, because there is no name left to carry it.
        expect(screen.getByRole('link', { name: ID })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy vendor id/i })).toBeInTheDocument();
    });

    /**
     * An identifier that is *not* the id — an email standing in for a name —
     * keeps the two lines, because they are two different values and the id is
     * still the one worth copying.
     */
    it('keeps the id beneath an email that stood in for the name', () => {
        renderWithProviders(
            <PartyValue
                party={resolvePartyName(
                    [
                        { source: 'businessName', value: '   ' },
                        { source: 'email', value: 'shop@example.cm' },
                    ],
                    { source: 'id', value: ID },
                )}
                id={ID}
                idLabel="vendor ID"
            />,
        );

        expect(screen.getByText('shop@example.cm')).toBeInTheDocument();
        expect(screen.getByText(ID)).toBeInTheDocument();
    });
});
