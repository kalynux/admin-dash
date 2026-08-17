/**
 * The panel every screen shows when its request failed.
 *
 * Used in 90 places, so the decisions it makes are the dashboard's default
 * answer to "what happened": whether this reads as a fault or a denial, whether
 * retrying is offered, and whether the operator is handed a way to look the
 * failure up.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataState, ErrorState } from '@/components/common/DataState';
import { loadCatalog } from '@/i18n/catalogs';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';
import { ApiError, NetworkError } from '@/types/api.types';
import en from '@/i18n/locales/en/errors';
import fr from '@/i18n/locales/fr/errors';

const apiError = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
    new ApiError({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong',
        category: 'internal',
        ...init,
    });

describe('how a failure reads', () => {
    it('renders a scoped 404 as a denial, not a fault', () => {
        // 404 is the denial for out-of-scope records — a 403 on an id would
        // confirm the id exists — so this must read calmly.
        renderWithProviders(
            <ErrorState error={apiError({ status: 404, code: 'NOT_FOUND', category: 'not_found' })} />,
        );

        expect(screen.getByText(en.state.denied)).toBeInTheDocument();
        expect(screen.queryByText(en.state.loadFailed)).not.toBeInTheDocument();
    });

    it('renders a real fault as one', () => {
        renderWithProviders(<ErrorState error={apiError({})} />);
        expect(screen.getByText(en.state.loadFailed)).toBeInTheDocument();
    });

    it('offers retry only where retrying could work', async () => {
        const onRetry = vi.fn();
        const { unmount } = renderWithProviders(
            <ErrorState error={new NetworkError('offline')} onRetry={onRetry} />,
        );

        await userEvent.click(screen.getByRole('button', { name: en.state.retry }));
        expect(onRetry).toHaveBeenCalled();
        unmount();

        renderWithProviders(
            <ErrorState
                error={apiError({ status: 403, code: 'AUTHZ_PERMISSION_DENIED', category: 'authorization' })}
                onRetry={onRetry}
            />,
        );
        expect(screen.queryByRole('button', { name: en.state.retry })).not.toBeInTheDocument();
    });
});

describe('the escalation cases', () => {
    it('shows the support hint where the operator can do nothing else', () => {
        // On `internal` the message is a registry default and `details` was
        // dropped, so the category hint is the only guidance there is.
        renderWithProviders(<ErrorState error={apiError({ category: 'internal' })} />);
        expect(screen.getByText(en.categoryHint.internal)).toBeInTheDocument();
    });

    it('shows no hint where the failure explains itself', () => {
        renderWithProviders(
            <ErrorState
                error={apiError({ status: 409, code: 'PAYOUT_NOT_PENDING', category: 'conflict' })}
            />,
        );
        expect(screen.queryByText(en.categoryHint.conflict)).not.toBeInTheDocument();
    });
});

describe('the error-journal lookup', () => {
    const withReference = apiError({ status: 503, category: 'external_service', requestId: 'req-77a1' });

    it('offers the lookup to an operator who holds one of the three permissions', () => {
        renderWithProviders(<ErrorState error={withReference} />, {
            permissions: { held: heldFixture(1) },
        });

        const link = screen.getByRole('link', { name: en.state.lookUp });
        // `requestId` is what the journal is indexed by — the link is only
        // useful if it carries it.
        expect(link).toHaveAttribute(
            'href',
            '/dashboard/system/errors?requestId=req-77a1',
        );
    });

    it('offers it to Support too — the journal is the one any-mode guard', () => {
        // Tier 3 holds `support.errors.lookup` and nothing else here, which is
        // the whole reason Support sees a System entry at all.
        renderWithProviders(<ErrorState error={withReference} />, {
            permissions: { held: heldFixture(3) },
        });

        expect(screen.getByRole('link', { name: en.state.lookUp })).toBeInTheDocument();
    });

    it('withholds it from an operator who holds none of them', () => {
        renderWithProviders(<ErrorState error={withReference} />, {
            permissions: { held: new Set(['users.read']) },
        });

        expect(screen.queryByRole('link', { name: en.state.lookUp })).not.toBeInTheDocument();
    });

    it('withholds it when there is no permissions provider at all', () => {
        // This panel renders in 90 places and the provider is mounted inside
        // `RequireAuth`. Reading the context defensively is what stops a
        // pre-auth failure turning into a blank screen; no provider means no
        // answer, which is correctly "do not offer the link".
        renderWithProviders(<ErrorState error={withReference} />, {
            permissions: { held: null },
        });

        expect(screen.queryByRole('link', { name: en.state.lookUp })).not.toBeInTheDocument();
    });

    it('withholds it on a failure the operator caused', () => {
        // A validation error is theirs to fix and carries no journal-worthy
        // reference; offering a lookup would send them somewhere useless.
        renderWithProviders(
            <ErrorState
                error={apiError({
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    requestId: 'req-77a1',
                })}
            />,
        );

        expect(screen.queryByRole('link', { name: en.state.lookUp })).not.toBeInTheDocument();
    });
});

describe('DataState ordering', () => {
    it('reports a failure ahead of an empty list', () => {
        // A failed request that also has no rows is a failure. Saying "no
        // results" would be a lie about data nobody managed to read.
        renderWithProviders(
            <DataState isLoading={false} error={apiError({})} isEmpty loading={<p>loading</p>}>
                <p>content</p>
            </DataState>,
        );

        expect(screen.getByText(en.state.loadFailed)).toBeInTheDocument();
        expect(screen.queryByText(en.state.empty)).not.toBeInTheDocument();
    });

    it('prefers a failure to a loading state, so a retry is not hidden by a refetch', () => {
        renderWithProviders(
            <DataState isLoading error={apiError({})} loading={<p>loading</p>}>
                <p>content</p>
            </DataState>,
        );

        expect(screen.getByText(en.state.loadFailed)).toBeInTheDocument();
        expect(screen.queryByText('loading')).not.toBeInTheDocument();
    });
});

describe('in French', () => {
    /*
      French is a dynamic import, so the very first render after a switch shows
      English until the chunk lands — deliberate, and why the provider exposes
      `isLoading`. Awaiting the load here puts it in the module-level cache, so
      these assertions measure the catalog rather than the download.
    */
    beforeAll(async () => {
        await loadCatalog('fr');
    });

    it('renders the whole panel from the catalog, not from the server', () => {
        // The end-to-end proof of the phase: wi-admin sent an English sentence
        // and none of it reaches the screen.
        renderWithProviders(
            <ErrorState
                error={apiError({
                    status: 403,
                    code: 'AUTHZ_SELF_ACTION_FORBIDDEN',
                    category: 'authorization',
                    message: 'Self action is forbidden',
                })}
            />,
            { locale: 'fr' },
        );

        expect(screen.getByText(fr.codes.AUTHZ_SELF_ACTION_FORBIDDEN)).toBeInTheDocument();
        expect(screen.getByText(fr.state.denied)).toBeInTheDocument();
        expect(screen.queryByText('Self action is forbidden')).not.toBeInTheDocument();
    });

    it('translates a delegated refusal through its platform code', () => {
        renderWithProviders(
            <ErrorState
                error={apiError({
                    status: 409,
                    code: 'PLATFORM_OPERATION_REJECTED',
                    category: 'conflict',
                    message: 'Shipment status has moved since you loaded it',
                    details: { platformCode: 'SHIPMENT_STATUS_CONFLICT' },
                })}
            />,
            { locale: 'fr' },
        );

        expect(screen.getByText(fr.platform.SHIPMENT_STATUS_CONFLICT)).toBeInTheDocument();
    });
});
