import { useContext } from 'react';

import { ERROR_JOURNAL_PERMISSION } from '@/config/navigation';
import { satisfies } from '@/lib/authorization';
import { PermissionsContext } from '@/store/permissions-context';

/**
 * Whether this operator could open the error journal on a reference.
 *
 * Reads the context **directly rather than through `usePermissions()`**, which
 * throws outside `PermissionsProvider`. `ErrorState` renders in 90 places and the
 * provider is mounted inside `RequireAuth`, so a throwing hook there would turn
 * an error panel into a blank screen on any surface outside it. No provider
 * means no answer, which is correctly "do not offer the link".
 *
 * The requirement is the **same object the sidebar filtered on**, in the same
 * `any` mode: `GET /system/errors` is the service's one `any`-mode guard, and
 * two lookups can disagree where one object cannot.
 */
export function useCanLookUpErrors(): boolean {
    const permissions = useContext(PermissionsContext);
    const held = permissions?.held;
    return held ? satisfies(held, ERROR_JOURNAL_PERMISSION, 'any') : false;
}
