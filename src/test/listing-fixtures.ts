/**
 * Wire-shaped service-listing fixtures (2026-11-07).
 *
 * Key for key what wi-admin's DTOs emit — `listings.types.test.ts` diffs each
 * factory's keys against the mirrored interfaces, so a field added upstream
 * fails there before a screen quietly ignores it.
 */

import type { FileDetail } from '@/types/files.types';
import type {
    LeadAccountRole,
    LeadBlock,
    LeadConsent,
    LeadCustomer,
    LeadReveal,
    ListingContactSet,
    ListingContacts,
    ListingContent,
    ListingDetail,
    ListingLead,
    ListingLeadDetail,
    ListingLeadTicketContext,
    ListingQueueItem,
    OtherLeads,
} from '@/types/listings.types';

export const LISTING_ID = '6730aabbccddeeff00112201';
export const VENDOR_ID = '6730aabbccddeeff00112202';
export const LEAD_ID = '6730aabbccddeeff00112203';
export const REVEAL_ID = '6730aabbccddeeff00112204';
export const SECOND_REVEAL_ID = '6730aabbccddeeff00112205';
export const CUSTOMER_ID = '6730aabbccddeeff00112206';
export const CUSTOMER_USER_ID = '6730aabbccddeeff00112207';
export const TICKET_ID = '6730aabbccddeeff00112208';

export function listingPhotoFixture(overrides: Partial<FileDetail> = {}): FileDetail {
    return {
        id: '6730aabbccddeeff00113301',
        key: 'images/listings/front.webp',
        url: 'https://cdn.example.test/images/listings/front.webp',
        access: 'public',
        mimeType: 'image/webp',
        size: 48_120,
        originalName: 'front.webp',
        ...overrides,
    };
}

export function listingQueueItemFixture(overrides: Partial<ListingQueueItem> = {}): ListingQueueItem {
    return {
        id: LISTING_ID,
        slug: 'plomberie-akwa',
        status: 'pending_review',
        reviewState: 'pending_review',
        isRevision: false,
        title: 'Plumbing repairs in Akwa',
        companyName: 'Akwa Plomberie',
        city: 'Douala',
        submittedAt: '2026-11-06T08:30:00.000Z',
        preflagCount: 0,
        suspensionReason: null,
        vendor: { id: VENDOR_ID, displayName: 'Akwa Plomberie SARL' },
        publishedAt: null,
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-06T08:30:00.000Z',
        ...overrides,
    };
}

export function listingContentFixture(overrides: Partial<ListingContent> = {}): ListingContent {
    return {
        title: 'Plumbing repairs in Akwa',
        companyName: 'Akwa Plomberie',
        categories: [{ id: '6730aabbccddeeff00114401', name: 'Plumbing', slug: 'plumbing' }],
        country: 'Cameroon',
        city: 'Douala',
        area: 'Akwa',
        description: 'Leaks, blocked drains and new installations. Same-day visits.',
        descriptionRich: null,
        photos: [listingPhotoFixture()],
        openingHours: [
            { day: 'monday', openTime: '08:00', closeTime: '18:00', isClosed: false },
            { day: 'sunday', openTime: null, closeTime: null, isClosed: true },
        ],
        ...overrides,
    };
}

export function listingDetailFixture(overrides: Partial<ListingDetail> = {}): ListingDetail {
    return {
        id: LISTING_ID,
        slug: 'plomberie-akwa',
        status: 'pending_review',
        vendor: {
            id: VENDOR_ID,
            displayName: 'Akwa Plomberie SARL',
            status: 'active',
            kind: 'provider',
            kycStatus: 'verified',
            verified: true,
        },
        published: null,
        pending: listingContentFixture(),
        isRevision: false,
        review: {
            state: 'pending_review',
            submittedAt: '2026-11-06T08:30:00.000Z',
            decidedAt: null,
            decidedBy: null,
            reasons: [],
            preflags: [],
            indexFeeRef: '6730aabbccddeeff00115501',
        },
        lastDecision: null,
        suspension: null,
        availableFields: [],
        counts: { leads: 0, reveals: 0 },
        availableActions: ['approve', 'reject'],
        vectorisationStatus: null,
        publishedAt: null,
        archivedAt: null,
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-06T08:30:00.000Z',
        ...overrides,
    };
}

