import { describe, expect, it } from 'vitest';

import {
    canRemoveFollower,
    followerRolesOf,
    followerSourceLabel,
    heldRolesOf,
    isFollowerAlreadyGone,
    isFollowerRemovalRefused,
    isFollowerRoleMismatch,
    routedPartyOf,
    ticketPersonNames,
    ticketPersonProfileRoute,
    ticketPersonUserRoute,
    type TicketPersonLike,
} from '@/lib/ticket-people';
import { ticketFollowerFixture, unroutedFixture } from '@/test/support-fixtures';
import { ApiError } from '@/types/api.types';
import { isTicketDetail } from '@/types/support.types';

function person(overrides: Partial<TicketPersonLike> = {}): TicketPersonLike {
    return {
        role: 'vendor',
        userId: '6640aa11bb22cc33dd44ee01',
        profileId: '6640aa11bb22cc33dd44ee02',
        name: 'Paul Etoa',
        businessName: 'Chez Paul',
        phone: '+237600000002',
        email: 'paul@chezpaul.example',
        ...overrides,
    };
}

function rejection(status: number, platformCode?: string, details: Record<string, unknown> = {}) {
    return new ApiError({
        status,
        code: 'PLATFORM_OPERATION_REJECTED',
        category: 'business_rule',
        message: 'The platform rejected this operation',
        details: platformCode ? { platformCode, ...details } : undefined,
    });
}

describe('which name is the title', () => {
    /**
     * `name` is a human. Printed under "Vendor" it mislabels the row — the
     * BR-006 confusion, and the changelog's first rule.
     */
    it('leads with the business for a vendor and an agency, and keeps the person as the contact', () => {
        expect(ticketPersonNames(person())).toEqual({
            title: 'Chez Paul',
            titleKind: 'business',
            contact: 'Paul Etoa',
        });
        expect(ticketPersonNames(person({ role: 'agency', businessName: 'Rapide' })).title).toBe(
            'Rapide',
        );
    });

    it('falls back to the contact person only when there is no business name', () => {
        expect(ticketPersonNames(person({ businessName: null }))).toEqual({
            title: 'Paul Etoa',
            titleKind: 'person',
            contact: null,
        });
    });

    it('never treats a business name as the title of a customer or an agent', () => {
        // Neither role has one. A stray value must not rename a person.
        expect(ticketPersonNames(person({ role: 'customer', businessName: 'Stray' })).title).toBe(
            'Paul Etoa',
        );
        expect(ticketPersonNames(person({ role: 'agent', businessName: 'Stray' })).contact).toBe(
            null,
        );
    });

    it('reports nothing resolved rather than a blank title', () => {
        // A deleted profile or a closed account: every looked-up field is null.
        expect(
            ticketPersonNames(person({ name: null, businessName: null })),
        ).toEqual({ title: null, titleKind: 'none', contact: null });
        // …and an anonymised-to-blank value is no value.
        expect(ticketPersonNames(person({ name: '  ', businessName: '' })).title).toBe(null);
        // …and an older service that sends none of the keys.
        expect(ticketPersonNames({ role: 'customer', userId: 'x' }).title).toBe(null);
    });
});

describe('which id opens which screen', () => {
    it("opens the role's own screen with the PROFILE id, never the user id", () => {
        expect(ticketPersonProfileRoute(person())).toEqual({
            path: '/dashboard/vendors/6640aa11bb22cc33dd44ee02',
            permission: 'vendors.read',
        });
        expect(ticketPersonProfileRoute(person({ role: 'agency' }))?.path).toBe(
            '/dashboard/agencies/6640aa11bb22cc33dd44ee02',
        );
        expect(ticketPersonProfileRoute(person({ role: 'agent' }))?.permission).toBe(
            'agents.read',
        );
    });

    it('has no role screen for a customer, or when the profile did not resolve', () => {
        expect(ticketPersonProfileRoute(person({ role: 'customer' }))).toBe(null);
        expect(ticketPersonProfileRoute(person({ profileId: null }))).toBe(null);
    });

    it('opens the user directory with the user id', () => {
        expect(ticketPersonUserRoute(person())).toEqual({
            path: '/dashboard/users/6640aa11bb22cc33dd44ee01',
            permission: 'users.read',
        });
    });

    /**
     * For `admin` the id is an `admin_accounts` id, or the platform's automatic
     * identity. In the user directory it would 404 while looking like a link.
     */
    it('never sends an administrator to the user directory', () => {
        expect(ticketPersonUserRoute(person({ role: 'admin' }))).toBe(null);
        expect(ticketPersonProfileRoute(person({ role: 'admin' }))).toBe(null);
    });
});

