import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AgentDetail } from '@/pages/agents/AgentDetail';
import {
    agentDetailFixture,
    bannedAgentDetailFixture,
    agentContractFixture,
    agentListMetaFixture,
    codAllocationFixture,
    lastKnownFixture,
    trackingPolicyFixture,
} from '@/test/agent-fixtures';
import { codListMetaFixture, trustEventFixture } from '@/test/cod-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AgentDetail as AgentDetailRecord } from '@/types/agents.types';

const AGENT_ID = '6660112233445566778899aa';

/**
 * The agent detail.
 *
 * Every stub answers only the paths this screen may legitimately ask for and
 * throws otherwise — which is itself the assertion behind "no eligibility call is
 * made until somebody asks for one".
 */
function stubDetail(
    agent: AgentDetailRecord = agentDetailFixture(),
    overrides: {
        policy?: () => Response;
        allocation?: () => Response;
        presence?: () => Response;
        contracts?: () => Response;
    } = {},
) {
    return stubFetch((call) => {
        /*
         * Ahead of `/tracking-policy` because `includes` would not confuse them,
         * but ahead of `/agents/:id` because it must: the geo-tracker data door
         * mounts inside the agent path.
         *
         * The default is `TRACKING_DOOR_UNCONFIGURED`, which is the **normal**
         * state of a deployment that has not opened the door — a red error here
         * would be the wrong default for every test that is not about tracking.
         */
        if (call.url.includes('/tracking-presence')) {
            return (
                overrides.presence?.() ??
                errorResponse(503, 'TRACKING_DOOR_UNCONFIGURED', {
                    message: 'Live tracking is not enabled for this deployment',
                })
            );
        }
        if (call.url.includes('/tracking-policy')) {
            return overrides.policy?.() ?? successResponse(trackingPolicyFixture());
        }
        if (call.url.includes('/cod-allocation')) {
            return overrides.allocation?.() ?? successResponse(codAllocationFixture());
        }
        /*
         * ⚠ Ahead of the `/agents/:id` branch for exactly the reason stated
         * below it about `/trust-events`, and it caught the same way: the Cash
         * tab joins `GET /agents/:id/contracts` to put agency names on the COD
         * slices, and without this branch that request is answered with the
         * agent document — a page whose `data` is an object rather than an
         * array — and the panel throws while iterating it.
         */
        if (call.url.includes('/contracts')) {
            return (
                overrides.contracts?.() ??
                successResponse([agentContractFixture()], { meta: agentListMetaFixture() })
            );
        }
        /*
         * Ahead of the `/agents/:id` branch on purpose: the trust feed lives at
         * `/cod/agents/:id/trust-events`, which contains the agent path and would
         * otherwise be answered with the agent document — a page whose `data` is
         * an object rather than an array.
         */
        if (call.url.includes('/trust-events')) {
            return successResponse([trustEventFixture()], { meta: codListMetaFixture() });
        }
        if (call.url.includes(`/agents/${AGENT_ID}`)) {
            return successResponse(agent);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(held: ReadonlySet<string> = heldFixture(1), agentId = AGENT_ID) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/agents/:agentId" element={<AgentDetail />} />
        </Routes>,
        {
            route: `/dashboard/agents/${agentId}`,
            auth: {
                status: 'authenticated',
                admin: adminFixture({ timezone: 'Africa/Douala' }),
            },
            permissions: { held },
        },
    );
}

describe('the record', () => {
    /** A malformed id is a `400` at the edge; the round trip buys nothing. */
    it('refuses a non-hex id without issuing a request', async () => {
        const calls = stubFetch(() => {
            throw new Error('should not have been called');
        });
        detail(heldFixture(1), 'not-an-id');

        expect(await screen.findByText(/not a valid agent id/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    /**
     * The row rendering draws only the axes that need attention; the detail draws
     * all six. Asserted on the **benign values**, which appear nowhere else —
     * "Not banned", "idle" and "online" are exactly what a row would have hidden.
     */
    it('renders all six axes on the detail, including the benign ones', async () => {
        stubDetail();
        detail();

        expect(await screen.findByText('Not banned')).toBeInTheDocument();
        expect(screen.getByText('idle')).toBeInTheDocument();
        expect(screen.getByText('online')).toBeInTheDocument();
        expect(screen.getByText('Allowed')).toBeInTheDocument();
        expect(screen.getAllByText('verified').length).toBeGreaterThan(0);
        expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    });
});

describe('the last known position', () => {
    /**
     * The reveal is the whole point: the coordinates ship unconditionally under
     * plain `agents.read`, which tier-3 Support holds, so the dashboard does not
     * put them on screen by default.
     */
    it('is not in the DOM until the reveal is pressed', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(await screen.findByRole('button', { name: /show last known position/i })).toBeInTheDocument();
        expect(screen.queryByText(/9\.7043/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /show last known position/i }));
        expect(await screen.findByText(/9\.7043, 4\.0611/)).toBeInTheDocument();
    });

    /**
     * A denied verdict means "do not track them now". It does not erase where they
     * were last seen, and withholding that is harmful in exactly the situation an
     * operator opens this screen for.
     */
    it('stays available when the stored flag is off and the verdict refuses', async () => {
        stubDetail(
            agentDetailFixture({
                trackingAllowed: false,
                tracking: {
                    ...agentDetailFixture().tracking,
                    allowed: false,
                    reason: 'Repeated location spoofing',
                },
            }),
            {
                policy: () =>
                    successResponse(
                        trackingPolicyFixture({
                            trackingAllowed: false,
                            denyReason: 'tracking_disabled',
                        }),
                    ),
            },
        );
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));
        await userEvent.click(
            await screen.findByRole('button', { name: /show last known position/i }),
        );

        expect(await screen.findByText(/9\.7043, 4\.0611/)).toBeInTheDocument();
    });

    /** Freshness is readable before deciding whether to look at all. */
    it('announces staleness above the coordinates, without revealing them', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(await screen.findByText('Stale')).toBeInTheDocument();
        expect(screen.queryByText(/9\.7043/)).not.toBeInTheDocument();
    });

    /**
     * The load-bearing one. `place` is the *more* revealing of the two fields —
     * coordinates need a tool to read and "Bonapriso, Douala" does not — so a
     * gate that hid the numbers while printing the street name above them would
     * be a gate in name only.
     */
    it('keeps the resolved place behind the same reveal as the coordinates', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(screen.queryByText(/Bonapriso, Douala, Cameroun/)).not.toBeInTheDocument();

        await userEvent.click(
            await screen.findByRole('button', { name: /show last known position/i }),
        );

        expect(await screen.findByText(/Bonapriso, Douala, Cameroun/)).toBeInTheDocument();
        // The resolver is an open string: rendered raw, never switched on.
        expect(screen.getByText(/reverse_geocode:nominatim/)).toBeInTheDocument();
    });

    /**
     * A geocoder that resolved nothing is not an operational fact, so it is
     * absent rather than labelled — the position is the record either way.
     */
    it('reveals the coordinates alone when nothing resolved', async () => {
        stubDetail(
            agentDetailFixture({
                tracking: {
                    ...agentDetailFixture().tracking,
                    lastKnown: lastKnownFixture({ place: null }),
                },
            }),
        );
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));
        await userEvent.click(
            await screen.findByRole('button', { name: /show last known position/i }),
        );

        expect(await screen.findByText(/9\.7043, 4\.0611/)).toBeInTheDocument();
        expect(screen.queryByText(/resolved place/i)).not.toBeInTheDocument();
    });

    it('says so when no position was ever reported, and offers no reveal', async () => {
        stubDetail(
            agentDetailFixture({
                tracking: {
                    ...agentDetailFixture().tracking,
                    lastKnown: lastKnownFixture({ position: null, reportedAt: null }),
                },
            }),
        );
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(await screen.findByText(/no position has ever been reported/i)).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /show last known position/i }),
        ).not.toBeInTheDocument();
    });

    /**
     * BR-003's ask, and the assertion that catches the failure it warned about
     * at the *screen* level rather than only in `lib/geo`'s own suite.
     *
     * The fixture is GeoJSON — `[9.7043, 4.0611]` is `[longitude, latitude]` —
     * so the map URL must read `4.0611,9.7043`. Read the other way round it is
     * a perfectly plausible pin in the wrong country, and nothing downstream of
     * this line can tell the difference.
     */
    it('offers a Google Maps link, latitude first, behind the same reveal', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        // A third disclosure behind the one button, so it waits with the others.
        expect(screen.queryByRole('link', { name: /google maps/i })).not.toBeInTheDocument();

        await userEvent.click(
            await screen.findByRole('button', { name: /show last known position/i }),
        );

        const href = (await screen.findByRole('link', { name: /open in google maps/i })).getAttribute(
            'href',
        );
        expect(new URL(href ?? '').searchParams.get('query')).toBe('4.0611,9.7043');
    });

    it('offers no map link when there is nothing to point at', async () => {
        stubDetail(
            agentDetailFixture({
                tracking: {
                    ...agentDetailFixture().tracking,
                    lastKnown: lastKnownFixture({ position: null, reportedAt: null }),
                },
            }),
        );
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(await screen.findByText(/no position has ever been reported/i)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /google maps/i })).not.toBeInTheDocument();
    });
});