/** A live listing, no review waiting — Take offline is the one verb. */
export function liveListingFixture(overrides: Partial<ListingDetail> = {}): ListingDetail {
    return listingDetailFixture({
        status: 'live',
        published: listingContentFixture(),
        pending: null,
        review: {
            state: 'editing',
            submittedAt: '2026-11-01T08:30:00.000Z',
            decidedAt: '2026-11-01T12:00:00.000Z',
            decidedBy: { id: '6730aabbccddeeff00116601', source: 'admin', name: 'Brice N.' },
            reasons: [],
            preflags: [],
            indexFeeRef: null,
        },
        lastDecision: {
            decision: 'approved',
            at: '2026-11-01T12:00:00.000Z',
            by: { id: '6730aabbccddeeff00116601', source: 'admin', name: 'Brice N.' },
            reasons: [],
        },
        availableFields: ['whatsapp', 'phone', 'video'],
        counts: { leads: 3, reveals: 5 },
        availableActions: ['suspend'],
        publishedAt: '2026-11-01T12:00:00.000Z',
        ...overrides,
    });
}

export function contactSetFixture(overrides: Partial<ListingContactSet> = {}): ListingContactSet {
    return {
        whatsapp: '+237690000111',
        phone: '+237690000222',
        email: 'contact@akwa-plomberie.test',
        website: 'https://akwa-plomberie.test',
        socials: [{ network: 'facebook', url: 'https://facebook.com/akwaplomberie' }],
        location: {
            address: 'Rue Joss, Akwa, Douala',
            latitude: 4.0511,
            longitude: 9.7679,
            components: {
                street: 'Rue Joss',
                neighbourhood: 'Akwa',
                city: 'Douala',
                region: 'Littoral',
                country: 'Cameroon',
                countryCode: 'CM',
            },
        },
        video: { url: 'https://youtu.be/abc123', host: 'youtube', checkedAt: '2026-11-06T08:31:00.000Z' },
        ...overrides,
    };
}

export function listingContactsFixture(overrides: Partial<ListingContacts> = {}): ListingContacts {
    return { listingId: LISTING_ID, published: null, pending: contactSetFixture(), ...overrides };
}

export function leadCustomerFixture(overrides: Partial<LeadCustomer> = {}): LeadCustomer {
    return {
        id: CUSTOMER_ID,
        userId: CUSTOMER_USER_ID,
        name: 'Jean-Paul Kamga',
        phone: '+237677123431',
        email: 'jp.kamga@example.test',
        profileStatus: 'active',
        accountStatus: 'active',
        profileCreatedAt: '2026-11-04T07:00:00.000Z',
        accountCreatedAt: '2026-11-04T07:00:00.000Z',
        accountClosedAt: null,
        ...overrides,
    };
}

export function leadRevealFixture(overrides: Partial<LeadReveal> = {}): LeadReveal {
    return {
        id: REVEAL_ID,
        field: 'whatsapp',
        cost: 2,
        chargedIntoDebt: false,
        at: '2026-11-06T10:00:00.000Z',
        refunded: false,
        refund: null,
        ...overrides,
    };
}

export function leadBlockFixture(overrides: Partial<LeadBlock> = {}): LeadBlock {
    return {
        id: '6730aabbccddeeff00117701',
        reason: 'Unlocks contacts with several numbers and never books',
        ticketId: TICKET_ID,
        blockedAt: '2026-11-07T09:00:00.000Z',
        blockedBy: { id: '6730aabbccddeeff00116601', source: 'admin', name: 'Brice N.' },
        ...overrides,
    };
}

export function leadConsentFixture(overrides: Partial<LeadConsent> = {}): LeadConsent {
    return { state: 'not_granted', askedAt: null, grantedAt: null, revokedAt: null, source: null, ...overrides };
}

