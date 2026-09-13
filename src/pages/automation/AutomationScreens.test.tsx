import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RequirePermission } from '@/components/auth/RequirePermission';
import { AUTOMATION_PERMISSION } from '@/config/navigation';
import { AutomationFailures } from '@/pages/automation/AutomationFailures';
import { AutomationSummary } from '@/pages/automation/AutomationSummary';
import {
    adminFailureFixture,
    automationFailuresPageFixture,
    automationSummaryFixture,
    CARDS_WORKFLOW_ID,
    CORE_WORKFLOW_ID,
    developerFailureFixture,
    executionFailedFixture,
    failureGroupFixture,
    oneCustomerRetryingGroupFixture,
    supportFailureFixture,
    unconfiguredFailuresPageFixture,
    unconfiguredSummaryFixture,
} from '@/test/automation-fixtures';
import { adminFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AutomationFailuresPage, AutomationSummary as Summary } from '@/types/automation.types';
import type { AdminTier } from '@/types/auth.types';

/**
 * The three held sets, written out rather than taken from `heldFixture`.
 *
 * Each is exactly the one name that reaches this module at that rung, which is what makes the
 * refusal test below mean something: a set that happened to carry a second automation name
 * would pass the gate for the wrong reason.
 */
const DEVELOPER_HELD = new Set(['developer_tools.logs.read']);
const ADMIN_HELD = new Set(['system.automation.read']);
const SUPPORT_HELD = new Set(['support.automation.lookup']);

/**
 * Answers the two `/automation` reads and **throws on anything else**, so a stray request —
 * a per-workflow lookup somebody adds later, say — fails the test rather than passing quietly.
 */
function stubAutomation({
    failures,
    summary,
}: { failures?: AutomationFailuresPage; summary?: Summary } = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/automation/failures')) {
            return successResponse(failures ?? automationFailuresPageFixture());
        }
        if (call.url.includes('/automation/summary')) {
            return successResponse(summary ?? automationSummaryFixture());
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function render(ui: React.ReactElement, held: Set<string>, tier: AdminTier = 1) {
    return renderWithProviders(ui, {
        route: '/dashboard/automation',
        permissions: { held },
        auth: {
            status: 'authenticated',
            admin: adminFixture({ tier, timezone: 'Africa/Douala' }),
        },
    });
}

describe('Failures — the projection is the server’s, and it is rendered', () => {
    /**
     * The contract's own reason for `view`: without it a Support agent reading a three-field
     * row cannot tell *"there is nothing more to know"* from *"I am not being shown it"*, and
     * escalates an incident that is already understood.
     */
    it('tells a support caller that a thin row is the whole row', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'support',
                entries: [supportFailureFixture()],
            }),
        });
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        expect(await screen.findByText(/support view/i)).toBeInTheDocument();
        expect(screen.getByText(/this is everything at this level/i)).toBeInTheDocument();
    });

    it('names an unrecognised projection rather than rendering nothing', async () => {
        // The open `view` arm. A grading this client has not heard of must still be disclosed.
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'auditor',
                entries: [supportFailureFixture()],
            }),
        });
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        expect(await screen.findByText('Projection: auditor.')).toBeInTheDocument();
    });

    /**
     * ⚠ Narrowed on the **row**, not on the reader. Rendered here with the *developer* held
     * set over a *support* row: a thin row must render thin however privileged the viewer, or
     * the screen is reading the caller's grants instead of the response.
     */
    it('renders a thin row thin even for a developer', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'support',
                entries: [supportFailureFixture()],
            }),
        });
        render(<AutomationFailures />, DEVELOPER_HELD, 1);

        expect(await screen.findByText(/support view/i)).toBeInTheDocument();
        expect(screen.queryByText('UP-wi-mall-core')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Stack' })).not.toBeInTheDocument();
    });

    it('renders the machine detail on an admin row', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                entries: [adminFailureFixture()],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText('UP-wi-mall-core')).toBeInTheDocument();
        expect(screen.getByText('sync identity')).toBeInTheDocument();
        expect(screen.getByText(/timeout of 20000ms exceeded/)).toBeInTheDocument();
        // The stack is the developer rung's, and an admin row carries no key for it.
        expect(screen.queryByRole('button', { name: 'Stack' })).not.toBeInTheDocument();
    });

    it('offers the stack only on a row that carries the key', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'developer',
                entries: [developerFailureFixture()],
            }),
        });
        render(<AutomationFailures />, DEVELOPER_HELD, 1);

        await userEvent.click(await screen.findByRole('button', { name: 'Stack' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/AxiosError: timeout of 20000ms exceeded/)).toBeInTheDocument();
    });
});

