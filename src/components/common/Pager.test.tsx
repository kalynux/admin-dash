import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Pager } from '@/components/common/Pager';

function pager(meta: Partial<Parameters<typeof Pager>[0]['meta']> = {}, onPageChange = vi.fn()) {
    render(
        <Pager
            meta={{ total: 100, page: 2, limit: 20, pages: 5, ...meta }}
            onPageChange={onPageChange}
        />,
    );
    return onPageChange;
}

describe('when it renders at all', () => {
    it('renders nothing for an empty list', () => {
        // **An empty list reports `pages: 0`, not `1`.** A pager that recomputed
        // the count instead of reading `meta` would show "page 1 of 1" over nothing.
        const { container } = render(
            <Pager meta={{ total: 0, page: 1, limit: 20, pages: 0 }} onPageChange={vi.fn()} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when everything fits on one page', () => {
        const { container } = render(
            <Pager meta={{ total: 12, page: 1, limit: 20, pages: 1 }} onPageChange={vi.fn()} />,
        );

        expect(container).toBeEmptyDOMElement();
    });
});

describe('the controls', () => {
    it('reports which slice is on screen', () => {
        pager();

        expect(screen.getByText(/21–40 of 100/)).toBeInTheDocument();
        expect(screen.getByText(/page 2 of 5/i)).toBeInTheDocument();
    });

    it('does not claim more rows than the total on the last page', () => {
        pager({ total: 43, page: 3, limit: 20, pages: 3 });

        expect(screen.getByText(/41–43 of 43/)).toBeInTheDocument();
    });

    it('moves a page in each direction', async () => {
        const onPageChange = pager();

        await userEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(onPageChange).toHaveBeenCalledWith(3);

        await userEvent.click(screen.getByRole('button', { name: /previous/i }));
        expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('cannot step off either end', () => {
        pager({ page: 1 });
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    });

    it('disables both while a newer read is in flight', () => {
        render(
            <Pager
                meta={{ total: 100, page: 2, limit: 20, pages: 5 }}
                onPageChange={vi.fn()}
                isBusy
            />,
        );

        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });
});
