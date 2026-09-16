import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { DepositDetail } from '@/pages/cod/DepositDetail';
import { DepositsList } from '@/pages/cod/DepositsList';
import { DiscrepanciesList } from '@/pages/cod/DiscrepanciesList';
import { DiscrepancyDetail } from '@/pages/cod/DiscrepancyDetail';
import { RemittanceDetail } from '@/pages/cod/RemittanceDetail';
import { RemittancesList } from '@/pages/cod/RemittancesList';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    agencyDepositDetailFixture,
    agencyDepositFixture,
    codListMetaFixture,
    confirmedDepositDetailFixture,
    confirmedRemittanceDetailFixture,
    depositDetailFixture,
    discrepancyDetailFixture,
    discrepancyFixture,
    nonMonetaryDiscrepancyFixture,
    platformDepositFixture,
    remittanceDetailFixture,
    remittanceFixture,
    trustEventFixture,
} from '@/test/cod-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

const REMITTANCE_ID = '6680aabbccddeeff00112233';
const DEPOSIT_ID = '6682aabbccddeeff00112233';
const DISCREPANCY_ID = '6683aabbccddeeff00112233';

function render(ui: React.ReactElement, route: string, held = heldFixture(1)) {
    return renderWithProviders(ui, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
        permissions: { held },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

// ─── Remittances ──────────────────────────────────────────────────────────────

describe('the remittance queue', () => {
    function stubList(rows = [remittanceFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod/remittances')) {
                return successResponse(rows, { meta: codListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('offers no sort control, because the endpoint offers no sort', async () => {
        /*
         * The ordering of a delegated list belongs to the platform, and
         * `RemittanceListQuery` has no `sort` key — so a header that appeared to
         * sort would be a control that silently does nothing.
         */
        const calls = stubList();

        render(<RemittancesList />, '/dashboard/cod/remittances');

        await screen.findByText('BICEC/2026/08/13/44127');
        expect(screen.queryByRole('button', { name: /^sort by/i })).not.toBeInTheDocument();
        expect(latest(calls).searchParams.get('sort')).toBeNull();
    });

    it('offers exactly the three statuses jovi-mall pins, and no more', async () => {
        // Widening this filter from the URL — which every direct-read list here
        // does — would send an unknown value to a `z.enum` and get a 400.
        stubList();

        render(<RemittancesList />, '/dashboard/cod/remittances?status=frozen');
        await screen.findByText('BICEC/2026/08/13/44127');

        await userEvent.click(screen.getByRole('combobox', { name: /status/i }));

        const options = await screen.findAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual([
            'Any status',
            'declared',
            'confirmed',
            'rejected',
        ]);
    });

    it('names a declaration with no reference rather than showing a bare id', async () => {
        stubList([remittanceFixture({ reference: null })]);

        render(<RemittancesList />, '/dashboard/cod/remittances');

        expect(await screen.findByRole('link', { name: 'No reference' })).toBeInTheDocument();
    });

    it('says the platform has not answered rather than leaving the cell blank', async () => {
        stubList();

        render(<RemittancesList />, '/dashboard/cod/remittances');

        expect(await screen.findByText('Waiting on us')).toBeInTheDocument();
    });
});

describe('one remittance', () => {
    function stubDetail(
        remittance = remittanceDetailFixture(),
        write?: (call: FetchCall) => Response | undefined,
    ) {
        return stubFetch((call: FetchCall) => {
            const answered = write?.(call);
            if (answered) return answered;
            if (call.method === 'GET' && call.url.includes(`/cod/remittances/${REMITTANCE_ID}`)) {
                return successResponse(remittance);
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function detail(held = heldFixture(1)) {
        return render(
            <Routes>
                <Route
                    path="/dashboard/cod/remittances/:remittanceId"
                    element={<RemittanceDetail />}
                />
            </Routes>,
            `/dashboard/cod/remittances/${REMITTANCE_ID}`,
            held,
        );
    }

    it('keys the actions on resolvedAt, not on the status vocabulary', async () => {
        /*
         * The load-bearing test on this screen. Every COD status is the
         * platform's and can gain a member on a routine deploy; `resolvedAt` is a
         * fact. A record carrying a status this client has never heard of, still
         * unanswered, must still offer both actions.
         */
        stubDetail(remittanceDetailFixture({ status: 'under_review' }));

        detail();

        expect(await screen.findByRole('button', { name: /confirm receipt/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    });

    it('offers neither action once it has been answered', async () => {
        stubDetail(confirmedRemittanceDetailFixture());

        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('button', { name: /confirm receipt/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    });

    it('hides each action behind its own permission', async () => {
        stubDetail();

        detail(new Set(['cod.remittances.read', 'cod.remittances.confirm']));

        expect(await screen.findByRole('button', { name: /confirm receipt/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    });

    it('explains that an empty ledger is a claim rather than a loss of data', async () => {
        stubDetail();

        detail();

        expect(await screen.findByText(/nothing has moved/i)).toBeInTheDocument();
        expect(screen.getByText(/a declaration is a claim/i)).toBeInTheDocument();
    });

    it('confirms with an empty body and then re-reads the record', async () => {
        const calls = stubDetail(remittanceDetailFixture(), (call) =>
            call.method === 'POST' && call.url.includes('/confirm')
                ? successResponse({ id: REMITTANCE_ID }, { message: 'Remittance confirmed' })
                : undefined,
        );

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /confirm receipt/i }));
        await userEvent.click(
            within(await screen.findByRole('dialog')).getByRole('button', {
                name: /confirm receipt/i,
            }),
        );

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'POST')).toBe(true);
        });

        const write = calls.find((call) => call.method === 'POST');
        expect(write?.body).toBeUndefined();
        // Re-read rather than merged: the write answers with jovi-mall's own
        // document, and a confirmation settles collections on the far side.
        await waitFor(() => {
            expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
        });
    });

    it('reports a lost race inline, with a reload rather than a retry', async () => {
        stubDetail(remittanceDetailFixture(), (call) =>
            call.method === 'POST'
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'The platform rejected this operation',
                      category: 'conflict',
                      details: { platformCode: 'COD_REMITTANCE_ALREADY_RESOLVED' },
                  })
                : undefined,
        );

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /confirm receipt/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /confirm receipt/i }));

        expect(await screen.findByText(/already been resolved/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    });

    it('sends the rejection reason the operator wrote', async () => {
        const calls = stubDetail(remittanceDetailFixture(), (call) =>
            call.method === 'POST' && call.url.includes('/reject')
                ? successResponse({ id: REMITTANCE_ID }, { message: 'Rejected' })
                : undefined,
        );

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(
            within(dialog).getByLabelText(/reason/i),
            'Not on the BICEC statement',
        );
        await userEvent.click(within(dialog).getByRole('button', { name: /reject declaration/i }));

        await waitFor(() => {
            const write = calls.find((call) => call.method === 'POST');
            expect(JSON.parse(write?.body ?? '{}')).toEqual({
                reason: 'Not on the BICEC statement',
            });
        });
    });
});

// ─── Deposits ─────────────────────────────────────────────────────────────────

describe('the deposit queue', () => {
    function stubList(rows = [platformDepositFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod/deposits')) {
                return successResponse(rows, { meta: codListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('marks the rows the agency owns, on the row itself', async () => {
        /*
         * `agency` is the normal route and most of a page is unactionable here.
         * Saying so per row is what stops an operator opening each one to find
         * out.
         */
        stubList([agencyDepositFixture()]);

        render(<DepositsList />, '/dashboard/cod/deposits');

        expect(await screen.findByText('The agency answers this one')).toBeInTheDocument();
    });

    it('says nothing of the sort on a deposit paid to the platform', async () => {
        stubList();

        render(<DepositsList />, '/dashboard/cod/deposits');

        await screen.findByText('Paid to the platform');
        expect(screen.queryByText('The agency answers this one')).not.toBeInTheDocument();
    });

    it('narrows to the queue an administrator owns in one press', async () => {
        const calls = stubList();

        render(<DepositsList />, '/dashboard/cod/deposits');
        await screen.findByText('AFRILAND/DEP/2026-08-13/8841');

        await userEvent.click(screen.getByRole('button', { name: /waiting on us/i }));

        await waitFor(() => {
            const query = latest(calls).searchParams;
            expect(query.get('recipient')).toBe('platform');
            expect(query.get('status')).toBe('declared');
        });
    });

    it('hides the record affordance without cod.deposits.create', async () => {
        stubList();

        render(<DepositsList />, '/dashboard/cod/deposits', new Set(['cod.deposits.read']));

        await screen.findByText('AFRILAND/DEP/2026-08-13/8841');
        expect(screen.queryByRole('button', { name: /record a deposit/i })).not.toBeInTheDocument();
    });
});

describe('recording a deposit by hand', () => {
    function stubList(write?: (call: FetchCall) => Response | undefined) {
        return stubFetch((call: FetchCall) => {
            const answered = write?.(call);
            if (answered) return answered;
            if (call.method === 'GET' && call.url.includes('/cod/deposits')) {
                return successResponse([platformDepositFixture()], {
                    meta: codListMetaFixture(),
                });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    async function openForm() {
        await userEvent.click(await screen.findByRole('button', { name: /record a deposit/i }));
        return screen.findByRole('dialog');
    }

    async function fill(dialog: HTMLElement, amount = '84500') {
        await userEvent.type(
            within(dialog).getByLabelText(/agent id/i),
            '6660112233445566778899aa',
        );
        await userEvent.type(
            within(dialog).getByLabelText(/agency id/i),
            '665c0011223344556677889a',
        );
        await userEvent.type(within(dialog).getByLabelText(/amount/i), amount);
        await userEvent.type(within(dialog).getByLabelText(/reference/i), 'AFRILAND/DEP/8841');
        await userEvent.click(within(dialog).getByRole('button', { name: /record the deposit/i }));
    }

    it('omits an empty note rather than sending an empty string', async () => {
        // The body is `.strict()` and optional fields are cleared by omission —
        // `''` on a create would store an empty note rather than none.
        const calls = stubList((call) =>
            call.method === 'POST'
                ? successResponse({ id: DEPOSIT_ID }, { status: 201, message: 'Recorded' })
                : undefined,
        );

        render(<DepositsList />, '/dashboard/cod/deposits');
        await fill(await openForm());

        await waitFor(() => {
            const write = calls.find((call) => call.method === 'POST');
            expect(JSON.parse(write?.body ?? '{}')).toEqual({
                agentId: '6660112233445566778899aa',
                agencyId: '665c0011223344556677889a',
                amount: 84500,
                reference: 'AFRILAND/DEP/8841',
            });
        });
    });

    it('refuses a fractional amount without asking the platform', async () => {
        const calls = stubList();

        render(<DepositsList />, '/dashboard/cod/deposits');
        await fill(await openForm(), '845.50');

        expect(await screen.findByText(/whole numbers only/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('turns a contract refusal into the number the operator needs', async () => {
        /*
         * jovi-mall's own `details.hint` is written for the agent's dashboard —
         * "hand it to your agency instead" — so the figure is used and the
         * sentence is rewritten for an administrator.
         */
        stubList((call) =>
            call.method === 'POST'
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'The platform rejected this operation',
                      category: 'validation',
                      details: {
                          platformCode: 'CONTRACT_SETTLEMENT_EXCEEDS_OUTSTANDING',
                          outstanding: 40000,
                          hint: 'The agent does not owe this agency that much.',
                      },
                  })
                : undefined,
        );

        render(<DepositsList />, '/dashboard/cod/deposits');
        await fill(await openForm());

        expect(await screen.findByText(/this agency is not owed that much/i)).toBeInTheDocument();
        expect(screen.getByText(/40,000/)).toBeInTheDocument();
        expect(screen.queryByText(/hand it to your agency/i)).not.toBeInTheDocument();
    });

    it('survives a refusal that arrives with no details at all', async () => {
        // `platformCode` always survives the hop; the numbers beside it travel
        // only when jovi-mall's category clears the forwarding rule.
        stubList((call) =>
            call.method === 'POST'
                ? errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'The platform rejected this operation',
                      details: { platformCode: 'COD_DEPOSIT_EXCEEDS_BALANCE' },
                  })
                : undefined,
        );

        render(<DepositsList />, '/dashboard/cod/deposits');
        await fill(await openForm());

        expect(
            await screen.findByText(/more cash than the agent is holding/i),
        ).toBeInTheDocument();
    });
});

describe('one deposit', () => {
    function stubDetail(
        deposit = depositDetailFixture(),
        write?: (call: FetchCall) => Response | undefined,
    ) {
        return stubFetch((call: FetchCall) => {
            const answered = write?.(call);
            if (answered) return answered;
            if (call.method === 'GET' && call.url.includes(`/cod/deposits/${DEPOSIT_ID}`)) {
                return successResponse(deposit);
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function detail(held = heldFixture(1)) {
        return render(
            <Routes>
                <Route path="/dashboard/cod/deposits/:depositId" element={<DepositDetail />} />
            </Routes>,
            `/dashboard/cod/deposits/${DEPOSIT_ID}`,
            held,
        );
    }

    it('withholds both actions on an agency deposit and says why', async () => {
        /*
         * The one place a permission holder is refused for a reason that is not a
         * permission: only the party the cash was handed to may answer for it.
         * Letting the 403 happen would mean a permission-shaped failure on the
         * majority of this screen.
         */
        stubDetail(agencyDepositDetailFixture());

        detail();

        expect(await screen.findByText('The agency answers this one.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /confirm receipt/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    });

    it('offers both on an unresolved platform deposit', async () => {
        stubDetail();

        detail();

        expect(await screen.findByRole('button', { name: /confirm receipt/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
        expect(screen.queryByText('The agency answers this one.')).not.toBeInTheDocument();
    });

    it('shows both legs of a settled deposit, named by whose liability moved', async () => {
        stubDetail(confirmedDepositDetailFixture());

        detail();

        await screen.findByRole('heading', { level: 1 });
        expect(screen.getByText('Whose liability')).toBeInTheDocument();
        expect(screen.getAllByText(/discharges what they owe/i)).toHaveLength(2);
    });

    it('confirms and re-reads', async () => {
        const calls = stubDetail(depositDetailFixture(), (call) =>
            call.method === 'POST' && call.url.includes('/confirm')
                ? successResponse({ id: DEPOSIT_ID }, { message: 'Deposit confirmed' })
                : undefined,
        );

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /confirm receipt/i }));
        await userEvent.click(
            within(await screen.findByRole('dialog')).getByRole('button', {
                name: /confirm receipt/i,
            }),
        );

        await waitFor(() => {
            expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
        });
    });

    it('reads a 403 on the recipient as the record moving, not as a permission problem', async () => {
        stubDetail(depositDetailFixture(), (call) =>
            call.method === 'POST'
                ? errorResponse(403, 'PLATFORM_OPERATION_REJECTED', {
                      message: 'The platform rejected this operation',
                      category: 'authorization',
                      details: {
                          platformCode: 'COD_DEPOSIT_WRONG_RECIPIENT',
                          recipient: 'agency',
                      },
                  })
                : undefined,
        );

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /confirm receipt/i }));
        await userEvent.click(
            within(await screen.findByRole('dialog')).getByRole('button', {
                name: /confirm receipt/i,
            }),
        );

        expect(await screen.findByText(/the agency owns this one/i)).toBeInTheDocument();
        expect(screen.queryByText(/not allowed|forbidden/i)).not.toBeInTheDocument();
    });
});

// ─── Discrepancies ────────────────────────────────────────────────────────────

describe('the discrepancy queue', () => {
    function stubList(rows = [discrepancyFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod/discrepancies')) {
                return successResponse(rows, { meta: codListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('keeps a kind it has never heard of, because this read is ours to filter', async () => {
        /*
         * The mirror of the remittance test: a direct read builds its own Mongo
         * filter from a bounded string, so an unknown value is an honest empty
         * page rather than a 400 — and a shared link keeps working.
         */
        stubList();

        render(<DiscrepanciesList />, '/dashboard/cod/discrepancies?type=vehicle_seized');
        await screen.findByRole('link', { name: /late deposit/i });

        await userEvent.click(screen.getByRole('combobox', { name: /kind/i }));

        expect(
            await screen.findByRole('option', { name: 'vehicle seized' }),
        ).toBeInTheDocument();
    });

    it('reports a non-monetary flag as having no amount rather than zero', async () => {
        stubList([nonMonetaryDiscrepancyFixture()]);

        render(<DiscrepanciesList />, '/dashboard/cod/discrepancies');

        expect(await screen.findByText('No amount')).toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('sends the default sort and both range ends as instants', async () => {
        const calls = stubList();

        render(
            <DiscrepanciesList />,
            '/dashboard/cod/discrepancies?createdFrom=2026-08-01&createdTo=2026-08-05',
        );
        await screen.findByRole('link', { name: /late deposit/i });

        const query = latest(calls).searchParams;
        expect(query.get('sort')).toBe('-createdAt');
        /*
         * Never a bare date: the contract refuses date-only values. The days are
         * resolved in the **operator's** zone — Africa/Douala, UTC+1 — so the
         * first instant is the hour before UTC midnight, and the range is
         * half-open, ending at the start of the 6th rather than of the 5th.
         */
        expect(query.get('from')).toBe('2026-07-31T23:00:00.000Z');
        expect(query.get('to')).toBe('2026-08-05T23:00:00.000Z');
    });
});

describe('one discrepancy', () => {
    function stubDetail(
        flag = discrepancyDetailFixture(),
        write?: (call: FetchCall) => Response | undefined,
    ) {
        return stubFetch((call: FetchCall) => {
            const answered = write?.(call);
            if (answered) return answered;
            if (call.method === 'GET' && call.url.includes(`/cod/discrepancies/${DISCREPANCY_ID}`)) {
                return successResponse(flag);
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function detail(held = heldFixture(1)) {
        return render(
            <Routes>
                <Route
                    path="/dashboard/cod/discrepancies/:discrepancyId"
                    element={<DiscrepancyDetail />}
                />
            </Routes>,
            `/dashboard/cod/discrepancies/${DISCREPANCY_ID}`,
            held,
        );
    }

    it('reads an empty trust list as the system working', async () => {
        // `deposit_not_confirmed` is the agency's failure and carries no agent
        // penalty; a blank here would read as a missing join.
        stubDetail();

        detail();

        expect(await screen.findByText(/no penalty was taken/i)).toBeInTheDocument();
    });

    it('shows the deposit at issue when the flag names one', async () => {
        stubDetail(
            discrepancyDetailFixture({
                deposit: platformDepositFixture(),
                trustEvents: [trustEventFixture()],
            }),
        );

        detail();

        expect(await screen.findByText('The deposit at issue')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open the deposit/i })).toBeInTheDocument();
        // The trust row that this very flag caused links nowhere — it is here.
        expect(screen.getByText('This flag')).toBeInTheDocument();
    });

    it('will not close a flag without an outcome and a note', async () => {
        const calls = stubDetail();

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /close this flag/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /close discrepancy/i }));

        // Neither outcome is offered as a default: "recovered" and "we lost the
        // money" are not a safe choice and its alternative.
        expect(await within(dialog).findByText(/pick an outcome/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/a resolution note is required/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('warns that a write-off is the platform absorbing the loss, then sends both fields', async () => {
        const calls = stubDetail(discrepancyDetailFixture(), (call) =>
            call.method === 'POST'
                ? successResponse({ _id: DISCREPANCY_ID }, { message: 'Discrepancy written_off' })
                : undefined,
        );

        detail();

        await userEvent.click(await screen.findByRole('button', { name: /close this flag/i }));
        const dialog = await screen.findByRole('dialog');

        await userEvent.click(within(dialog).getByRole('combobox'));
        await userEvent.click(await screen.findByRole('option', { name: /written off/i }));

        expect(within(dialog).getByText(/the platform absorbs this/i)).toBeInTheDocument();

        await userEvent.type(within(dialog).getByLabelText(/note/i), 'Agent left the platform');
        await userEvent.click(within(dialog).getByRole('button', { name: /close discrepancy/i }));

        await waitFor(() => {
            const write = calls.find((call) => call.method === 'POST');
            expect(JSON.parse(write?.body ?? '{}')).toEqual({
                resolution: 'written_off',
                note: 'Agent left the platform',
            });
        });
    });

    it('hides the action without cod.discrepancies.resolve', async () => {
        stubDetail();

        detail(new Set(['cod.discrepancies.read']));

        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('button', { name: /close this flag/i })).not.toBeInTheDocument();
    });
});

/**
 * Acting from the queue.
 *
 * Every one of these lists was read-and-navigate: the seven COD writes all
 * existed, and all seven lived on a detail screen. On a settlement queue,
 * answering the rows *is* the job.
 *
 * Two rules are load-bearing here and are asserted rather than assumed:
 *
 * 1. **The affordance keys on `resolvedAt`, never on `status`.** The COD status
 *    vocabularies belong to the platform and can gain a member on a routine
 *    deploy, which would silently stop offering the buttons.
 * 2. **A deposit paid to the *agency* is refused by a 403 no permission fixes.**
 *    `assertConfirmer` admits only the party the cash was handed to, and `agency`
 *    is the normal route — so most rows on an unfiltered page are unactionable
 *    here, and offering a button that always fails would be worse than offering
 *    none.
 */
describe('acting from a COD queue', () => {
    function stubRemittances(rows = [remittanceFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod/remittances')) {
                return successResponse(rows, { meta: codListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function stubDeposits(rows = [platformDepositFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod/deposits')) {
                return successResponse(rows, { meta: codListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function stubDiscrepancies(rows = [discrepancyFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/cod/discrepancies')) {
                return successResponse(rows, { meta: codListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('offers both verbs on an unanswered remittance', async () => {
        stubRemittances();

        render(<RemittancesList />, '/dashboard/cod/remittances');

        expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('offers nothing once a remittance has been answered', async () => {
        // Keyed on `resolvedAt`. A status this build has never heard of must not
        // change that — rejection stamps the same field confirmation does.
        stubRemittances([
            remittanceFixture({
                status: 'settled_by_some_future_process',
                resolvedAt: '2026-08-14T10:00:00.000Z',
            }),
        ]);

        render(<RemittancesList />, '/dashboard/cod/remittances');

        await screen.findByText(/settled by some future process/i);
        expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('offers each remittance verb only to a holder of its own permission', async () => {
        stubRemittances();

        render(
            <RemittancesList />,
            '/dashboard/cod/remittances',
            new Set(['cod.remittances.read', 'cod.remittances.confirm']),
        );

        expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('offers the verbs on a deposit paid to the platform', async () => {
        stubDeposits();

        render(<DepositsList />, '/dashboard/cod/deposits');

        expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });

    it('withholds them on a deposit the agency owns, whatever is held', async () => {
        // Tier 1 holds every permission and still cannot answer this one.
        stubDeposits([agencyDepositFixture()]);

        render(<DepositsList />, '/dashboard/cod/deposits');

        await screen.findByText('The agency answers this one');
        expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('offers Resolve on an open discrepancy', async () => {
        stubDiscrepancies();

        render(<DiscrepanciesList />, '/dashboard/cod/discrepancies');

        expect(await screen.findByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    });

    it('treats a written-off discrepancy as resolved', async () => {
        // `written_off` is a resolution too, which is exactly why keying on the
        // status vocabulary rather than on `resolvedAt` would be wrong.
        stubDiscrepancies([
            discrepancyFixture({
                status: 'written_off',
                resolvedAt: '2026-08-14T10:00:00.000Z',
            }),
        ]);

        render(<DiscrepanciesList />, '/dashboard/cod/discrepancies');

        await screen.findByText(/written off/i);
        expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    });

    it('opens the confirm dialog on the row it was pressed for', async () => {
        stubRemittances();

        render(<RemittancesList />, '/dashboard/cod/remittances');

        await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
});

/*
 * ── The COD pre-screen, ADR-024 D-5 ──────────────────────────────────────────
 *
 * The same endorsement step as on payouts, on a family where it is **not**
 * `financial` — a deposit or remittance in `declared` holds nothing, so
 * endorsing moves nothing and rejecting moves nothing either.
 *
 * ⚠ Tier 3 also gained `cod.overview.read`, `cod.remittances.read` and
 * `cod.deposits.read`, so these screens are reachable by Support for the first
 * time. Nothing was needed for that: the tier→permission matrix is never
 * hard-coded here, it comes from `GET /permissions/me`.
 */
describe('the COD pre-screen', () => {
    /** What Support holds on COD: the reads, plus triage. No confirm, no reject. */
    const SUPPORT_COD = new Set([
        'cod.overview.read',
        'cod.remittances.read',
        'cod.deposits.read',
        'cod.triage',
    ]);

    function stubRemittance(remittance = remittanceDetailFixture()) {
        return stubFetch((call: FetchCall) => {
            if (call.method === 'POST' && call.url.includes('/triage')) {
                return successResponse(null, { message: 'Remittance endorsed' });
            }
            if (call.method === 'GET' && call.url.includes(`/cod/remittances/${REMITTANCE_ID}`)) {
                return successResponse(remittance);
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    function remittanceDetail(held: ReadonlySet<string>) {
        return render(
            <Routes>
                <Route
                    path="/dashboard/cod/remittances/:remittanceId"
                    element={<RemittanceDetail />}
                />
            </Routes>,
            `/dashboard/cod/remittances/${REMITTANCE_ID}`,
            held,
        );
    }

    function depositDetail(deposit: ReturnType<typeof depositDetailFixture>, held: ReadonlySet<string>) {
        stubFetch((call: FetchCall) => {
            if (call.method === 'POST' && call.url.includes('/triage')) {
                return successResponse(null, { message: 'Deposit endorsed' });
            }
            if (call.method === 'GET' && call.url.includes(`/cod/deposits/${DEPOSIT_ID}`)) {
                return successResponse(deposit);
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        return render(
            <Routes>
                <Route path="/dashboard/cod/deposits/:depositId" element={<DepositDetail />} />
            </Routes>,
            `/dashboard/cod/deposits/${DEPOSIT_ID}`,
            held,
        );
    }

    it('offers Endorse on an unanswered remittance, and posts the note', async () => {
        const calls = stubRemittance();

        remittanceDetail(SUPPORT_COD);

        await userEvent.click(await screen.findByRole('button', { name: 'Endorse' }));
        await userEvent.type(await screen.findByLabelText(/note/i), 'Counted against the sheet');
        await userEvent.click(screen.getByRole('button', { name: 'Endorse' }));

        const triage = calls.find((call) => call.url.includes('/triage'));
        expect(triage?.method).toBe('POST');
        expect(triage?.url).toContain(`/cod/remittances/${REMITTANCE_ID}/triage`);
        expect(JSON.parse(triage?.body ?? '{}')).toEqual({ note: 'Counted against the sheet' });
    });

    it('withholds Endorse from an administrator without cod.triage', async () => {
        stubRemittance();

        remittanceDetail(new Set(['cod.remittances.read', 'cod.remittances.confirm']));

        // The confirm control proves the screen rendered its action bar at all.
        expect(await screen.findByRole('button', { name: /confirm receipt/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument();
    });

    it('never gates confirm on an endorsement', async () => {
        /*
         * ⛔ D-2 again, on this family. An un-endorsed remittance is exactly as
         * confirmable — the pre-screen saves the confirming administrator work
         * rather than being a step they wait on.
         */
        stubRemittance(remittanceDetailFixture({ triage: null }));

        remittanceDetail(new Set(['cod.remittances.read', 'cod.remittances.confirm']));

        expect(await screen.findByRole('button', { name: /confirm receipt/i })).toBeEnabled();
    });

    it('offers Endorse on a deposit paid to the platform', async () => {
        depositDetail(depositDetailFixture(), SUPPORT_COD);

        expect(await screen.findByRole('button', { name: 'Endorse' })).toBeEnabled();
    });

    it('withholds Endorse on an agency-recipient deposit, whatever is held', async () => {
        /*
         * ⚠⚠ `/deposits/:id/triage` is refused on an agency deposit with `403
         * COD_DEPOSIT_WRONG_RECIPIENT` and **no permission fixes it** — that
         * handover is counter-signed between two organisations and the platform
         * never saw the cash. `agency` is the NORMAL route, so most rows are not
         * endorsable here; letting the 403 happen would be a permission-shaped
         * failure on the majority of the screen.
         */
        depositDetail(agencyDepositDetailFixture(), SUPPORT_COD);

        await screen.findByText(/declared by/i);
        expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument();
    });
});
