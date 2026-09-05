import { describe, expect, it } from 'vitest';

import {
    PARTY_NAME_SOURCE_LABELS,
    isRolePlaceholderName,
    partyName,
    resolvePartyName,
    type PartyNameCandidate,
} from '@/lib/party';
import { administratorDisplayName } from '@/types/administrators.types';
import { agencyDisplayName, resolveAgencyDisplayName } from '@/types/agencies.types';
import { agentDisplayName } from '@/types/agents.types';
import { userDisplayName } from '@/types/users.types';
import { vendorDisplayName } from '@/types/vendors.types';

describe('resolvePartyName — the fallback rule itself', () => {
    it('takes the first candidate that says something', () => {
        expect(
            resolvePartyName(
                [
                    { source: 'businessName', value: 'Littoral Express Delivery' },
                    { source: 'contactName', value: 'Nadège M.' },
                ],
                { source: 'id', value: '665c000000000000000000aa' },
            ),
        ).toEqual({
            value: 'Littoral Express Delivery',
            source: 'businessName',
            kind: 'own',
        });
    });

    it('steps to the next candidate for each way a value can be absent', () => {
        const absent: readonly (string | null | undefined)[] = [null, undefined, '', '   ', '\t\n'];

        for (const value of absent) {
            expect(
                resolvePartyName(
                    [
                        { source: 'businessName', value },
                        { source: 'contactName', value: 'Nadège M.' },
                    ],
                    { source: 'id', value: '665c000000000000000000aa' },
                ).source,
            ).toBe('contactName');
        }
    });

    it('walks the whole list before reaching the fallback', () => {
        expect(
            resolvePartyName(
                [
                    { source: 'businessName', value: null },
                    { source: 'displayName', value: '' },
                    { source: 'email', value: '   ' },
                    { source: 'phone', value: undefined },
                ],
                { source: 'id', value: '665c000000000000000000aa' },
            ),
        ).toEqual({
            value: '665c000000000000000000aa',
            source: 'id',
            kind: 'identifier',
        });
    });

    it('returns the fallback when there are no candidates at all', () => {
        expect(resolvePartyName([], { source: 'email', value: 'ops@wi.cm' })).toEqual({
            value: 'ops@wi.cm',
            source: 'email',
            kind: 'identifier',
        });
    });

    it('trims the value it returns', () => {
        expect(
            resolvePartyName([{ source: 'businessName', value: '  Littoral Express  ' }], {
                source: 'id',
                value: 'x',
            }).value,
        ).toBe('Littoral Express');
    });

    it('returns a blank fallback rather than nothing, because there is nothing else', () => {
        // Unreachable from the five helpers — an id is 24 hex and an
        // administrator's email is required — but the function must still be
        // total rather than returning an empty-ish `undefined`.
        expect(resolvePartyName([], { source: 'id', value: '   ' }).value).toBe('   ');
    });
});