describe('the tracking verdict', () => {
    /**
     * "We could not ask" is a different statement from "not allowed", and
     * rendering it as a refusal would be a refusal this dashboard invented.
     */
    it('renders a dependency failure as unavailable, not as a refusal', async () => {
        stubDetail(agentDetailFixture(), {
            policy: () =>
                errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                    category: 'external_service',
                }),
        });
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(await screen.findByText(/verdict unavailable/i)).toBeInTheDocument();
        expect(screen.getByText(/this is not a refusal/i)).toBeInTheDocument();
        // And the reveal is still on offer.
        expect(
            screen.getByRole('button', { name: /show last known position/i }),
        ).toBeInTheDocument();
    });

    /** The fourth value `agents.md` omits still has to render as a sentence. */
    it('explains the undocumented agent_not_found deny reason', async () => {
        stubDetail(agentDetailFixture(), {
            policy: () =>
                successResponse(
                    trackingPolicyFixture({
                        trackingAllowed: false,
                        denyReason: 'agent_not_found',
                    }),
                ),
        });
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /tracking/i }));

        expect(await screen.findByText(/does not recognise this agent/i)).toBeInTheDocument();
    });
});

describe('the cash pool gate', () => {
    /**
     * `GET /agents/:agentId/cod-allocation` is a composite guard —
     * `agents.read` **+** `agencies.read`, `all` mode
     * (`agents.md:505`, `ROUTE-MAP.md:159`). It was fired on mount regardless
     * until 2026-09-09, from a screen an `agents.read`-only caller can open.
     *
     * ⚠ **Latent, not live.** Every tier holding `agents.read` holds
     * `agencies.read` today, so no operator can currently collect that 403.
     * The tier matrix is the backend's to change, and a client that waits for
     * an outage to gate a route has already shipped the bug.
     */
    it('does not fire the allocation read without agencies.read', async () => {
        const calls = stubDetail();
        detail(new Set(['agents.read']));

        await screen.findByRole('tab', { name: /overview/i });
        expect(calls.some((call) => call.url.includes('/cod-allocation'))).toBe(false);
    });

    /**
     * And the tab goes with it: its whole content is that one read, so a tab
     * that could only show a denial is not offered — the same rule the roster,
     * Account and Activity tabs follow.
     */
    it('offers no Cash tab without agencies.read', async () => {
        stubDetail();
        detail(new Set(['agents.read']));

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('tab', { name: /^cash$/i })).not.toBeInTheDocument();
    });

    it('fires it, and offers the tab, once agencies.read is held too', async () => {
        const calls = stubDetail();
        detail(new Set(['agents.read', 'agencies.read']));

        expect(await screen.findByRole('tab', { name: /^cash$/i })).toBeInTheDocument();
        await waitFor(() => {
            expect(calls.some((call) => call.url.includes('/cod-allocation'))).toBe(true);
        });
    });
});

