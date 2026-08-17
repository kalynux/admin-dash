import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataTable, type Column } from '@/components/common/DataTable';
import { ApiError } from '@/types/api.types';

interface Row {
    id: string;
    name: string;
}

const ROWS: Row[] = [
    { id: '1', name: 'Amina' },
    { id: '2', name: 'Bakari' },
];

const COLUMNS: Column<Row>[] = [
    { id: 'name', header: 'Name', sortKey: 'email', cell: (row) => row.name },
    { id: 'plain', header: 'Plain', cell: (row) => row.id },
];

function table(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
    return render(
        <DataTable
            caption="Rows"
            columns={COLUMNS}
            rows={ROWS}
            rowKey={(row) => row.id}
            isLoading={false}
            {...props}
        />,
    );
}

describe('the four-way state', () => {
    it('renders rows when there are rows', () => {
        table();

        expect(screen.getByRole('table', { name: 'Rows' })).toBeInTheDocument();
        expect(screen.getByText('Amina')).toBeInTheDocument();
    });

    it('shows the error over an empty result, not "no results"', () => {
        // A failed request that also has no rows is a failure. Saying "nothing
        // matched" would be a lie about a question that was never answered.
        table({
            rows: [],
            error: new ApiError({
                status: 500,
                code: 'INTERNAL_SERVER_ERROR',
                category: 'internal',
                message: 'Something went wrong',
            }),
            empty: <p>nothing matched</p>,
        });

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.queryByText('nothing matched')).not.toBeInTheDocument();
    });

    it('shows the empty state only when the read succeeded with no rows', () => {
        table({ rows: [], empty: <p>nothing matched</p> });

        expect(screen.getByText('nothing matched')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('shows a skeleton rather than a table while loading', () => {
        table({ isLoading: true, rows: [] });

        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('says it is loading rather than presenting silent grey bars', () => {
        table({ isLoading: true, rows: [] });

        expect(screen.getByRole('status')).toHaveTextContent(/loading rows/i);
    });

    it('draws the real headers in the skeleton, so the table does not change shape', () => {
        // The columns are a property of the screen, not of the response, so they
        // are known before the request settles and cost nothing to show.
        table({ isLoading: true, rows: [] });

        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByText('Plain')).toBeInTheDocument();
    });

    it('keeps the rows on screen while a newer read is in flight', () => {
        // A refresh over existing rows is a moment-old answer, not a wrong one.
        // Blanking it to a skeleton costs more than it tells.
        table({ isRefreshing: true });

        expect(screen.getByText('Amina')).toBeInTheDocument();
        expect(screen.getByRole('table').parentElement).toHaveAttribute('aria-busy', 'true');
    });

    it('claims no busy state when nothing is in flight', () => {
        table();

        expect(screen.getByRole('table').parentElement).not.toHaveAttribute('aria-busy');
    });
});

describe('numeric columns', () => {
    const NUMERIC: Column<Row>[] = [
        { id: 'name', header: 'Name', cell: (row) => row.name },
        { id: 'amount', header: 'Amount', numeric: true, cell: (row) => row.id },
    ];

    it('right-aligns the figures and their header, in tabular figures', () => {
        // Digits have to line up in their places down the page for a column of
        // amounts to be scannable for an outlier.
        render(
            <DataTable
                caption="Rows"
                columns={NUMERIC}
                rows={ROWS}
                rowKey={(row) => row.id}
                isLoading={false}
            />,
        );

        const [, amountHeader] = screen.getAllByRole('columnheader');
        expect(amountHeader.className).toContain('text-right');

        const cell = screen.getByRole('cell', { name: '1' });
        expect(cell.className).toContain('text-right');
        expect(cell.className).toContain('tabular-nums');
    });

    it('leaves an ordinary column reading left to right', () => {
        render(
            <DataTable
                caption="Rows"
                columns={NUMERIC}
                rows={ROWS}
                rowKey={(row) => row.id}
                isLoading={false}
            />,
        );

        const [nameHeader] = screen.getAllByRole('columnheader');
        expect(nameHeader.className).not.toContain('text-right');
    });
});

describe('sorting', () => {
    it('sorts an inactive column ascending on the first click', async () => {
        const onSortChange = vi.fn();
        table({ sort: '-createdAt', onSortChange });

        await userEvent.click(screen.getByRole('button', { name: /name/i }));

        expect(onSortChange).toHaveBeenCalledWith('email');
    });

    it('flips the active column rather than re-sending the same key', async () => {
        const onSortChange = vi.fn();
        table({ sort: 'email', onSortChange });

        await userEvent.click(screen.getByRole('button', { name: /name/i }));

        expect(onSortChange).toHaveBeenCalledWith('-email');
    });

    it('returns a descending column to ascending', async () => {
        const onSortChange = vi.fn();
        table({ sort: '-email', onSortChange });

        await userEvent.click(screen.getByRole('button', { name: /name/i }));

        expect(onSortChange).toHaveBeenCalledWith('email');
    });

    it('announces the current ordering rather than leaving it to the arrow', () => {
        table({ sort: '-email', onSortChange: vi.fn() });

        const [sortable, plain] = screen.getAllByRole('columnheader');
        expect(sortable).toHaveAttribute('aria-sort', 'descending');
        // A column with no `sortKey` is not a sort control and must not claim to be.
        expect(plain).not.toHaveAttribute('aria-sort');
    });

    it('offers no sort control when the endpoint has no sort to offer', () => {
        // Some lists have a compound natural order and no `?sort=` at all —
        // rendering a header that emits an undeclared field would earn a 400.
        table({ sort: 'email' });

        expect(screen.queryByRole('button', { name: /name/i })).not.toBeInTheDocument();
    });
});
