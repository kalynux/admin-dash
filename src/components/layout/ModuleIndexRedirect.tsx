import { Navigate } from 'react-router-dom';

import { PageLoader } from '@/components/common/Loading';
import { entryRequirement, firstPermittedChild, type NavItem } from '@/config/navigation';
import { Forbidden } from '@/pages/Forbidden';
import { usePermissions } from '@/store';

/**
 * Where `/dashboard/<module>` lands when the module has no screen of its own.
 *
 * Money, System and Developer tools are containers: there is no `GET /money`, no
 * `GET /system` and no `GET /dev-tools`, only the sub-reads. The landing screen
 * is therefore **whichever child this administrator may actually open**, computed
 * from the held set rather than fixed at "the first one declared" — Support holds
 * `money.payments.read` and nothing else under Money, so a fixed redirect would
 * send them to Earnings and refuse.
 *
 * Modules that *do* have a landing screen declare an index child instead and
 * never render this.
 */
export function ModuleIndexRedirect({ item }: { item: NavItem }) {
    const { status, held } = usePermissions();

    // Waiting is not refusing. `RequirePermission` makes the same distinction for
    // the same reason: redirecting on an unknown set would bounce an administrator
    // off a module they hold, and the bounce is not undone when the set arrives.
    if (status !== 'ready' || !held) return <PageLoader label="Checking your access…" />;

    const target = firstPermittedChild(item, held);

    if (!target) {
        /**
         * Unreachable through the router: this element sits inside the module's
         * own gate, which passes only when some child admits the caller.
         *
         * Kept anyway, and kept as a refusal rather than a redirect or a blank
         * screen, so that a future config change breaking that invariant surfaces
         * as something an operator can read and report.
         */
        const { permission, mode } = entryRequirement(item);
        return <Forbidden required={permission} mode={mode} subject={item.label} />;
    }

    return <Navigate to={target.path} replace />;
}
