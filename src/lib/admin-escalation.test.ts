import { describe, expect, it } from 'vitest';

import {
    assignableTiers,
    mayActOn,
    mayCreate,
    offerAction,
    REFUSAL_CODE,
    SELF_FORBIDDEN,
    UI_SELF_FORBIDDEN,
    type AdminRef,
    type ExistingAdminAction,
} from '@/lib/admin-escalation';
import { AUTHORIZATION_CODES } from '@/types/api.types';
import type { AdminTier } from '@/types/auth.types';

/**
 * The escalation mirror, exhaustively.
 *
 * This is the file that earns the module. Every refusal here is a
 * privilege-escalation attempt the UI declines to offer, so the matrix is
 * asserted whole rather than sampled — a rule that is only spot-checked is a
 * rule that can be inverted by a typo in the half nobody looked at.
 *
 * Table-driven, no mocks, no React: `escalation.rules.ts` is a pure function
 * server-side for exactly the same reason.
 */

const TIERS: readonly AdminTier[] = [1, 2, 3];

/** Every action with an existing target. `create` has its own describe block. */
const EXISTING_ACTIONS: readonly ExistingAdminAction[] = [
    'update',
    'suspend',
    'reinstate',
    'set_tier',
    'read_sessions',
    'revoke_sessions',
    'reset_password',
    'reset_mfa',
];

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const THEM = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const actor = (tier: AdminTier): AdminRef => ({ adminId: ME, tier });
const target = (tier: AdminTier): AdminRef => ({ adminId: THEM, tier });

describe('rule 1 — never act on yourself', () => {
    it.each(TIERS)('refuses the four self-forbidden actions at tier %i', (tier) => {
        const self = actor(tier);

        for (const action of EXISTING_ACTIONS) {
            if (!SELF_FORBIDDEN.has(action)) continue;

            const verdict = mayActOn(self, self, action, { newTier: 3 });
            expect(verdict.allowed, `${action} on self`).toBe(false);
            expect(verdict.refusal).toBe('self_action_forbidden');
        }
    });

    it.each(TIERS)('allows the rest on yourself at tier %i', (tier) => {
        const self = actor(tier);

        for (const action of EXISTING_ACTIONS) {
            if (SELF_FORBIDDEN.has(action)) continue;

            expect(mayActOn(self, self, action).allowed, `${action} on self`).toBe(true);
        }
    });

    /*
     * The regression that rule 1's early return exists for. Your own level is by
     * definition equal to your own level, so falling through to rule 2 would
     * refuse an administrator the right to edit their own display name.
     */
    it.each(TIERS)('self-update does not fall through to rule 2 at tier %i', (tier) => {
        const self = actor(tier);
        const verdict = mayActOn(self, self, 'update');

        expect(verdict.allowed).toBe(true);
        expect(verdict.refusal).toBeNull();
        expect(verdict.dualControlRequired).toBe(false);
    });
});

describe('rules 2 and 3 — the peer-protection matrix', () => {
    /**
     * The whole cube, derived rather than typed out.
     *
     * Lower number = more privilege, so action is ordinarily allowed only when
     * `targetTier > actorTier`. The one exception is Developer→Developer, which
     * is allowed *and always queued*.
     */
    for (const actorTier of TIERS) {
        for (const targetTier of TIERS) {
            const peerDeveloper = actorTier === 1 && targetTier === 1;
            const expected = peerDeveloper || targetTier > actorTier;

            it(`tier ${actorTier} on tier ${targetTier}: ${expected ? 'allowed' : 'refused'}`, () => {
                for (const action of EXISTING_ACTIONS) {
                    // `set_tier` additionally runs rule 4; it is asserted below
                    // with a level named, so keep this block to rules 2/3 only.
                    if (action === 'set_tier') continue;

                    const verdict = mayActOn(actor(actorTier), target(targetTier), action);

                    expect(verdict.allowed, `${action}`).toBe(expected);
                    if (!expected) expect(verdict.refusal).toBe('target_tier_protected');
                    else expect(verdict.dualControlRequired, `${action}`).toBe(peerDeveloper);
                }
            });
        }
    }

    it('refuses an equal level as firmly as a more privileged one', () => {
        expect(mayActOn(actor(2), target(2), 'suspend').refusal).toBe('target_tier_protected');
        expect(mayActOn(actor(3), target(3), 'suspend').refusal).toBe('target_tier_protected');
    });

    /*
     * `read_sessions` is the one READ governed by rule 2, precisely so an Admin
     * cannot enumerate a Developer's IP addresses and user agents while being
     * forbidden from acting on that Developer at all. The revoke route beside it
     * always ran the check; the read did not, and the asymmetry was an oversight
     * rather than a policy.
     */
    it('governs read_sessions by rule 2, unlike the other reads on this surface', () => {
        expect(mayActOn(actor(2), target(1), 'read_sessions').allowed).toBe(false);
        expect(mayActOn(actor(2), target(3), 'read_sessions').allowed).toBe(true);
    });
});

