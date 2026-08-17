import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchInput } from '@/components/common/SearchInput';

/**
 * A stand-in for the URL: the committed value round-trips back down as a prop,
 * exactly as `useListQueryState` makes it. That loop is the whole reason this
 * component is harder than it looks.
 */
function Harness({ onCommit, initial = '' }: { onCommit?: (value: string) => void; initial?: string }) {
    const [value, setValue] = useState(initial);

    return (
        <>
            <SearchInput
                label="Search users"
                value={value}
                delay={20}
                onChange={(next) => {
                    setValue(next);
                    onCommit?.(next);
                }}
            />
            <button onClick={() => setValue('')}>clear externally</button>
            <output data-testid="committed">{value}</output>
        </>
    );
}

describe('committing', () => {
    it('reports on a pause rather than once per keystroke', async () => {
        const onCommit = vi.fn();
        render(<Harness onCommit={onCommit} />);

        await userEvent.type(screen.getByRole('searchbox'), 'amina');

        await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith('amina'));
        // Not "exactly once": five keystrokes against a short debounce can
        // legitimately produce two commits on a slow machine. The claim worth
        // pinning is that a request is not fired per character.
        expect(onCommit.mock.calls.length).toBeLessThan(5);
    });

    it('trims what it reports', async () => {
        const onCommit = vi.fn();
        render(<Harness onCommit={onCommit} />);

        await userEvent.type(screen.getByRole('searchbox'), '  amina  ');

        await waitFor(() => expect(onCommit).toHaveBeenCalledWith('amina'));
    });

    it('reports an empty term rather than swallowing it', async () => {
        // Clearing has to mean "send no parameter" — `?search=` with no value is a
        // 400. Reporting `''` honestly is what lets the query builder drop it.
        const onCommit = vi.fn();
        render(<Harness onCommit={onCommit} initial="amina" />);

        await userEvent.clear(screen.getByRole('searchbox'));

        await waitFor(() => expect(onCommit).toHaveBeenCalledWith(''));
    });

    it('clears immediately from the clear button, without waiting out the debounce', async () => {
        const onCommit = vi.fn();
        render(<Harness onCommit={onCommit} initial="amina" />);

        await userEvent.click(screen.getByRole('button', { name: /clear search users/i }));

        expect(onCommit).toHaveBeenCalledWith('');
        expect(screen.getByRole('searchbox')).toHaveValue('');
    });
});

describe('staying out of the way', () => {
    it('does not lose characters typed while its own commit round-trips', async () => {
        // The committed value comes straight back down as a prop. Adopting that
        // echo would overwrite anything typed during the trip — and someone who
        // resumes after the 300 ms pause is exactly the person doing that.
        render(<Harness />);
        const box = screen.getByRole('searchbox');

        await userEvent.type(box, 'ami');
        await waitFor(() => expect(screen.getByTestId('committed')).toHaveTextContent('ami'));

        await userEvent.type(box, 'na');
        expect(box).toHaveValue('amina');

        await waitFor(() => expect(screen.getByTestId('committed')).toHaveTextContent('amina'));
    });

    it('adopts a value changed from outside', async () => {
        // "Clear filters", a back navigation, a pasted link — none of which this
        // component emitted, so all of them must land in the box.
        render(<Harness initial="amina" />);
        expect(screen.getByRole('searchbox')).toHaveValue('amina');

        await userEvent.click(screen.getByRole('button', { name: 'clear externally' }));

        await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
    });

    it('bounds the input at the length the service accepts', () => {
        render(<Harness />);

        // `?search=` is trimmed 1–120; anything longer is a 400.
        expect(screen.getByRole('searchbox')).toHaveAttribute('maxlength', '120');
    });
});