describe('the routed-to party', () => {
    it('reads the all-null object as nobody', () => {
        // The wire never sends `null` here — it sends an object of nulls.
        expect(routedPartyOf(unroutedFixture())).toBe(null);
        expect(routedPartyOf(null)).toBe(null);
    });

    it('reads the administrator pool as nobody', () => {
        expect(routedPartyOf({ ...unroutedFixture(), role: 'admin' })).toBe(null);
    });

    it('returns the party otherwise', () => {
        expect(routedPartyOf(person({ role: 'agency' }))?.role).toBe('agency');
    });
});

describe('followers', () => {
    it('labels each source, and says when none was recorded', () => {
        expect(followerSourceLabel('creator')).toBe('Opened it');
        expect(followerSourceLabel('assignee')).toBe('Assigned');
        expect(followerSourceLabel('order_party')).toBe('Order party');
        expect(followerSourceLabel('admin')).toBe('Added by an administrator');
        // A row older than 2026-10-09.
        expect(followerSourceLabel(null)).toBe('Reason not recorded');
        // An unknown one renders as itself, never as a known label.
        expect(followerSourceLabel('booking_party')).toBe('booking party');
    });

    it('withholds removal from the creator, the assignee and an administrator — and nobody else', () => {
        expect(canRemoveFollower(ticketFollowerFixture())).toBe(true);
        expect(canRemoveFollower(ticketFollowerFixture({ isCreator: true }))).toBe(false);
        expect(canRemoveFollower(ticketFollowerFixture({ isAssignee: true }))).toBe(false);
        expect(canRemoveFollower(ticketFollowerFixture({ role: 'admin' }))).toBe(false);
        // The source is a label, not a rule: an order party is removable.
        expect(canRemoveFollower(ticketFollowerFixture({ source: 'order_party' }))).toBe(true);
        expect(canRemoveFollower(ticketFollowerFixture({ source: null }))).toBe(true);
    });

    it('offers only the roles the add body accepts', () => {
        expect(followerRolesOf(['agent', 'customer', 'admin', 'reseller'])).toEqual([
            'customer',
            'agent',
        ]);
        expect(followerRolesOf(undefined)).toEqual([]);
    });
});

describe('refusals', () => {
    it('reads the role mismatch off platformCode, and the held roles when they arrive', () => {
        const error = rejection(422, 'TICKET_FOLLOWER_ROLE_MISMATCH', {
            roles: ['customer', 'agent'],
        });

        expect(isFollowerRoleMismatch(error)).toBe(true);
        expect(heldRolesOf(error.details)).toEqual(['customer', 'agent']);
        // The details are conditional on the platform's category — tolerate none.
        expect(heldRolesOf(rejection(422, 'TICKET_FOLLOWER_ROLE_MISMATCH').details)).toEqual([]);
        expect(heldRolesOf(undefined)).toEqual([]);
    });

    /**
     * 🔴 The changelog prints `platformCode: TICKET_ACCESS_DENIED` for this
     * 403. wi-admin's `authorization` allowlist drops `platformCode`, so the
     * refusal arrives bare — and must still be recognised.
     */
    it('recognises the removal refusal WITHOUT a platformCode', () => {
        expect(isFollowerRemovalRefused(rejection(403))).toBe(true);
        // …and with one, should the allowlist ever change.
        expect(isFollowerRemovalRefused(rejection(403, 'TICKET_ACCESS_DENIED'))).toBe(true);
    });

    it("does not mistake the permission layer's 403 for it", () => {
        const denied = new ApiError({
            status: 403,
            code: 'AUTHZ_PERMISSION_DENIED',
            category: 'authorization',
            message: 'You do not have permission to do that',
        });

        expect(isFollowerRemovalRefused(denied)).toBe(false);
    });

    /**
     * The same string at two levels: as `error.code` it is the ticket, as
     * `platformCode` on a removal it is the follower row.
     */
    it('separates "no longer follows" from "no such ticket"', () => {
        const ticketGone = new ApiError({
            status: 404,
            code: 'TICKET_NOT_FOUND',
            category: 'not_found',
            message: 'Ticket not found',
        });

        expect(isFollowerAlreadyGone(rejection(404, 'TICKET_NOT_FOUND'))).toBe(true);
        expect(isFollowerAlreadyGone(ticketGone)).toBe(false);
    });
});

describe("a follower write's answer", () => {
    it('is accepted only when it is this ticket, with followers', () => {
        expect(isTicketDetail({ id: 'a', followers: [] }, 'a')).toBe(true);
        // An older service answered nothing…
        expect(isTicketDetail(undefined, 'a')).toBe(false);
        expect(isTicketDetail(null, 'a')).toBe(false);
        // …or jovi-mall's own ticket, with no follower list.
        expect(isTicketDetail({ id: 'a' }, 'a')).toBe(false);
        expect(isTicketDetail({ id: 'b', followers: [] }, 'a')).toBe(false);
    });
});
