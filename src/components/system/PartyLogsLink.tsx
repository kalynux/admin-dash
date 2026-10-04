import { ScrollText } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Can } from '@/components/auth/Can';
import { Button } from '@/components/ui/button';
import { platformLogsPathFor } from '@/lib/log-entry';

/**
 * "View logs" on a party's page — Platform logs, already narrowed to this person.
 *
 * Replaces the manual step of copying an id off this page and pasting it into the logs filter.
 *
 * ⚠ Pass the **user id**, not the profile id. The service matches its `actorId` filter against
 * both, but only the user id is on every line — lines written before the platform began stamping
 * the profile id (2026-10-04) carry the user id alone.
 *
 * Gated on `developer_tools.logs.read`, the same permission the logs screen sits behind, so the
 * link never leads to a page that refuses. Tier 1 only: log lines are free text and carry
 * personal data.
 */
export function PartyLogsLink({ userId }: { userId: string | null | undefined }) {
    if (!userId) return null;
    return (
        <Can permission="developer_tools.logs.read">
            <Button variant="outline" size="sm" asChild>
                <Link to={platformLogsPathFor(userId)}>
                    <ScrollText className="size-4" />
                    View logs
                </Link>
            </Button>
        </Can>
    );
}