describe('the source travels with the value', () => {
    // ⚠ The reason this API exists. `businessName` is the business and
    // `contactName` is a person; BR-006 was granted because an "Agency" column
    // rendered the second under a heading that promised the first.
    const business: PartyNameCandidate = { source: 'businessName', value: 'Littoral Express' };
    const contact: PartyNameCandidate = { source: 'contactName', value: 'Nadège M.' };
    const id = { source: 'id', value: '665c000000000000000000aa' } as const;

    it('a businessName hit is distinguishable from a contactName fallthrough', () => {
        const hit = resolvePartyName([business, contact], id);
        const fell = resolvePartyName([{ ...business, value: null }, contact], id);

        // Both are non-empty strings, which is precisely why the bare string
        // form cannot tell a caller which one it got.
        expect(hit.value).not.toBe(fell.value);
        expect(hit.source).toBe('businessName');
        expect(fell.source).toBe('contactName');
        expect(hit.kind).toBe('own');
        expect(fell.kind).toBe('contact');
    });

    it('classifies every source it can return', () => {
        const kindOf = (candidate: PartyNameCandidate) =>
            resolvePartyName([candidate], id).kind;

        expect(kindOf({ source: 'businessName', value: 'Acme' })).toBe('own');
        expect(kindOf({ source: 'displayName', value: 'Acme' })).toBe('own');
        expect(kindOf({ source: 'name', value: 'Paul' })).toBe('own');
        expect(kindOf({ source: 'contactName', value: 'Paul' })).toBe('contact');
        expect(kindOf({ source: 'email', value: 'a@b.cm' })).toBe('identifier');
        expect(kindOf({ source: 'phone', value: '+237600000000' })).toBe('identifier');
        expect(resolvePartyName([], id).kind).toBe('identifier');
    });

    it('carries the wording BR-006 settled on for the demoted sub-line', () => {
        expect(PARTY_NAME_SOURCE_LABELS.contactName).toBe('Contact person');
    });

    it('partyName is the same answer with the source dropped', () => {
        expect(partyName([business, contact], id)).toBe(
            resolvePartyName([business, contact], id).value,
        );
        expect(partyName([{ ...business, value: '' }, contact], id)).toBe('Nadège M.');
    });
});

// ─── The five helpers still answer what they answered before ──────────────────
//
// The regression that matters: each keeps its own candidate order and its own
// `Pick<…>`, and only the whitespace reading changed.

describe('vendorDisplayName', () => {
    const vendor = {
        id: '665c000000000000000000aa',
        businessName: 'Boutique Nkolo',
        displayName: 'Nkolo',
        email: 'nkolo@wi.cm',
        phone: '+237600000000',
    };

    it('prefers the business name', () => {
        expect(vendorDisplayName(vendor)).toBe('Boutique Nkolo');
    });

    it('falls through displayName, email, phone, then the id', () => {
        expect(vendorDisplayName({ ...vendor, businessName: null })).toBe('Nkolo');
        expect(vendorDisplayName({ ...vendor, businessName: null, displayName: null })).toBe(
            'nkolo@wi.cm',
        );
        expect(
            vendorDisplayName({
                ...vendor,
                businessName: null,
                displayName: null,
                email: null,
            }),
        ).toBe('+237600000000');
        expect(
            vendorDisplayName({
                ...vendor,
                businessName: null,
                displayName: null,
                email: null,
                phone: null,
            }),
        ).toBe('665c000000000000000000aa');
    });

    it('⚠ behaviour change: a whitespace-only business name no longer wins', () => {
        expect(vendorDisplayName({ ...vendor, businessName: '   ' })).toBe('Nkolo');
    });
});

describe('agencyDisplayName', () => {
    const agency = {
        id: '665c000000000000000000bb',
        businessName: 'Littoral Express Delivery',
        contactName: 'Nadège M.',
    };

    it('prefers the business name over the contact person', () => {
        expect(agencyDisplayName(agency)).toBe('Littoral Express Delivery');
    });

    it('falls through to the contact, then to the id', () => {
        expect(agencyDisplayName({ ...agency, businessName: null })).toBe('Nadège M.');
        expect(agencyDisplayName({ ...agency, businessName: null, contactName: null })).toBe(
            '665c000000000000000000bb',
        );
    });

    it('⚠ the resolved form says when the label is a person, not the business', () => {
        expect(resolveAgencyDisplayName(agency).kind).toBe('own');
        expect(resolveAgencyDisplayName({ ...agency, businessName: null })).toEqual({
            value: 'Nadège M.',
            source: 'contactName',
            kind: 'contact',
        });
    });

    it('⚠ behaviour change: a whitespace-only business name no longer wins', () => {
        // It used `??`, so `""` and `"   "` were names and the cell rendered blank.
        expect(agencyDisplayName({ ...agency, businessName: '' })).toBe('Nadège M.');
        expect(agencyDisplayName({ ...agency, businessName: '  ', contactName: '  ' })).toBe(
            '665c000000000000000000bb',
        );
    });
});

