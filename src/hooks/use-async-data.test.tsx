import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useAsyncData } from '@/hooks/use-async-data';

function Probe({
    cacheKey,
    fetcher,
}: {
    cacheKey: string;
    fetcher: (signal: AbortSignal) => Promise<string>;
}) {
    const query = useAsyncData(cacheKey, fetcher);

    return (
        <div>
            <span data-testid="data">{query.data ?? '—'}</span>
            <span data-testid="loading">{String(query.isLoading)}</span>
            <span data-testid="refreshing">{String(query.isRefreshing)}</span>
            <span data-testid="error">
                {query.error instanceof Error ? query.error.message : ''}
            </span>
            <button onClick={query.reload}>reload</button>
        </div>
    );
}

/** Lets a test change the key, and re-render without changing it. */
function Host({
    initialKey,
    fetcher,
}: {
    initialKey: string;
    fetcher: (signal: AbortSignal) => Promise<string>;
}) {
    const [cacheKey, setCacheKey] = useState(initialKey);
    const [, setTick] = useState(0);

    return (
        <div>
            <button onClick={() => setCacheKey((current) => `${current}!`)}>change key</button>
            <button onClick={() => setTick((current) => current + 1)}>re-render</button>
            {/*
              Inline and unstable on purpose — a new function identity on every
              render is exactly what the keyed design has to tolerate.
            */}
            <Probe cacheKey={cacheKey} fetcher={(signal) => fetcher(signal)} />
        </div>
    );
}

describe('useAsyncData', () => {
    it('reads once on mount and settles', async () => {
        const read = vi.fn().mockResolvedValue('first');
        render(<Host initialKey="k" fetcher={read} />);

        expect(screen.getByTestId('loading')).toHaveTextContent('true');
        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
        expect(read).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    /**
     * The regression test this hook's design exists for.
     *
     * With the fetcher in the dependency array, an inline arrow re-runs the
     * effect on every render — and because each run aborts the previous request
     * before it can resolve, the tile never leaves its skeleton while hammering
     * the backend. Keying on a string makes that unreachable.
     */
    it('does not re-read when an unstable fetcher changes identity', async () => {
        const read = vi.fn().mockResolvedValue('first');
        const user = userEvent.setup();
        render(<Host initialKey="k" fetcher={read} />);

        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));

        await user.click(screen.getByRole('button', { name: 're-render' }));
        await user.click(screen.getByRole('button', { name: 're-render' }));
        await user.click(screen.getByRole('button', { name: 're-render' }));

        expect(read).toHaveBeenCalledTimes(1);
    });

    it('re-reads when the key changes, keeping the previous value on screen', async () => {
        // The second read is held open, because the state under test is the one
        // *between* the two answers. A pre-resolved mock settles inside the click
        // and there is nothing to observe.
        let releaseSecond: (value: string) => void = () => {};
        const read = vi
            .fn()
            .mockResolvedValueOnce('first')
            .mockImplementationOnce(
                () =>
                    new Promise<string>((resolve) => {
                        releaseSecond = resolve;
                    }),
            );

        const user = userEvent.setup();
        render(<Host initialKey="k" fetcher={read} />);

        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
        await user.click(screen.getByRole('button', { name: 'change key' }));

        // A refresh must not blank the tile — that is what separates the two flags.
        expect(screen.getByTestId('data')).toHaveTextContent('first');
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('refreshing')).toHaveTextContent('true');

        releaseSecond('second');
        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('re-reads on reload()', async () => {
        const read = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
        const user = userEvent.setup();
        render(<Host initialKey="k" fetcher={read} />);

        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
        await user.click(screen.getByRole('button', { name: 'reload' }));

        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('exposes the failure and no data when the first read fails', async () => {
        const read = vi.fn().mockRejectedValue(new Error('boom'));
        render(<Host initialKey="k" fetcher={read} />);

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('boom'));
        expect(screen.getByTestId('data')).toHaveTextContent('—');
    });

    /**
     * The state `DataState` cannot express, and the reason `TileCard` exists: a
     * tile that had a number and then failed to refresh keeps the number *and*
     * reports the failure. Blanking sixteen tiles on a two-second blip is what
     * the tab-focus refetch would otherwise do.
     */
    it('keeps the last good value when a refresh fails', async () => {
        const read = vi
            .fn()
            .mockResolvedValueOnce('first')
            .mockRejectedValueOnce(new Error('offline'));
        const user = userEvent.setup();
        render(<Host initialKey="k" fetcher={read} />);

        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
        await user.click(screen.getByRole('button', { name: 'change key' }));

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('offline'));
        expect(screen.getByTestId('data')).toHaveTextContent('first');
    });

    it('clears a stale failure while the retry is in flight', async () => {
        const read = vi
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('recovered');
        const user = userEvent.setup();
        render(<Host initialKey="k" fetcher={read} />);

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('boom'));
        await user.click(screen.getByRole('button', { name: 'reload' }));

        // No error panel sitting under a spinner.
        expect(screen.getByTestId('error')).toHaveTextContent('');
        await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('recovered'));
    });

    it('aborts the request in flight when it unmounts', async () => {
        let seen: AbortSignal | undefined;
        const read = vi.fn().mockImplementation(
            (signal: AbortSignal) =>
                new Promise<string>((resolve) => {
                    seen = signal;
                    setTimeout(() => resolve('late'), 50);
                }),
        );

        const { unmount } = render(<Host initialKey="k" fetcher={read} />);
        await waitFor(() => expect(seen).toBeDefined());

        unmount();
        expect(seen?.aborted).toBe(true);
    });
});