describe('Failures — the two kinds are never merged', () => {
    it('gives each kind its own section and keeps the empty one visible', async () => {
        // Zero died-outright beside one degraded turn IS the diagnosis; dropping the empty
        // half would render a one-sided window as an ordinary one.
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                count: 1,
                entries: [adminFailureFixture()],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText('Died outright')).toBeInTheDocument();
        expect(screen.getByText('Degraded answers')).toBeInTheDocument();
        expect(screen.getByText('None in this window.')).toBeInTheDocument();
    });

    it('reads a wall of degraded turns as something else being down', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                count: 2,
                entries: [adminFailureFixture(), adminFailureFixture({ id: 'b' })],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText(/points at something behind it/i)).toBeInTheDocument();
    });

    it('reads a wall of dead runs as the automation layer itself', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                count: 1,
                entries: [executionFailedFixture()],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText(/points at the automation layer itself/i)).toBeInTheDocument();
    });

    it('says nothing when the window is mixed, because there is no single reading', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                count: 2,
                entries: [adminFailureFixture(), executionFailedFixture()],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText('UP-wi-mall-core')).toBeInTheDocument();
        expect(screen.queryByText(/points at something behind it/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/points at the automation layer itself/i)).not.toBeInTheDocument();
    });

    it('keeps a kind it has never heard of rather than dropping it', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'support',
                count: 1,
                entries: [supportFailureFixture({ kind: 'quota_exhausted' })],
            }),
        });
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        // Adding an enum member is additive on this service; a closed switch would break.
        expect(await screen.findByText('quota exhausted')).toBeInTheDocument();
    });
});

describe('Failures — the filters', () => {
    /**
     * ⚠ The trap the contract states outright: `unknown` is the stored default, and an
     * `execution_failed` report has no envelope to read a channel from. A Telegram/WhatsApp
     * dropdown would hide the more urgent half of the feed while looking complete.
     */
    it('offers unknown in the channel filter', async () => {
        stubAutomation();
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        await userEvent.click(await screen.findByRole('combobox', { name: 'Channel' }));

        expect(await screen.findByRole('option', { name: 'Unknown channel' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'telegram' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'whatsapp' })).toBeInTheDocument();
    });

    it('filters on the workflow ID, and says so on the control', async () => {
        stubAutomation();
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        // The name has changed twice in a day and the id did not move through either rename.
        const box = await screen.findByLabelText('Filter by workflow ID');
        expect(box).toHaveAttribute('placeholder', 'Workflow ID');
        expect(box).toHaveAttribute('maxLength', '64');
    });

    it('warns when the answer is exactly the row limit, because there is no paging', async () => {
        const entries = Array.from({ length: 50 }, (_, index) =>
            adminFailureFixture({ id: `row-${index}` }),
        );
        stubAutomation({
            failures: automationFailuresPageFixture({ view: 'admin', count: 50, entries }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText(/Showing the first 50 reports/)).toBeInTheDocument();
    });
});

describe('configured: false is not “all healthy”', () => {
    it('says the deployment accepts no reports, on the feed', async () => {
        stubAutomation({ failures: unconfiguredFailuresPageFixture() });
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        expect(
            await screen.findByText(/This deployment accepts no failure reports/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/it may be failing right now/i)).toBeInTheDocument();
    });

    it('says it on the summary too', async () => {
        stubAutomation({ summary: unconfiguredSummaryFixture() });
        render(<AutomationSummary />, SUPPORT_HELD, 3);

        expect(
            await screen.findByText(/This deployment accepts no failure reports/i),
        ).toBeInTheDocument();
    });

    it('distinguishes a genuinely quiet window from a deaf deployment', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({ count: 0, entries: [] }),
        });
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        expect(await screen.findByText('Nothing was reported in this window.')).toBeInTheDocument();
        expect(
            screen.queryByText(/This deployment accepts no failure reports/i),
        ).not.toBeInTheDocument();
    });
});

describe('Coverage is stated as a rule, never as a count', () => {
    it('says a missing workflow may never have been wired', async () => {
        stubAutomation();
        render(<AutomationFailures />, SUPPORT_HELD, 3);

        expect(await screen.findByText(/Coverage is an allowlist/)).toBeInTheDocument();
    });

    /**
     * ⚠ `automation.md` says nine workflows report; ADR-022's re-measure of the instance says
     * ten, one day later. The figure drifts on a schedule nobody controls, so the UI states
     * none — and this is the assertion that catches somebody helpfully adding one back.
     */
    it('prints no coverage figure anywhere on either screen', async () => {
        stubAutomation();
        const { container, unmount } = render(<AutomationFailures />, SUPPORT_HELD, 3);
        await screen.findByText(/Coverage is an allowlist/);
        expect(container.textContent).not.toMatch(/\b(nine|ten|9|10)\s+workflows?\b/i);
        unmount();

        const second = render(<AutomationSummary />, SUPPORT_HELD, 3);
        await screen.findByText(/Coverage is an allowlist/);
        expect(second.container.textContent).not.toMatch(/\b(nine|ten|9|10)\s+workflows?\b/i);
    });
});

