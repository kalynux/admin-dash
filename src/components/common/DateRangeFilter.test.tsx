import { describe, expect, it, vi } from 'vitest';
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
    it('shows the label until a range is picked', () => {
        filter();

        expect(screen.getByRole('button', { name: 'Created' })).toHaveTextContent('Created');
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
