import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { tStatic } from '@/i18n/runtime';
import { resolveErrorMessage } from '@/lib/errors';

interface Props {
    children: ReactNode;
    /** Rendered instead of the default panel. Receives the error and a reset. */
    fallback?: (error: Error, reset: () => void) => ReactNode;
    /** Changing this resets the boundary — pass the route key to clear on navigation. */
    resetKey?: unknown;
}

interface State {
    error: Error | null;
}

/**
 * Catches render-time faults so one broken screen does not blank the dashboard.
 *
 * This is for *bugs* — a component that threw. Failed requests are not errors in
 * this sense and should be handled by the screen that made them, with
 * `<DataState>`, so the shell and navigation stay usable.
 */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidUpdate(previous: Props) {
        if (this.state.error && previous.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ui] render failed', error, info.componentStack);
    }

    private reset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        if (this.props.fallback) return this.props.fallback(error, this.reset);

        return (
            <div className="flex min-h-[50vh] items-center justify-center p-6">
                <div className="max-w-md space-y-4 text-center">
                    <div className="bg-destructive/10 text-destructive mx-auto flex size-12 items-center justify-center rounded-full">
                        <AlertOctagon className="size-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="text-lg font-semibold">
                            {tStatic('errors.state.renderFailed')}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            {resolveErrorMessage(error)}
                        </p>
                    </div>
                    <Button variant="outline" onClick={this.reset}>
                        <RotateCw className="size-4" />
                        {tStatic('errors.state.retry')}
                    </Button>
                </div>
            </div>
        );
    }
}
