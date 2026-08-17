import { Link } from 'react-router-dom';
import { ArrowUpRight, Construction } from 'lucide-react';

import { isNavItemPermitted, NAV_ITEMS } from '@/config/navigation';
import { usePermissions } from '@/store';

/**
 * Every module this administrator may open, as links.
 *
 * Kept from the placeholder overview it replaced, because it is still the only
 * place an operator can see **what is not built yet** and which phase owns it.
 * The tiles above answer "what needs attention"; this answers "what is there".
 *
 * Filtered with the same predicate the sidebar uses, for the same reason: this
 * is the largest set of links in the app, and leaving it unfiltered while the
 * sidebar and the route guards are gated would give a Support administrator a
 * grid of buttons that each land on a refusal.
 */
export function ModuleGrid() {
    const { held } = usePermissions();
    const modules = held ? NAV_ITEMS.filter((item) => isNavItemPermitted(item, held)) : [];

    const built = modules.filter((item) => item.implemented);
    const pending = modules.filter((item) => !item.implemented);

    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...built, ...pending].map((item) => (
                <Link
                    key={item.id}
                    to={item.path}
                    className="group border-border hover:border-primary/40 hover:bg-accent/40 flex items-start gap-3 rounded-lg border p-4 transition-colors"
                >
                    <div className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                        <item.icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{item.label}</p>
                            <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        {item.implemented ? (
                            <p className="text-muted-foreground text-xs">Available</p>
                        ) : (
                            <p className="text-muted-foreground flex items-center gap-1 text-xs">
                                <Construction className="size-3" />
                                Phase {item.phase}
                            </p>
                        )}
                    </div>
                </Link>
            ))}
        </div>
    );
}
