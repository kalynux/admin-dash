import { useContext, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, Inbox, RotateCw, SearchX, Telescope, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ERROR_JOURNAL_PERMISSION, ERROR_JOURNAL_PATH } from '@/config/navigation';
import { tStatic } from '@/i18n/runtime';
import { satisfies } from '@/lib/authorization';
import {
    isAccessDenial,
    isEscalation,
    isRetryable,
    resolveCategoryHint,
    resolveErrorDetail,
    resolveErrorMessage,
} from '@/lib/errors';
import { PermissionsContext } from '@/store/permissions-context';
import { ApiError, NetworkError } from '@/types/api.types';

interface ErrorStateProps {
    error: unknown;
    onRetry?: () => void;
    /** Shown when the failure is an authorization/scope denial. */
    deniedTitle?: string;
}

/** Returns an element, not a component type — the icon varies per error. */
function iconFor(error: unknown) {
    if (error instanceof NetworkError) return <WifiOff />;
    if (error instanceof ApiError) {
        if (error.category === 'authorization') return <Ban />;
        if (error.category === 'not_found') return <SearchX />;
    }
    return <AlertTriangle />;
}

/**
 * Whether this operator could open the error journal on a reference.
 *
 * Reads the context **directly rather than through `usePermissions()`**, which
 * throws outside `PermissionsProvider`. This panel renders in 90 places and the
 * provider is mounted inside `RequireAuth`, so a throwing hook here would turn
 * an error panel into a blank screen on any surface outside it. No provider
 * means no answer, which is correctly "do not offer the link".
 *
 * The requirement is the **same object the sidebar filtered on**, in the same
 * `any` mode: `GET /system/errors` is the service's one `any`-mode guard, and
 * two lookups can disagree where one object cannot.
 */
function useCanLookUpErrors(): boolean {
    const permissions = useContext(PermissionsContext);
    const held = permissions?.held;
    return held ? satisfies(held, ERROR_JOURNAL_PERMISSION, 'any') : false;
}

/**
 * The panel a screen shows when its request failed.
 *
 * Behaviours that come straight from the contract:
 *
 * - **A scoped `404` is not a bug.** `404` is the denial for out-of-scope
 *   records — a `403` on an id would confirm the id exists — so it renders as a
 *   calm "not available to you", not as a fault.
 * - **Retry is offered only where retrying could work.** An authorization
 *   refusal never becomes a success on retry; a `502` often does.
 * - **On `internal` and `external_service` the operator can do nothing.** There
 *   the message is a registry default and `details` was dropped, so the
 *   per-category support hint is the only guidance there is, and the reference
 *   is the only handle — `GET /system/errors` is keyed on exactly it. Offering
 *   the lookup is what turns "something went wrong" into an answer.
 */
export function ErrorState({ error, onRetry, deniedTitle }: ErrorStateProps) {
    const icon = iconFor(error);
    const denied = isAccessDenial(error);
    const canRetry = Boolean(onRetry) && isRetryable(error);
    const detail = resolveErrorDetail(error);

    const escalation = isEscalation(error);
    const hint = escalation ? resolveCategoryHint(error) : undefined;
    const requestId = escalation && error instanceof ApiError ? error.requestId : undefined;
    const canLookUp = useCanLookUpErrors();

    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">{icon}</EmptyMedia>
                <EmptyTitle>
                    {denied
                        ? (deniedTitle ?? tStatic('errors.state.denied'))
                        : tStatic('errors.state.loadFailed')}
                </EmptyTitle>
                <EmptyDescription>{resolveErrorMessage(error)}</EmptyDescription>
            </EmptyHeader>
            {(detail || hint || canRetry || (requestId && canLookUp)) && (
                <EmptyContent>
                    {detail ? (
                        <p className="text-muted-foreground max-w-md text-xs break-words">{detail}</p>
                    ) : null}
                    {hint ? (
                        <p className="text-muted-foreground max-w-md text-xs break-words">{hint}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        {canRetry ? (
                            <Button variant="outline" size="sm" onClick={onRetry}>
                                <RotateCw className="size-4" />
                                {tStatic('errors.state.retry')}
                            </Button>
                        ) : null}
                        {requestId && canLookUp ? (
                            <Button variant="ghost" size="sm" asChild>
                                <Link
                                    to={`${ERROR_JOURNAL_PATH}?requestId=${encodeURIComponent(requestId)}`}
                                >
                                    <Telescope className="size-4" />
                                    {tStatic('errors.state.lookUp')}
                                </Link>
                            </Button>
                        ) : null}
                    </div>
                </EmptyContent>
            )}
        </Empty>
    );
}

interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: typeof Inbox;
    action?: ReactNode;
}

/** Nothing to show, and nothing went wrong. */
export function EmptyState({ title, description, icon: Icon = Inbox, action }: EmptyStateProps) {
    return (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? <EmptyDescription>{description}</EmptyDescription> : null}
            </EmptyHeader>
            {action ? <EmptyContent>{action}</EmptyContent> : null}
        </Empty>
    );
}

interface DataStateProps {
    isLoading: boolean;
    error?: unknown;
    isEmpty?: boolean;
    onRetry?: () => void;
    /** What to render while loading. A shaped skeleton beats a spinner. */
    loading?: ReactNode;
    empty?: ReactNode;
    children: ReactNode;
}

/**
 * The loading / error / empty / content decision, in one place.
 *
 * Every list and detail screen makes the same four-way choice, and making each
 * one re-derive the order is how a screen ends up rendering an empty table over
 * a failed request.
 */
export function DataState({
    isLoading,
    error,
    isEmpty,
    onRetry,
    loading,
    empty,
    children,
}: DataStateProps) {
    // Error first: a failed request that also has no rows is a failure, not an
    // empty list, and saying "no results" would be a lie.
    if (error) return <ErrorState error={error} onRetry={onRetry} />;
    if (isLoading) return <>{loading}</>;
    if (isEmpty) return <>{empty ?? <EmptyState title={tStatic('errors.state.empty')} />}</>;
    return <>{children}</>;
}
