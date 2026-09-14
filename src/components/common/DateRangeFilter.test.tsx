import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DateRangeFilter } from '@/components/common/DateRangeFilter';

function filter(props: Partial<Parameters<typeof DateRangeFilter>[0]> = {}) {
    const onChange = vi.fn();
    render(
        <DateRangeFilter
            label="Created"
            from=""
            to=""
            onChange={onChange}
            timeZone="Africa/Douala"
            maxDays={366}
            {...props}
        />,
    );
    return onChange;
}

describe('the trigger', () => {
    it('says the filter is unset, and is still named by its title', () => {
        // The name comes from the title above it; the face of the button is the
        // *value*, and "Any date" is a value an operator can read as "no filter"
        // without having learnt the screen.
        filter();

        expect(screen.getByRole('button', { name: 'Created' })).toHaveTextContent('Any date');
        expect(screen.getByText('Created')).toBeInTheDocument();
    });

    it('reports the length of the range, not only its ends', () => {
        // "30 or 31 days?" is the question a report raises, and counting it off
        // two medium-format dates is exactly the arithmetic nobody should do.
        filter({ from: '2026-08-11', to: '2026-08-13' });

        expect(screen.getByRole('button', { name: 'Created' })).toHaveTextContent('3d');
    });

    it('renders a single day once rather than as a range to itself', () => {
        filter({ from: '2026-08-11', to: '2026-08-11' });

        const trigger = screen.getByRole('button', { name: 'Created' });
        expect(trigger).not.toHaveTextContent('–');
        expect(trigger).toHaveTextContent('1d');
    });

    it('describes a full range once both ends are set', () => {
        filter({ from: '2026-08-11', to: '2026-08-13' });

        expect(screen.getByRole('button', { name: 'Created' })).toHaveTextContent('–');
    });

    it('says which end it has when only one is set', () => {
        // Both ends are independently optional on the wire: `from` alone means
        // "since", `to` alone means "until".
        filter({ from: '2026-08-11', to: '' });

        expect(screen.getByRole('button', { name: 'Created' })).toHaveTextContent(/^From /);
    });

    it('clears both ends at once', async () => {
        const onChange = filter({ from: '2026-08-11', to: '2026-08-13' });

        await userEvent.click(screen.getByRole('button', { name: /clear created/i }));

        expect(onChange).toHaveBeenCalledWith({ from: '', to: '' });
    });

    it('offers no clear control when nothing is set', () => {
        filter();

        expect(screen.queryByRole('button', { name: /clear created/i })).not.toBeInTheDocument();
    });
});

describe('the span cap', () => {
    it('says so when the range exceeds the endpoint’s maximum', () => {
        // An over-cap span is a 400. The screen reads this state to decide not to
        // send the filter at all, so the list keeps its last good page.
        filter({ from: '2025-01-01', to: '2026-08-13' });

        expect(screen.getByRole('alert')).toHaveTextContent(/366 days or fewer/i);
        expect(screen.getByRole('button', { name: 'Created' })).toHaveAttribute(
            'aria-invalid',
            'true',
        );
    });

    it('accepts a range exactly at the cap', () => {
        filter({ from: '2026-01-01', to: '2026-08-13', maxDays: 366 });

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('applies the tighter cap the audit trail enforces', () => {
        // `GET /audit` caps at 92 days where most lists allow 366 — the component
        // takes the number rather than assuming one.
        filter({ from: '2026-01-01', to: '2026-08-13', maxDays: 92 });

        expect(screen.getByRole('alert')).toHaveTextContent(/92 days or fewer/i);
    });

    it('does not complain about a half-set range, which has no span yet', () => {
        filter({ from: '2020-01-01', to: '' });

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('the presets', () => {
    /**
     * `2026-08-13` in Douala (UTC+1) — fixed, because every preset is anchored on
     * *today* and a test anchored on the real one passes or fails by the date.
     */
    beforeEach(() => {
        /*
          ⚠ `shouldAdvanceTime`, not a frozen clock. Radix's popover and
          `userEvent` both schedule real timers, and a clock that never moves
          leaves the popover half-open and every test in this block hanging out
          its full 20 s. This pins the *date* — which is all these assertions
          need — while letting time pass.
        */
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date('2026-08-13T09:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function openPopover() {
        await userEvent.click(screen.getByRole('button', { name: 'Created' }));
    }

    it('commits a whole range in one click, resolved in the operator’s zone', async () => {
        const onChange = filter();
        await openPopover();

        await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

        // Inclusive, as an operator means it: the 7th through the 13th.
        expect(onChange).toHaveBeenCalledWith({ from: '2026-08-07', to: '2026-08-13' });
    });

    it('anchors “today” on the profile’s zone, not the browser’s', async () => {
        // 23:30 UTC on the 13th is already the 14th in Douala. A preset resolved
        // against the browser would file the report a day late.
        vi.setSystemTime(new Date('2026-08-13T23:30:00Z'));
        const onChange = filter();
        await openPopover();

        await userEvent.click(screen.getByRole('button', { name: 'Today' }));

        expect(onChange).toHaveBeenCalledWith({ from: '2026-08-14', to: '2026-08-14' });
    });

    it('offers no preset the endpoint would refuse', async () => {
        // `GET /audit` caps at 92 days. A "Last 90 days" button is a promise;
        // "Year to date" in August is 226 days and would only ever 400.
        filter({ maxDays: 92 });
        await openPopover();

        expect(screen.getByRole('button', { name: 'Last 90 days' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Year to date' })).not.toBeInTheDocument();
    });

    it('marks the preset that is already in force', async () => {
        filter({ from: '2026-08-07', to: '2026-08-13' });
        await openPopover();

        // `secondary` is the chosen variant; `ghost` is every other preset.
        expect(screen.getByRole('button', { name: 'Last 7 days' }).className).toContain(
            'bg-secondary',
        );
    });
});
