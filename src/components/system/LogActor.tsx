import { UserRound } from 'lucide-react';

import { logActorLabel, type LogEntryView } from '@/lib/log-entry';

/**
 * Who wrote a log line, on the row — and a one-click narrowing to that person.
 *
 * It filters on `actorId` (the USER id) rather than the profile id: the service matches the
 * filter against both, and the user id is the one every line carries, including lines written
 * before the profile id was stamped. Nothing renders for a line no actor wrote.
 *
 * Already filtered to this actor → a plain label, because a button that changes nothing is noise.
 */
export function LogActor({
    entry,
    active,
    onFilter,
}: {
    entry: LogEntryView;
    /** The `actorId` filter currently applied, or `''`. */
    active: string;
    onFilter: (actorId: string) => void;
}) {
    const label = logActorLabel(entry);
    if (!label) return null;

    const id = entry.actorId;
    const alreadyFiltered =
        active !== '' && (active === id || active === entry.actorProfileId);

    if (!id || alreadyFiltered) {
        return (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <UserRound className="size-3.5" aria-hidden />
                {label}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={() => onFilter(id)}
            title="Show only this person's lines"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-xs hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
            <UserRound className="size-3.5" aria-hidden />
            {label}
            <span className="sr-only">— show only this person's lines</span>
        </button>
    );
}
