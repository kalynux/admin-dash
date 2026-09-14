import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilterBar } from '@/components/common/FilterBar';
import { FilterField, FilterFieldSpacer } from '@/components/common/FilterField';

describe('a filter and its title', () => {
    it('names the control, so clicking the title reaches it', async () => {
        render(
            <FilterField label="Payment status" htmlFor="payment-status">
                <input id="payment-status" />
            </FilterField>,
        );

        // The association, not merely the presence of the words: a title that
        // sits above a box without pointing at it is decoration.
        const control = screen.getByLabelText('Payment status');
        await userEvent.click(screen.getByText('Payment status'));

        expect(control).toHaveFocus();
    });

    it('takes a title with something beside it, which several filters need', () => {
        render(
            <FilterField
                htmlFor="origin"
                label={
                    <>
                        Opened by
                        <button type="button">why</button>
                    </>
                }
            >
                <input id="origin" />
            </FilterField>,
        );

        expect(screen.getByRole('button', { name: 'why' })).toBeInTheDocument();
        // By role, not `getByLabelText`: the hint button lives *inside* the
        // label, so a text query matches it as well as the control it names.
        expect(screen.getByRole('textbox')).toHaveAccessibleName(/opened by/i);
    });
});

describe('the row', () => {
    /**
     * ⚠ The alignment rule, asserted rather than left to the eye.
     *
     * `FilterBar` aligns its children to the **top**, and every child opens with
     * one title line of the same height. That is the whole mechanism: centring
     * put a labelled control a label's height below an unlabelled one, which is
     * the misalignment this round was opened to fix. A change to either half
     * breaks the row, and neither half is visible from the other's file.
     */
    it('aligns its children to the top, not the middle', () => {
        const { container } = render(
            <FilterBar>
                <FilterField label="A" htmlFor="a">
                    <input id="a" />
                </FilterField>
            </FilterBar>,
        );

        expect(container.firstElementChild?.className).toContain('items-start');
        expect(container.firstElementChild?.className).not.toContain('items-center');
    });

    it('gives every title the same height, whatever it contains', () => {
        render(
            <FilterBar>
                <FilterField label="Short" htmlFor="short">
                    <input id="short" />
                </FilterField>
                <FilterField
                    htmlFor="long"
                    label={
                        <>
                            With a hint
                            <button type="button">?</button>
                        </>
                    }
                >
                    <input id="long" />
                </FilterField>
            </FilterBar>,
        );

        for (const text of ['Short', 'With a hint']) {
            expect(screen.getByText(text).className).toContain('h-5');
        }
    });

    it('lends the title line to a child that has no title of its own', () => {
        // The clear control and the toggles. Without the borrowed line they sit a
        // title's height above everything beside them.
        const { container } = render(
            <FilterFieldSpacer>
                <button type="button">Clear filters</button>
            </FilterFieldSpacer>,
        );

        const line = container.querySelector('span[aria-hidden]');
        expect(line).not.toBeNull();
        expect(line?.className).toContain('h-5');
        expect(line?.textContent).toBe('');
    });

    it('shows the clear control only once something is set', async () => {
        const { rerender } = render(
            <FilterBar isFiltered={false} onClear={() => {}}>
                <span>filters</span>
            </FilterBar>,
        );
        expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();

        rerender(
            <FilterBar isFiltered onClear={() => {}}>
                <span>filters</span>
            </FilterBar>,
        );
        expect(await screen.findByRole('button', { name: /clear filters/i })).toBeInTheDocument();
    });
});
