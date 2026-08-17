import { Link } from 'react-router-dom';
import { Ban, RotateCw } from 'lucide-react';

import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/store';
import type { PermissionMode } from '@/types/permissions.types';

interface ForbiddenProps {
    /** The permission names the route wanted. */
    required?: readonly string[];
    mode?: PermissionMode;
    /** What was being reached, for the sentence. Falls back to "this screen". */
    subject?: string;
}

/**
 * The 403 screen.
 *
 * **Rendered in place, never redirected to.** A bookmarked or shared deep link
 * keeps its URL, so the administrator can see what they aimed at and pass it to
 * someone who can open it — a redirect to the dashboard would lose that and read
 * as a bug. It renders inside the shell for the same reason the error boundary
 * does: navigation survives, so this is a wall to step away from rather than a
 * dead end.
 *
 * **The copy names the rule, not the reader.** `permissions.md` is explicit that
 * a refusal names the rule and never the caller's standing — "administrators at
 * or above your own level", not "you are tier 2". "Your level does not include
 * this" reads as a rebuke and tells them nothing they can act on; the permission
 * name is public vocabulary and is the thing they can quote to whoever grants it.
 */
export function Forbidden({ required = [], mode = 'any', subject }: ForbiddenProps) {
    const { reload, status } = usePermissions();

    const requirement =
        required.length === 0
            ? undefined
            : required.length === 1
              ? `${subject ?? 'This screen'} needs the permission below.`
              : `${subject ?? 'This screen'} needs ${mode === 'all' ? 'all' : 'any'} of the permissions below.`;

    return (
        <PageContainer title={subject ?? 'Not available to you'}>
            <EmptyState
                icon={Ban}
                title="Not available to you"
                description={
                    requirement ??
                    `${subject ?? 'This screen'} is not part of what this account may reach.`
                }
                action={
                    <div className="flex flex-col items-center gap-4">
                        {required.length > 0 ? (
                            <div className="flex flex-wrap justify-center gap-1.5">
                                {required.map((name) => (
                                    <Badge
                                        key={name}
                                        variant="outline"
                                        className="font-mono text-[11px]"
                                    >
                                        {name}
                                    </Badge>
                                ))}
                            </div>
                        ) : null}

                        <div className="flex flex-wrap justify-center gap-2">
                            <Button asChild size="sm" variant="outline">
                                <Link to="/dashboard">Back to dashboard</Link>
                            </Button>
                            {/*
                              The manual version of noticing a promotion. The level
                              is re-resolved server-side on every request, so an
                              administrator whose access changed a moment ago is one
                              re-read away from the screen appearing — and this is
                              exactly where they land when it has not.
                            */}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void reload()}
                                disabled={status === 'loading'}
                            >
                                <RotateCw className="size-4" />
                                Re-check my access
                            </Button>
                        </div>
                    </div>
                }
            />
        </PageContainer>
    );
}