describe('The UP- prefix is not treated as meaningful', () => {
    it('renders a prefixed and an unprefixed workflow name verbatim, side by side', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                count: 2,
                entries: [adminFailureFixture(), executionFailedFixture()],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        // Neither stripped nor normalised: one of the wired workflows genuinely has no prefix,
        // and a screen that assumed otherwise would mislabel it.
        expect(await screen.findByText('UP-wi-mall-core')).toBeInTheDocument();
        expect(screen.getByText('wi-mall-product-cards')).toBeInTheDocument();
    });

    it('shows the name and copies the id, which is the stable handle', async () => {
        stubAutomation({
            failures: automationFailuresPageFixture({
                view: 'admin',
                count: 1,
                entries: [adminFailureFixture()],
            }),
        });
        render(<AutomationFailures />, ADMIN_HELD, 2);

        expect(await screen.findByText(CORE_WORKFLOW_ID)).toBeInTheDocument();
    });
});

describe('Summary — distinctCustomers is the reading, not just the number', () => {
    it('is not tier-projected, so a support caller sees the whole group', async () => {
        stubAutomation();
        render(<AutomationSummary />, SUPPORT_HELD, 3);

        // The workflow, its id and the customer count — all of which the feed withholds
        // from this same caller. There is no `view` notice here because there is no grading.
        expect(await screen.findByText('UP-wi-mall-core')).toBeInTheDocument();
        expect(screen.getByText(CORE_WORKFLOW_ID)).toBeInTheDocument();
        expect(screen.getByText('12 customers')).toBeInTheDocument();
        expect(screen.queryByText(/You are seeing the/i)).not.toBeInTheDocument();
    });

    it('calls out one person retrying, which the count alone cannot', async () => {
        stubAutomation({
            summary: automationSummaryFixture({
                groups: [failureGroupFixture(), oneCustomerRetryingGroupFixture()],
            }),
        });
        render(<AutomationSummary />, ADMIN_HELD, 2);

        // Same 47, opposite conclusions.
        expect(await screen.findByText('12 customers')).toBeInTheDocument();
        expect(screen.getByText('1 customer — one person retrying')).toBeInTheDocument();
        expect(screen.getAllByText('47')).toHaveLength(2);
    });

    it('splits the groups by kind as well, and keeps the id copyable', async () => {
        stubAutomation({
            summary: automationSummaryFixture({
                groups: [failureGroupFixture(), oneCustomerRetryingGroupFixture()],
            }),
        });
        render(<AutomationSummary />, ADMIN_HELD, 2);

        expect(await screen.findByText('Died outright')).toBeInTheDocument();
        expect(screen.getByText('Degraded answers')).toBeInTheDocument();
        expect(screen.getByText(CARDS_WORKFLOW_ID)).toBeInTheDocument();
    });

    it('dates the window from the service’s own `since`, not the browser clock', async () => {
        stubAutomation();
        render(<AutomationSummary />, ADMIN_HELD, 2);

        expect(await screen.findByText(/Counted from/)).toBeInTheDocument();
        expect(screen.getByText(/the last 24 hours/)).toBeInTheDocument();
    });
});

describe('the module’s guard', () => {
    /**
     * The `any`-mode three-permission ladder, exercised through the same object the sidebar
     * filters on. Holding **none** of the three is the only way to be refused — which is what
     * makes the narrow held sets above honest.
     */
    function renderGated(held: Set<string>) {
        return renderWithProviders(
            <RequirePermission permission={AUTOMATION_PERMISSION} mode="any" subject="Automation">
                <p>the module</p>
            </RequirePermission>,
            { route: '/dashboard/automation/summary', permissions: { held } },
        );
    }

    it.each([
        ['a developer', DEVELOPER_HELD],
        ['an admin', ADMIN_HELD],
        ['support', SUPPORT_HELD],
    ])('admits %s on their one name alone', (_who, held) => {
        renderGated(held);
        expect(screen.getByText('the module')).toBeInTheDocument();
    });

    it('refuses a caller holding none of the three', () => {
        // A neighbouring `system.*` grant is not enough: `system.automation.read` is its own
        // name, added with the route group, and the guard names all three.
        renderGated(new Set(['system.errors.read', 'support.errors.lookup']));
        expect(screen.queryByText('the module')).not.toBeInTheDocument();
    });
});