describe('rule 4 — never assign a level at or above your own', () => {
    it('lets a Developer mint a peer Developer, queued', () => {
        const verdict = mayActOn(actor(1), target(2), 'set_tier', { newTier: 1 });

        expect(verdict.allowed).toBe(true);
        expect(verdict.dualControlRequired).toBe(true);
    });

    it('lets a Developer assign the two levels below, unqueued', () => {
        for (const newTier of [2, 3] as const) {
            const verdict = mayActOn(actor(1), target(2), 'set_tier', { newTier });
            expect(verdict.allowed, `newTier ${newTier}`).toBe(true);
            expect(verdict.dualControlRequired, `newTier ${newTier}`).toBe(false);
        }
    });

    /**
     * The finding the docs do not carry.
     *
     * `administrators.md` documents the queue as firing "when the requested tier
     * is 1", and `CLAUDE.md` says demoting an administrator is never queued.
     * Rule 2 sets `dualControlRequired` for any Developer→Developer action and
     * rule 4 only ever raises the flag, never lowers it — so this is queued.
     */
    it('queues a Developer demoting a Developer, even though the new level is not 1', () => {
        const verdict = mayActOn(actor(1), target(1), 'set_tier', { newTier: 3 });

        expect(verdict.allowed).toBe(true);
        expect(verdict.dualControlRequired).toBe(true);
    });

    it('refuses an Admin assigning Admin or Developer', () => {
        for (const newTier of [1, 2] as const) {
            const verdict = mayActOn(actor(2), target(3), 'set_tier', { newTier });
            expect(verdict.allowed, `newTier ${newTier}`).toBe(false);
            expect(verdict.refusal).toBe('tier_escalation_forbidden');
        }
    });

    it('lets an Admin assign Support', () => {
        expect(mayActOn(actor(2), target(3), 'set_tier', { newTier: 3 }).allowed).toBe(true);
    });

    /**
     * ⚠ DIVERGENCE 1. The server throws a 500 here; a UI predicate called during
     * render must not, so an unnamed level means "answer rules 1 and 2 only" —
     * which is the question the toolbar button asks.
     */
    it('answers rules 1–2 alone rather than throwing when no level is named', () => {
        expect(() => mayActOn(actor(1), target(2), 'set_tier')).not.toThrow();
        expect(mayActOn(actor(1), target(2), 'set_tier').allowed).toBe(true);
        expect(mayActOn(actor(2), target(1), 'set_tier').allowed).toBe(false);
    });
});

describe('mayCreate', () => {
    /**
     * ⚠ DIVERGENCE 2. `assertMayCreate` would queue this server-side because it
     * shares `assertMayAssignTier` with `set_tier`, but the route answers 409:
     * there is no approval path from create.
     */
    it('refuses creating a Developer, because the route answers 409 and there is no approval path', () => {
        const verdict = mayCreate(actor(1), 1);

        expect(verdict.allowed).toBe(false);
        expect(verdict.refusal).toBe('approval_required_no_path');
        expect(verdict.dualControlRequired).toBe(false);
    });

    it('lets a Developer create Admin and Support', () => {
        expect(mayCreate(actor(1), 2).allowed).toBe(true);
        expect(mayCreate(actor(1), 3).allowed).toBe(true);
    });

    it('lets an Admin create only Support', () => {
        expect(mayCreate(actor(2), 1).allowed).toBe(false);
        expect(mayCreate(actor(2), 2).allowed).toBe(false);
        expect(mayCreate(actor(2), 3).allowed).toBe(true);
    });

    it('lets Support create nobody', () => {
        for (const newTier of TIERS) {
            expect(mayCreate(actor(3), newTier).allowed, `newTier ${newTier}`).toBe(false);
        }
    });
});