describe('permissions', () => {
    /**
     * A tab whose only content is a denial teaches people the screen is broken, so
     * a caller missing the second permission does not get the tab at all.
     */
    it('omits Cash, the roster, Account and Activity for a caller holding only agents.read', async () => {
        stubDetail();
        detail(new Set(['agents.read']));

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('tab', { name: /^cash$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /roster/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /account/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /activity/i })).not.toBeInTheDocument();
    });

    it('offers no write affordance to a caller holding only agents.read', async () => {
        stubDetail();
        detail(new Set(['agents.read']));

        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByRole('button', { name: /set status/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /review documents/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^ban$/i })).not.toBeInTheDocument();
    });

    /**
     * ⚠ The tab reads **Roster**, and its `value` is still `agencies`.
     *
     * The rename is the whole visible change — the agent's contract list and the
     * agency's roster are one collection read from two ends, so the two screens
     * now use one word for it. The value stays because it is not in the URL and
     * moving it would churn selectors for nothing.
     */
    it('shows the roster tab, named Roster, once agencies.read is held too', async () => {
        stubDetail();
        detail(new Set(['agents.read', 'agencies.read']));

        expect(await screen.findByRole('tab', { name: /^roster$/i })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /^agencies$/i })).not.toBeInTheDocument();
    });
});