describe('agentDisplayName', () => {
    const agent = { id: '665c000000000000000000cc', name: 'Paul Mbarga', email: 'paul@wi.cm' };

    it('prefers the name, then the email, then the id', () => {
        expect(agentDisplayName(agent)).toBe('Paul Mbarga');
        expect(agentDisplayName({ ...agent, name: null })).toBe('paul@wi.cm');
        expect(agentDisplayName({ ...agent, name: null, email: null })).toBe(
            '665c000000000000000000cc',
        );
    });

    it('⚠ behaviour change: a whitespace-only name no longer wins', () => {
        expect(agentDisplayName({ ...agent, name: ' ' })).toBe('paul@wi.cm');
    });
});

describe('userDisplayName', () => {
    const user = { id: '665c000000000000000000dd', email: 'client@wi.cm', phone: '+237600000001' };

    it('prefers the email, then the phone, then the id', () => {
        expect(userDisplayName(user)).toBe('client@wi.cm');
        expect(userDisplayName({ ...user, email: null })).toBe('+237600000001');
        expect(userDisplayName({ ...user, email: null, phone: null })).toBe(
            '665c000000000000000000dd',
        );
    });

    it('⚠ behaviour change: a whitespace-only email no longer wins', () => {
        expect(userDisplayName({ ...user, email: '  ' })).toBe('+237600000001');
    });
});

describe('administratorDisplayName', () => {
    it('is unchanged — it already guarded with .trim() ||', () => {
        expect(administratorDisplayName({ displayName: 'Ada L.', email: 'ada@wi.cm' })).toBe(
            'Ada L.',
        );
        expect(administratorDisplayName({ displayName: '   ', email: 'ada@wi.cm' })).toBe(
            'ada@wi.cm',
        );
        expect(administratorDisplayName({ displayName: '  Ada L.  ', email: 'ada@wi.cm' })).toBe(
            'Ada L.',
        );
    });
});

describe('isRolePlaceholderName — when a "name" is not a name', () => {
    /**
     * 🔴 jovi-mall resolves an actor against its own collections and **falls
     * back to the capitalised role when it matches nothing, silently**. For an
     * administrator it can never match: there is no row to find (ADR-004 D-1,
     * the synthetic actor). This equality is the only signal there is.
     */
    it('catches the administrator placeholder', () => {
        expect(isRolePlaceholderName('Admin', 'admin')).toBe(true);
    });

    it.each(['Customer', 'Vendor', 'Agency', 'Agent'])(
        'catches %s, which is what a deleted profile comes back as',
        (name) => {
            expect(isRolePlaceholderName(name, name.toLowerCase())).toBe(true);
        },
    );

    it('leaves a real name alone', () => {
        expect(isRolePlaceholderName('Amina Bekele', 'customer')).toBe(false);
        expect(isRolePlaceholderName('Adminah Nkemdirim', 'admin')).toBe(false);
    });

    /**
     * ⚠ **Compares shapes, not spellings.** Anchoring on the exact
     * capitalisation would make the guard silently stop working the day
     * upstream changes how it capitalises — and a guard that stops working
     * without failing is the failure mode this whole rule exists to prevent.
     */
    it('sees through case and word separators', () => {
        expect(isRolePlaceholderName('Delivery Agent', 'delivery_agent')).toBe(true);
        expect(isRolePlaceholderName('  admin  ', 'ADMIN')).toBe(true);
    });

    /** With nothing to compare against there is no evidence either way. */
    it('answers false when either side is missing', () => {
        expect(isRolePlaceholderName('Admin', null)).toBe(false);
        expect(isRolePlaceholderName(null, 'admin')).toBe(false);
        expect(isRolePlaceholderName('   ', 'admin')).toBe(false);
        expect(isRolePlaceholderName(undefined, undefined)).toBe(false);
    });
});
