import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { permittedChildren, permittedSections } from '@/config/navigation';
import type { HeldPermissions } from '@/lib/authorization';

interface CommandPaletteProps {
    /** What the caller holds. Required, and a prop — see `Sidebar`. */
    permissions: HeldPermissions;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** One row in the palette: where it goes, and everything it can be found by. */
interface Destination {
    id: string;
    label: string;
    path: string;
    section: string;
    /** The module a child belongs to, so "orders" finds "Disputes". */
    parent?: string;
    implemented: boolean;
}

/**
 * Jump anywhere, from the keyboard, without reading the sidebar.
 *
 * ── Why an operations console earns one ───────────────────────────────────────
 * Eighteen modules, sixty-odd destinations, and a sidebar that force-collapses
 * to an icon rail below 1024px. Somebody who works here all day knows the name
 * of the screen they want and should not have to find it in a tree, expand its
 * group, and click — three interactions and a change of focus for something they
 * could have typed in four letters.
 *
 * ── It shows exactly what the sidebar shows ───────────────────────────────────
 * Built from `permittedSections` and `permittedChildren`, the same two functions
 * the sidebar filters on. **Not a second list.** A palette with its own idea of
 * what exists is a palette that eventually offers a destination the operator
 * cannot open, and "what is visible is reachable" stops being true the moment
 * two lookups can disagree.
 *
 * Unbuilt entries stay in, marked, for the reason the sidebar keeps them: the
 * shape of the console is a fact worth knowing, and silently omitting them
 * leaves nobody sure what is missing.
 *
 * ── Searching ─────────────────────────────────────────────────────────────────
 * `cmdk` matches on each item's `value`, so the value carries the label, the
 * section and the parent module rather than just the label — typing "money"
 * should surface Payouts, and typing "orders" should surface Disputes, neither
 * of which contains the word.
 */
export function CommandPalette({ permissions, open, onOpenChange }: CommandPaletteProps) {
    const navigate = useNavigate();

    const groups = useMemo(
        () =>
            permittedSections(permissions).map((section) => ({
                id: section.id,
                label: section.label,
                destinations: section.items.flatMap<Destination>((item) => {
                    const children = permittedChildren(item, permissions);

                    // A container with children has no screen of its own — its
                    // path redirects to the first child the caller may open — so
                    // listing it as well would put two rows in the palette that
                    // land on the same place.
                    const own: Destination[] =
                        children.some((child) => child.index) || children.length === 0
                            ? [
                                  {
                                      id: item.id,
                                      label: item.label,
                                      path: item.path,
                                      section: section.label,
                                      implemented: item.implemented,
                                  },
                              ]
                            : [];

                    return [
                        ...own,
                        ...children
                            // The index child *is* the module row above it.
                            .filter((child) => !child.index)
                            .map((child) => ({
                                id: child.id,
                                label: child.label,
                                path: child.path,
                                section: section.label,
                                parent: item.label,
                                implemented: child.implemented,
                            })),
                    ];
                }),
            })),
        [permissions],
    );

    function go(path: string) {
        onOpenChange(false);
        navigate(path);
    }

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Go to"
            description="Search every screen you can open."
            className="top-[20%] translate-y-0"
        >
            <CommandInput placeholder="Go to…" />
            <CommandList className="max-h-[60vh]">
                <CommandEmpty>Nothing matches that.</CommandEmpty>

                {groups.map((group) => (
                    <CommandGroup key={group.id} heading={group.label}>
                        {group.destinations.map((destination) => (
                            <CommandItem
                                key={destination.id}
                                value={`${destination.label} ${destination.parent ?? ''} ${destination.section}`}
                                onSelect={() => go(destination.path)}
                            >
                                <span className={destination.implemented ? undefined : 'opacity-55'}>
                                    {destination.parent ? (
                                        <span className="text-muted-foreground">
                                            {destination.parent} ·{' '}
                                        </span>
                                    ) : null}
                                    {destination.label}
                                </span>
                                {!destination.implemented && (
                                    <span className="text-muted-foreground ml-auto text-xs">
                                        Not built yet
                                    </span>
                                )}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ))}
            </CommandList>
        </CommandDialog>
    );
}

/**
 * `⌘K` / `Ctrl+K`, wired to a piece of state the shell owns.
 *
 * A component rather than a hook because `react-refresh/only-export-components`
 * keeps this module to components only, and the listener has nowhere else to
 * live that is not a third file. It renders nothing.
 *
 * `preventDefault` on the match: on Firefox `Ctrl+K` focuses the address bar,
 * and on Safari `⌘K` does too. Both would otherwise leave the palette open
 * behind a focused URL field.
 */
export function CommandPaletteHotkey({ onOpen }: { onOpen: () => void }) {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key.toLowerCase() !== 'k') return;
            if (!event.metaKey && !event.ctrlKey) return;
            event.preventDefault();
            onOpen();
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onOpen]);

    return null;
}