describe('the ban', () => {
    /**
     * Banning is deliberately not a cascade over contracts, so a contract can read
     * `active` beneath a standing ban. A screen that shows one without the other
     * is lying by omission.
     */
    it('offers to lift the ban rather than to impose one, and explains the block', async () => {
        stubDetail(bannedAgentDetailFixture());
        detail();

        expect(await screen.findByRole('button', { name: /lift ban/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^ban$/i })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /overview/i }));
        expect(
            await screen.findByText(/cash never remitted after three collections/i),
        ).toBeInTheDocument();
    });
});

describe('the cash pool', () => {
    it('shows the pool, what is allocated and the headroom without recomputing them', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /cash/i }));

        await waitFor(() => {
            expect(screen.getByText('Headroom')).toBeInTheDocument();
        });
        expect(screen.getByText('60,000')).toBeInTheDocument();
    });

    /**
     * The trust history and the trust adjustment are gated independently, and the
     * asymmetry is the service's: reading the history exposes a named
     * person's conduct record and needs `cod.holders.read` **and** `agents.read`;
     * moving the score reads nothing and needs `cod.trust.adjust` alone.
     */
    it('shows the trust history beside the pool', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('tab', { name: /cash/i }));

        expect(await screen.findByText('Trust history')).toBeInTheDocument();
        expect(screen.getByText('87 / 100')).toBeInTheDocument();
    });

    it('does not request the trust history without the pair of permissions', async () => {
        // Everything the Cash tab itself needs, and neither COD read.
        //
        // ⚠ `agencies.read` is in the set because the tab is behind it — the
        // cash pool is `agents.read` **+** `agencies.read` since the 2026-09-08
        // re-derivation. It is not what this case is about; without it there is
        // no tab to click.
        const calls = stubDetail();
        detail(new Set(['agents.read', 'agencies.read', 'cod.trust.adjust']));

        await userEvent.click(await screen.findByRole('tab', { name: /cash/i }));
        await screen.findByText('Cash pool');

        expect(screen.queryByText('Trust history')).not.toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/trust-events'))).toBe(false);
        // The write is still offered: it does not read what it cannot see.
        expect(screen.getByRole('button', { name: /adjust trust score/i })).toBeInTheDocument();
    });
});
