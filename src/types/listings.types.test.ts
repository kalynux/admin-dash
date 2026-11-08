/**
 * The transcription guard for service listings.
 *
 * `listings.md` gives routes, bodies and permissions and **no response shapes**,
 * so `listings.types.ts` was written from five verbatim copies of wi-admin
 * source in `api-doc/admin/` — the three read-model DTOs and the two
 * validators. This suite diffs against them: the vocabularies in order, and
 * every fixture's keys against the interface (or, for the detail, the mapper's
 * `return`) it stands for. ⚠ A failure here means wi-admin moved: re-copy the
 * mirror and reconcile, never loosen the assertion.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    contactSetFixture,
    leadAccountRoleFixture,
    leadBlockFixture,
    leadConsentFixture,
    leadCustomerFixture,
    leadRevealFixture,
    listingContactsFixture,
    listingContentFixture,
    listingDetailFixture,
    listingLeadDetailFixture,
    listingLeadFixture,
    listingLeadTicketContextFixture,
    listingQueueItemFixture,
    otherLeadsFixture,
} from '@/test/listing-fixtures';
import {
    LISTING_ACTIONS,
    LISTING_CONTACT_FIELDS,
    LISTING_LEAD_CHANNELS,
    LISTING_LEAD_SORT_KEYS,
    LISTING_NOTE_MAX,
    LISTING_NOTE_MIN,
    LISTING_REJECT_REASONS_MAX,
    LISTING_REPORT_WANTS,
    LISTING_REVIEW_STATES,
    LISTING_SORT_KEYS,
    LISTING_STATUSES,
    LISTING_SUSPENSION_REASONS,
    PROVIDER_CONSENT_STATES,
    canRefundReveal,
    changedListingFields,
    copyUnderReview,
    listingContactFieldLabel,
    listingName,
    listingOffers,
    listingStatusLabel,
    preflagFieldLabel,
    preflagKindLabel,
} from '@/types/listings.types';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
    readFileSync(resolve(here, `../../api-doc/admin/${name}`), 'utf8').replace(/\r\n/g, '\n');

const DTO = read('listing-dto.ts');
const CONTACTS = read('listing-contacts-dto.ts');
const LEAD = read('listing-lead-dto.ts');
const VALIDATOR = read('listing-validator.ts');
const REPORTS = read('listing-reports-validator.ts');

/** The members of `export const NAME = [ … ] as const;`. */
function list(source: string, name: string): string[] {
    const declaration = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(source);
    if (!declaration) throw new Error(`${name} is not declared in the mirror`);
    return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** The keys of `export const NAME = { key: …, } as const;`. */
function objectKeys(source: string, name: string): string[] {
    const declaration = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(source);
    if (!declaration) throw new Error(`${name} is not declared in the mirror`);
    return [...declaration[1].matchAll(/^ {4}([a-zA-Z]+):/gm)].map((match) => match[1]);
}

/** The top-level keys of `export interface NAME [extends …] { … }`, comments stripped. */
function keys(source: string, name: string): string[] {
    const head = new RegExp(`export interface ${name}(?: extends [A-Za-z]+)? \\{`).exec(source);
    if (!head) throw new Error(`${name} is not declared in the mirror`);
    const end = source.indexOf('\n}', head.index);
    const body = source.slice(head.index + head[0].length, end).replace(/\/\*[\s\S]*?\*\//g, '');
    return [...body.matchAll(/^ {4}([a-zA-Z]+)\??:/gm)].map((match) => match[1]);
}

/** The keys of the object a block between `start` and `stop` builds at `indent` spaces. */
function builtKeys(source: string, start: string, stop: string, indent: number): string[] {
    const from = source.indexOf(start);
    if (from === -1) throw new Error(`"${start}" is not in the mirror`);
    const to = source.indexOf(stop, from + start.length);
    const body = source.slice(from, to);
    return [...body.matchAll(new RegExp(`^ {${indent}}([a-zA-Z]+)(?:,|:)`, 'gm'))].map((match) => match[1]);
}

const sorted = (values: readonly string[]) => [...values].sort();

describe('the vocabularies wi-admin pins', () => {
    it.each([
        ['LISTING_STATUSES', VALIDATOR, LISTING_STATUSES],
        ['LISTING_REVIEW_STATES', VALIDATOR, LISTING_REVIEW_STATES],
        ['LISTING_SUSPENSION_REASONS', VALIDATOR, LISTING_SUSPENSION_REASONS],
        ['LISTING_CONTACT_FIELDS', VALIDATOR, LISTING_CONTACT_FIELDS],
        ['LISTING_LEAD_CHANNELS', REPORTS, LISTING_LEAD_CHANNELS],
        ['LISTING_REPORT_WANTS', REPORTS, LISTING_REPORT_WANTS],
        ['PROVIDER_CONSENT_STATES', REPORTS, PROVIDER_CONSENT_STATES],
    ] as const)('%s matches the mirror, order included', (name, source, ours) => {
        expect([...ours]).toEqual(list(source, name));
    });

    it('sorts on exactly the keys each list allows', () => {
        expect([...LISTING_SORT_KEYS]).toEqual(objectKeys(VALIDATOR, 'LISTING_SORT'));
        expect([...LISTING_LEAD_SORT_KEYS]).toEqual(objectKeys(REPORTS, 'LISTING_LEAD_SORT'));
    });

    it('knows every action availableActions can name', () => {
        const union = /export type ListingAction = ([^;]+);/.exec(DTO);
        expect(union).not.toBeNull();
        expect([...LISTING_ACTIONS]).toEqual([...union![1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    });

    it('limits notes and reasons as the bodies do', () => {
        // Every note on these routes is `.min(3).max(500)`, and reject takes 1–5.
        expect(VALIDATOR).toContain('z.array(z.string().trim().min(3).max(500)).min(1).max(5)');
        expect(REPORTS).toContain('const note = z.string().trim().min(3).max(500);');
        expect([LISTING_NOTE_MIN, LISTING_NOTE_MAX, LISTING_REJECT_REASONS_MAX]).toEqual([3, 500, 5]);
    });
});

describe('the fixtures carry exactly the keys the mirrors emit', () => {
    it('the queue row', () => {
        expect(sorted(Object.keys(listingQueueItemFixture()))).toEqual(sorted(keys(DTO, 'ListingQueueItemDto')));
    });

    it('one copy of the public content', () => {
        expect(sorted(Object.keys(listingContentFixture()))).toEqual(sorted(keys(DTO, 'ListingContentDto')));
    });

    it('the detail — read off the mapper, because it has no interface', () => {
        const detail = listingDetailFixture();
        expect(sorted(Object.keys(detail))).toEqual(
            sorted(builtKeys(DTO, 'export function toListingDetailDto', '\n    };\n}', 8)),
        );
        expect(sorted(Object.keys(detail.vendor))).toEqual(sorted(keys(DTO, 'ListingVendorSummaryDto')));
        expect(sorted(Object.keys(detail.review!))).toEqual(
            sorted(builtKeys(DTO, 'const review = row.review', ': null;', 12)),
        );
    });

    it('the hidden contacts', () => {
        expect(sorted(Object.keys(listingContactsFixture()))).toEqual(sorted(keys(CONTACTS, 'ListingContactsDto')));
        expect(sorted(Object.keys(contactSetFixture()))).toEqual(sorted(keys(CONTACTS, 'ListingContactSetDto')));
    });

    it.each([
        ['LeadCustomerDto', () => leadCustomerFixture()],
        ['LeadRevealDto', () => leadRevealFixture()],
        ['LeadBlockDto', () => leadBlockFixture()],
        ['LeadConsentDto', () => leadConsentFixture()],
        ['ListingLeadDto', () => listingLeadFixture()],
        ['LeadAccountRoleDto', () => leadAccountRoleFixture()],
        ['OtherLeadsDto', () => otherLeadsFixture()],
        ['ListingLeadTicketContextDto', () => listingLeadTicketContextFixture()],
    ] as const)('%s', (name, make) => {
        expect(sorted(Object.keys(make()))).toEqual(sorted(keys(LEAD, name)));
    });

    it('the lead in full — the row plus four', () => {
        expect(sorted(Object.keys(listingLeadDetailFixture()))).toEqual(
            sorted([...keys(LEAD, 'ListingLeadDto'), ...keys(LEAD, 'ListingLeadDetailDto')]),
        );
    });
});

describe('the rules the screens share', () => {
    it('offers a verb only when the server names it', () => {
        expect(listingOffers(listingDetailFixture(), 'approve')).toBe(true);
        expect(listingOffers(listingDetailFixture(), 'suspend')).toBe(false);
    });

    it('judges the copy under review, and falls back to the live one', () => {
        const pending = listingContentFixture({ title: 'New title' });
        const live = listingContentFixture({ title: 'Old title' });
        expect(copyUnderReview(listingDetailFixture({ published: live, pending }))?.title).toBe('New title');
        expect(
            copyUnderReview(listingDetailFixture({ published: live, pending, review: null }))?.title,
        ).toBe('Old title');
    });

    it('says which fields a change to a live listing touches', () => {
        const live = listingContentFixture();
        const next = listingContentFixture({ description: 'Call me on 690 00 01 11', photos: [] });
        expect([...changedListingFields(live, next)].sort()).toEqual(['description', 'photos']);
        expect(changedListingFields(null, next).size).toBe(0);
    });

    it('refunds an unlock once', () => {
        expect(canRefundReveal(leadRevealFixture())).toBe(true);
        expect(canRefundReveal(leadRevealFixture({ refunded: true }))).toBe(false);
    });

    it('names a listing with no title by its company, then its slug, then its id', () => {
        expect(listingName({ id: 'x', title: '  ', companyName: 'Akwa', slug: 's' })).toBe('Akwa');
        expect(listingName({ id: 'x', title: null, companyName: null, slug: null })).toBe('x');
    });
});

describe('open vocabularies render, never throw', () => {
    it('prints an unknown value in words', () => {
        expect(listingStatusLabel('under_appeal')).toBe('under appeal');
        expect(listingContactFieldLabel('telegram')).toBe('telegram');
        expect(preflagKindLabel('iban')).toBe('iban');
    });

    it('turns jovi-mall storage names into field names', () => {
        expect(preflagFieldLabel('company_name')).toBe('Company name');
        expect(preflagFieldLabel('description_rich')).toBe('Description');
    });
});