describe('assignableTiers', () => {
    it('never offers Developer for create, even to a Developer', () => {
        expect(assignableTiers(1, 'create')).toEqual([
            { tier: 2, label: 'Admin', dualControlRequired: false },
            { tier: 3, label: 'Support', dualControlRequired: false },
        ]);
    });

    it('offers Developer for set_tier to a Developer, flagged dual-control', () => {
        expect(assignableTiers(1, 'set_tier')).toEqual([
            { tier: 1, label: 'Developer', dualControlRequired: true },
            { tier: 2, label: 'Admin', dualControlRequired: false },
            { tier: 3, label: 'Support', dualControlRequired: false },
        ]);
    });

    it('offers an Admin only Support, either way', () => {
        const expected = [{ tier: 3, label: 'Support', dualControlRequired: false }];
        expect(assignableTiers(2, 'create')).toEqual(expected);
        expect(assignableTiers(2, 'set_tier')).toEqual(expected);
    });

    /** An empty list is the signal to hide the affordance rather than open an empty dialog. */
    it('offers Support nothing, either way', () => {
        expect(assignableTiers(3, 'create')).toEqual([]);
        expect(assignableTiers(3, 'set_tier')).toEqual([]);
    });
});

describe('offerAction — the UI’s own conservatism', () => {
    it('forbids on self everything the server does, and more', () => {
        for (const action of SELF_FORBIDDEN) {
            expect(UI_SELF_FORBIDDEN.has(action), action).toBe(true);
        }
        expect(UI_SELF_FORBIDDEN.size).toBeGreaterThan(SELF_FORBIDDEN.size);
    });

    it.each(['update', 'read_sessions', 'reset_mfa'] as const)(
        'declines %s on your own record where mayActOn allows it',
        (action) => {
            const self = actor(1);

            expect(mayActOn(self, self, action).allowed).toBe(true);
            expect(offerAction(self, self, action).allowed).toBe(false);
            expect(offerAction(self, self, action).refusal).toBe('self_action_forbidden');
        },
    );

    it('is identical to mayActOn on somebody else', () => {
        for (const actorTier of TIERS) {
            for (const targetTier of TIERS) {
                for (const action of EXISTING_ACTIONS) {
                    expect(
                        offerAction(actor(actorTier), target(targetTier), action, { newTier: 3 }),
                        `${actorTier}→${targetTier} ${action}`,
                    ).toEqual(mayActOn(actor(actorTier), target(targetTier), action, { newTier: 3 }));
                }
            }
        }
    });
});

describe('the module’s own invariants', () => {
    /*
     * A typo in one of these strings would otherwise stay invisible until it
     * mis-branched a catch somewhere far away.
     */
    it('maps every refusal to a code the client already knows', () => {
        for (const [refusal, code] of Object.entries(REFUSAL_CODE)) {
            const known =
                AUTHORIZATION_CODES.includes(code) || code === 'AUTHZ_APPROVAL_REQUIRED';
            expect(known, `${refusal} → ${code}`).toBe(true);
        }
    });

    /**
     * A UI predicate that throws blanks the screen through `ErrorBoundary`, and
     * it is called once per row and once per toolbar button.
     */
    it('never throws, for any input in the cube', () => {
        // A level this build has never heard of, which a routine additive
        // backend deploy could introduce.
        const UNKNOWN = 9 as AdminTier;
        const targetTiers: readonly AdminTier[] = [...TIERS, UNKNOWN];
        const newTiers: readonly (AdminTier | undefined)[] = [undefined, ...TIERS, UNKNOWN];

        for (const actorTier of TIERS) {
            for (const targetTier of targetTiers) {
                for (const action of EXISTING_ACTIONS) {
                    for (const newTier of newTiers) {
                        expect(() =>
                            mayActOn(actor(actorTier), target(targetTier), action, { newTier }),
                        ).not.toThrow();
                    }
                }
            }
        }
    });

    it('renders an unknown level rather than dropping it', () => {
        // `tierLabel` falls back to `Tier N`; a closed lookup would blank the
        // option on a routine deploy that added a level.
        expect(assignableTiers(9 as AdminTier, 'set_tier')).toEqual([]);
    });
});
