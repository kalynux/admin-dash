import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { PARTY_NAME_SOURCE_LABELS, type ResolvedPartyName } from '@/lib/party';

/**
 * A party, as a name over a copyable id — or as an id alone where there is no
 * name.
 *
 * ── ⚠ Why the two renders are not the same render ────────────────────────────
 * `partyName()` falls through to the id, so "the label" and "the identifier" are
 * the same string on a row that never carried a name. Printing the id beneath
 * itself would be noise, and printing the label *without* the affordance would
 * take the copy button away from exactly the rows that need it most. So the
 * branch is on `kind`: an `own` name gets a name and a value under it, and an
 * `identifier` gets one copyable value and nothing else.
 *
 * ⚠ It is `kind`, never `party.value === id`. Those agree today and would stop
 * agreeing the moment a party's fallback chain grew an email — which four of the
 * five domain helpers already have — and the failure would be a silently
 * duplicated line rather than a compile error.
 */
export function PartyValue({
    party,
    id,
    idLabel,
    to,
    after,
}: {
    party: ResolvedPartyName;
    id: string;
    idLabel: string;
    /** Where the *name* links, when the reader may follow it. */
    to?: string;
    /** A sibling affordance, rendered beside the id. */
    after?: ReactNode;
}) {
    const identifierOnly = party.kind === 'identifier' && party.value === id;

    const value = (
        <CopyableValue
            variant="id"
            value={id}
            label={idLabel}
            truncate={false}
            // The link belongs to the name when there is one; on an
            // identifier-only render there is no name to carry it.
            to={identifierOnly ? to : undefined}
        />
    );

    if (identifierOnly) {
        return (
            <span className="flex flex-wrap items-center gap-2">
                {value}
                {after}
            </span>
        );
    }

    return (
        <div className="space-y-1">
            <div>
                {to ? (
                    <Link to={to} className="hover:underline">
                        {party.value}
                    </Link>
                ) : (
                    party.value
                )}
                {/* ⚠ `businessName` is a business and `contactName` is a person.
                    Nothing here can fall through to a contact today, but the
                    label is what stops a future candidate from quietly renaming
                    a company after whoever answers its phone. */}
                {party.kind === 'contact' ? (
                    <span className="text-muted-foreground text-xs">
                        {' '}
                        · {PARTY_NAME_SOURCE_LABELS[party.source]}
                    </span>
                ) : null}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                {value}
                {after}
            </div>
        </div>
    );
}