export function listingLeadFixture(overrides: Partial<ListingLead> = {}): ListingLead {
    return {
        id: LEAD_ID,
        listingId: LISTING_ID,
        vendorId: VENDOR_ID,
        customer: leadCustomerFixture(),
        windowStart: '2026-11-06T10:00:00.000Z',
        windowEnd: '2026-12-06T10:00:00.000Z',
        windowOpen: true,
        engagedWhileLive: true,
        channel: 'whatsapp',
        fieldsRevealed: ['whatsapp', 'phone'],
        reveals: [
            leadRevealFixture(),
            leadRevealFixture({ id: SECOND_REVEAL_ID, field: 'phone', cost: 1, at: '2026-11-06T10:05:00.000Z' }),
        ],
        credits: { charged: 3, refunded: 0 },
        activeBlock: null,
        consent: leadConsentFixture(),
        createdAt: '2026-11-06T10:00:00.000Z',
        ...overrides,
    };
}

export function otherLeadsFixture(overrides: Partial<OtherLeads> = {}): OtherLeads {
    return {
        total: 2,
        providerCount: 2,
        byProvider: [
            {
                provider: { id: '6730aabbccddeeff00118801', displayName: 'Bonapriso Electric' },
                leads: 1,
                firstAt: '2026-11-05T09:00:00.000Z',
                lastAt: '2026-11-05T09:00:00.000Z',
            },
            {
                provider: { id: '6730aabbccddeeff00118802', displayName: 'Deido Carpentry' },
                leads: 1,
                firstAt: '2026-11-04T09:00:00.000Z',
                lastAt: '2026-11-04T09:00:00.000Z',
            },
        ],
        recent: [
            {
                id: '6730aabbccddeeff00119901',
                listing: {
                    id: '6730aabbccddeeff00119902',
                    slug: 'bonapriso-electric',
                    title: 'Electrician on call',
                    companyName: 'Bonapriso Electric',
                    status: 'live',
                },
                provider: { id: '6730aabbccddeeff00118801', displayName: 'Bonapriso Electric' },
                windowStart: '2026-11-05T09:00:00.000Z',
                windowEnd: '2026-12-05T09:00:00.000Z',
                fieldsRevealed: ['phone'],
                createdAt: '2026-11-05T09:00:00.000Z',
            },
        ],
        truncated: false,
        ...overrides,
    };
}

export function leadAccountRoleFixture(overrides: Partial<LeadAccountRole> = {}): LeadAccountRole {
    return {
        role: 'customer',
        profileId: CUSTOMER_ID,
        status: 'active',
        createdAt: '2026-11-04T07:00:00.000Z',
        missing: false,
        ...overrides,
    };
}

export function listingLeadDetailFixture(overrides: Partial<ListingLeadDetail> = {}): ListingLeadDetail {
    return {
        ...listingLeadFixture(),
        listing: {
            id: LISTING_ID,
            slug: 'plomberie-akwa',
            title: 'Plumbing repairs in Akwa',
            companyName: 'Akwa Plomberie',
            status: 'live',
        },
        provider: { id: VENDOR_ID, displayName: 'Akwa Plomberie SARL' },
        accountRoles: [leadAccountRoleFixture()],
        otherLeads: otherLeadsFixture(),
        ...overrides,
    };
}

export function listingLeadTicketContextFixture(
    overrides: Partial<ListingLeadTicketContext> = {},
): ListingLeadTicketContext {
    return {
        leadId: LEAD_ID,
        readable: true,
        wants: ['refund', 'check_customer'],
        listingId: LISTING_ID,
        revealIds: [REVEAL_ID],
        lead: {
            listing: {
                id: LISTING_ID,
                slug: 'plomberie-akwa',
                title: 'Plumbing repairs in Akwa',
                companyName: 'Akwa Plomberie',
                status: 'live',
            },
            vendorId: VENDOR_ID,
            customerId: CUSTOMER_ID,
            windowStart: '2026-11-06T10:00:00.000Z',
            windowEnd: '2026-12-06T10:00:00.000Z',
            channel: 'whatsapp',
            fieldsRevealed: ['whatsapp', 'phone'],
            createdAt: '2026-11-06T10:00:00.000Z',
        },
        namedReveals: [leadRevealFixture()],
        ...overrides,
    };
}
