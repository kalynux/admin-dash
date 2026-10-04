import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { useCan } from '@/store';
import type { ProductCategoryRef } from '@/types/categories.types';
import { cn } from '@/lib/utils';

/**
 * A product's shared-list categories, as chips — **the first is the primary**
 * and is drawn as such. Each links to the category when the caller can read the
 * list; Support can, so in practice everyone sees links.
 *
 * `[]` is real (the only category was retired since) and renders as `empty`.
 */
export function CategoryChips({
    categories,
    empty = 'No category',
    className,
}: {
    categories: readonly ProductCategoryRef[];
    empty?: string;
    className?: string;
}) {
    const can = useCan();
    const linked = can('catalog.categories.read');

    if (categories.length === 0) {
        return <span className={cn('text-muted-foreground text-xs', className)}>{empty}</span>;
    }

    return (
        <ul className={cn('flex flex-wrap gap-1', className)} aria-label="Categories">
            {categories.map((category, index) => {
                const chip = (
                    <Badge
                        variant={index === 0 ? 'default' : 'secondary'}
                        className="font-normal"
                        title={index === 0 ? 'Primary category' : undefined}
                    >
                        {category.name}
                    </Badge>
                );
                return (
                    <li key={category.id}>
                        {linked ? (
                            <Link to={`/dashboard/categories/${category.id}`} className="hover:opacity-80">
                                {chip}
                            </Link>
                        ) : (
                            chip
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
