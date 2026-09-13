import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { RequireAnonymous, RequireAuth, RequireScopedSession } from '@/components/auth/guards';
import { RequirePermission } from '@/components/auth/RequirePermission';
import { AccountArea } from '@/components/layout/AccountArea';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { ModuleIndexRedirect } from '@/components/layout/ModuleIndexRedirect';
import { Toaster } from '@/components/ui/sonner';
import { entryRequirement, NAV_ITEMS, type NavEntry } from '@/config/navigation';
import { notify } from '@/lib/notify';
import { onSessionEnded } from '@/lib/session-events';
import { AccountSecurity } from '@/pages/AccountSecurity';
import { MfaSetup } from '@/pages/MfaSetup';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { MyAccess } from '@/pages/MyAccess';
import { NotFound } from '@/pages/NotFound';
import { NotificationPreferences } from '@/pages/NotificationPreferences';
import { Overview } from '@/pages/Overview';
import { SignIn } from '@/pages/SignIn';
import { NotificationSources } from '@/pages/notifications/NotificationSources';
import { NotificationsModule } from '@/pages/notifications/NotificationsModule';
import { AdministratorsModule } from '@/pages/administrators/AdministratorsModule';
import { AutomationFailures } from '@/pages/automation/AutomationFailures';
import { AutomationSummary } from '@/pages/automation/AutomationSummary';
import { ApprovalsModule } from '@/pages/approvals/ApprovalsModule';
import { AuditExportsModule } from '@/pages/audit/AuditExportsModule';
import { AuditModule } from '@/pages/audit/AuditModule';
import { UsersModule } from '@/pages/users/UsersModule';
import { VendorsModule } from '@/pages/vendors/VendorsModule';
import { AgenciesModule } from '@/pages/agencies/AgenciesModule';
import { AgentsModule } from '@/pages/agents/AgentsModule';
import { DisputesQueue } from '@/pages/orders/DisputesQueue';
import { AccountsModule } from '@/pages/accounts/AccountsModule';
import { AllocationsModule } from '@/pages/money/AllocationsModule';
import { BillingModule } from '@/pages/billing/BillingModule';
import { CodModule } from '@/pages/cod/CodModule';
import { DepositsModule } from '@/pages/cod/DepositsModule';
import { DiscrepanciesModule } from '@/pages/cod/DiscrepanciesModule';
import { HoldersModule } from '@/pages/cod/HoldersModule';
import { RemittancesModule } from '@/pages/cod/RemittancesModule';
import { EarningsModule } from '@/pages/money/EarningsModule';
import { OrdersModule } from '@/pages/orders/OrdersModule';
import { CacheInspector } from '@/pages/dev-tools/CacheInspector';
import { CatalogueTools } from '@/pages/dev-tools/CatalogueTools';
import { DatabaseInspector } from '@/pages/dev-tools/DatabaseInspector';
import { DevToolsConfig } from '@/pages/dev-tools/DevToolsConfig';
import { FeatureFlags } from '@/pages/dev-tools/FeatureFlags';
import { MediaLibrary } from '@/pages/media/MediaLibrary';
import { OrphanFiles } from '@/pages/media/OrphanFiles';
import { OutboxTools } from '@/pages/dev-tools/OutboxTools';
import { PlatformLogs } from '@/pages/dev-tools/PlatformLogs';
import { PermissionsModule } from '@/pages/permissions/PermissionsModule';
import { SystemErrors } from '@/pages/system/SystemErrors';
import { SystemHealth } from '@/pages/system/SystemHealth';
import { SystemIntegrations } from '@/pages/system/SystemIntegrations';
import { SystemMaintenance } from '@/pages/system/SystemMaintenance';
import { SystemMetrics } from '@/pages/system/SystemMetrics';
import { SystemQueues } from '@/pages/system/SystemQueues';
import { SystemWorkers } from '@/pages/system/SystemWorkers';
import { PaymentsModule } from '@/pages/money/PaymentsModule';
import { PayoutsModule } from '@/pages/money/PayoutsModule';
import { RefundsModule } from '@/pages/money/RefundsModule';
import { SubscriptionsModule } from '@/pages/billing/SubscriptionsModule';
import { ContractsModule } from '@/pages/contracts/ContractsModule';
import { ShipmentsModule } from '@/pages/shipments/ShipmentsModule';
import { SupportModule } from '@/pages/support/SupportModule';
import { ContentModule } from '@/pages/content/ContentModule';
import { AuthorsList } from '@/pages/content/AuthorsList';
import { PermissionsProvider } from '@/store';

/** The path a nav entry occupies relative to the entry that contains it. */
function relativePath(path: string, parent: string): string {
    return path.slice(parent.length).replace(/^\//, '');
}

/**
 * Wrap an element in the entry's **own** requirement.
 *
 * The requirement comes from `entryRequirement`, which is the same function the
 * sidebar filters on — so the gate and the link read one object rather than two
 * lists that can disagree. That is what makes "what is visible is reachable" true
 * by construction.
 *
 * A module with children gates its `<Outlet/>` on the union of theirs, and then
 * each child gates itself. Both layers run, so a Support administrator admitted
 * to the System container through `support.errors.lookup` is still refused at
 * Health — and the refusal names `system.health.read`, the narrowest rule they
 * actually failed, rather than the container's whole union.
 */
function gate(entry: NavEntry, element: ReactNode): ReactNode {
    const { permission, mode } = entryRequirement(entry);
    if (permission.length === 0) return element;

    return (
        <RequirePermission permission={permission} mode={mode} subject={entry.label}>
            {element}
        </RequirePermission>
    );
}

/**
 * The screen a nav entry renders.
 *
 * Everything not yet built falls through to the placeholder, which names the
 * phase that owns it and the permissions the real screen will be gated on.
 */
function screenFor(entry: NavEntry): ReactNode {
    return SCREENS[entry.id] ?? <ModulePlaceholder />;
}

const SCREENS: Record<string, ReactNode> = {
    /**
     * The inbox is the module's **index child**, so it is keyed by the child's
     * id. The parent id is never looked up for a module with children — its route
     * renders an `<Outlet/>`, and each child resolves its own screen.
     */
    'notifications-inbox': <NotificationsModule />,
    'notifications-sources': <NotificationSources />,
    /**
     * A module, not a single screen: `UsersModule` declares its own index and
     * `:userId` routes. That works without changing the tree below because a
     * childless module is mounted at `<module>/*`.
     */
    users: <UsersModule />,
    vendors: <VendorsModule />,
    agencies: <AgenciesModule />,
    agents: <AgentsModule />,
    /**
     * The two Administration modules, both childless and both mounted at
     * `<module>/*` like the directories above.
     *
     * They are a pair on purpose: three writes on `/administrators` answer `202`
     * and queue instead of executing, and `/approvals` is where those land.
     * Shipping one without the other would leave a queued suspension with
     * nowhere to be resolved.
     */
    administrators: <AdministratorsModule />,
    approvals: <ApprovalsModule />,
    /**
     * Keyed by child id, like Money and COD. The two audit destinations are
     * two separately granted permissions: Support holds `audit.read` and not
     * `audit.export`, so they reach the trail and never see an Exports entry at
     * all.
     *
     * `audit-trail` is the index child, so it is mounted at both `index` and `*`
     * and owns `:auditId` — which is why `AuditModule` declares its own
     * catch-all. The two static siblings outrank the splat.
     */
    'audit-trail': <AuditModule />,
    'audit-exports': <AuditExportsModule />,
    /**
     * Keyed by the **child** id, not the parent: `screenFor` is called with
     * whichever entry owns the route, and Orders is a container whose two children
     * carry their own permissions — `orders.read` for the list and its detail,
     * `orders.disputes.read` for the queue.
     */
    'support-tickets': <SupportModule />,
    /**
     * Keyed by child id. Articles is the index child and owns `:articleId`;
     * Bylines is a static sibling with its own permission, so an administrator
     * holding only `content.authors.read` reaches the module and lands there.
     */
    'content-articles': <ContentModule />,
    'content-authors': <AuthorsList />,
    'orders-all': <OrdersModule />,
    'orders-disputes': <DisputesQueue />,
    shipments: <ShipmentsModule />,
    /**
     * A childless module, mounted at `accounts/*`, so it owns `:ownerType/:ownerId`
     * and its own 404 like the four directories above.
     */
    accounts: <AccountsModule />,
    /**
     * Keyed by the child id: Money is a container whose five children carry their
     * own permissions, and each is its own module with its own sub-routes.
     *
     * Support holds `money.payments.read` alone, so Payments and Refunds are the
     * only two of the five they ever see — and the only finance screens on the
     * whole dashboard they can reach.
     */
    'money-payouts': <PayoutsModule />,
    'money-earnings': <EarningsModule />,
    'money-allocations': <AllocationsModule />,
    'money-payments': <PaymentsModule />,
    'money-refunds': <RefundsModule />,
    /**
     * Billing declares an index child, so the generator mounts `BillingModule` at
     * both `index` and `*` — which is what keeps `/dashboard/billing` on the
     * catalog while `/dashboard/billing/:planId` still resolves.
     */
    'billing-plans': <BillingModule />,
    'billing-subscriptions': <SubscriptionsModule />,
    /**
     * A childless module, mounted at `permissions/*`, so it owns its own 404.
     *
     * The two reads behind it are gated differently — the catalogue needs no permission and the
     * tier matrix needs `permissions.read` — so the screen fetches them separately and lets the
     * matrix half be refused on its own. The nav entry carries the narrower of the two, which is
     * what decides whether the module appears at all.
     */
    permissions: <PermissionsModule />,
    /**
     * Keyed by child id, like Money and COD — System is a container whose children carry their
     * own permissions, and a Support administrator reaches exactly one of them.
     *
     * Two of these screens host a `developer_tools.*` **write** (the worker trigger, the
     * maintenance form), each gated separately inside the screen. That is the module's rule: a
     * destination follows the tier boundary, a button follows its subject.
     */
    'system-health': <SystemHealth />,
    'system-workers': <SystemWorkers />,
    'system-outbox': <SystemQueues />,
    'system-integrations': <SystemIntegrations />,
    'system-metrics': <SystemMetrics />,
    'system-maintenance': <SystemMaintenance />,
    'system-errors': <SystemErrors />,

    /**
     * The Media module, keyed by child id like System and Money — its two
     * children are separately granted permissions and neither is an index.
     *
     * ⚠ **`media-orphans` was `system-files` until 2026-08-26.** The screen is
     * the same one; only its module moved, because BR-015 finally gave it a
     * sibling. Nothing linked to the old path but the nav entry itself.
     */
    'media-library': <MediaLibrary />,
    'media-orphans': <OrphanFiles />,

    /**
     * The Automation module, keyed by child id — neither child is an index and both stand on
     * the same `any`-mode three-permission guard, so `ModuleIndexRedirect` lands everyone on
     * the summary.
     *
     * ⚠ Both screens are graded by the **server** and say so on the page. Neither reads
     * `usePermissions().tier` to decide what to render: the failures feed narrows on the row's
     * own shape, and the summary is not graded at all.
     */
    'automation-summary': <AutomationSummary />,
    'automation-failures': <AutomationFailures />,
    /**
     * Developer tools, keyed by child id like System.
     *
     * Every one of these is tier 1 only, and five of the seven writes behind them additionally
     * refuse unless `dev_tools.enabled` is on — a `409` saying the service is not accepting them,
     * never a `403` about the caller's grants. Each screen says which of the two it is up
     * against.
     */
    'dev-tools-flags': <FeatureFlags />,
    'dev-tools-config': <DevToolsConfig />,
    'dev-tools-logs': <PlatformLogs />,
    'dev-tools-database': <DatabaseInspector />,
    'dev-tools-cache': <CacheInspector />,
    'dev-tools-outbox': <OutboxTools />,
    'dev-tools-catalogue': <CatalogueTools />,

    /**
     * Keyed by child id, like Money and Billing. COD's five children are five
     * separately granted permissions — an operator can hold the deposits queue and
     * not the overview — so each is its own gate and its own module.
     */
    'cod-overview': <CodModule />,
    'cod-holders': <HoldersModule />,
    'cod-remittances': <RemittancesModule />,
    'cod-deposits': <DepositsModule />,
    'cod-discrepancies': <DiscrepanciesModule />,
};

/**
 * The module routes, generated from the navigation config.
 *
 * Generated rather than hand-written so that a module cannot exist in the
 * sidebar without a route, or the reverse. `navigation.test.ts` pins the other
 * half of that invariant — every declared path resolves rather than failing
 * closed.
 *
 * ── One rule: whatever is mounted at a splat owns its remainder ───────────────
 * A module screen that has sub-routes of its own — a list and a `:id` detail — is
 * mounted at `<path>/*` and declares its own `<Routes>`, including its own 404.
 * That is how `users`, `vendors`, `agencies`, `agents` and `orders` all work.
 *
 * A module with **children** additionally mounts each non-index child at its own
 * splat, and the index child at `*`. `*` matches the empty remainder too, so
 * `/dashboard/orders` still lands on the index child, and React Router ranks the
 * static `disputes/*` above it — which is what keeps both reachable.
 *
 * The index child is only mounted that way when it is `implemented`. An unbuilt
 * module falls back to a plain `index` route plus a `NotFound`, so
 * `/dashboard/cod/nonsense` keeps answering 404 rather than quietly rendering the
 * COD placeholder. When such a module ships, flipping the flag also obliges it to
 * declare its own `<Routes>` with a catch-all — the same obligation every
 * splat-mounted module already carries.
 */
const MODULE_ROUTES = NAV_ITEMS.filter((item) => item.path !== '/dashboard');

/**
 * Listens for a session ending anywhere in the app and routes to sign-in once.
 *
 * The API client cannot do this itself — it has no router — so it announces the
 * end and this does the navigating. One subscriber, mounted once, so N failed
 * requests produce one redirect and one message.
 */
function SessionWatcher() {
    const navigate = useNavigate();

    useEffect(
        () =>
            onSessionEnded((event) => {
                if (event.reason !== 'signed-out') {
                    // Worth surfacing verbatim: to an administrator who did not
                    // end their own session, a reused refresh token is the first
                    // sign that somebody else has one of their tokens.
                    notify.warning('Your session has ended', { description: event.message });
                }
                navigate('/sign-in', { replace: true });
            }),
        [navigate],
    );

    return null;
}

export default function App() {
    return (
        <>
            <SessionWatcher />

            <Routes>
                <Route
                    path="/sign-in"
                    element={
                        <RequireAnonymous>
                            <SignIn />
                        </RequireAnonymous>
                    }
                />

                {/*
                  Outside the shell on purpose. A scoped session reaches exactly
                  four routes, so every sidebar link it could see would answer
                  403 ADMIN_AUTH_MFA_REQUIRED — rendering navigation that cannot
                  be used is a trap, not a courtesy.
                */}
                <Route
                    path="/mfa-setup"
                    element={
                        <RequireScopedSession>
                            <MfaSetup />
                        </RequireScopedSession>
                    }
                />

                {/*
                  `PermissionsProvider` sits *inside* `RequireAuth` deliberately.
                  A scoped enrolment session reaches four routes and everything
                  else — GET /permissions/me included — answers 403
                  ADMIN_AUTH_MFA_REQUIRED. `RequireAuth` sends such a session to
                  /mfa-setup, so the provider structurally cannot mount for one,
                  and "never ask mid-enrolment" stops being an `if` somebody can
                  delete.
                */}
                <Route
                    path="/dashboard"
                    element={
                        <RequireAuth>
                            <PermissionsProvider>
                                <DashboardShell actions={<AccountArea />} />
                            </PermissionsProvider>
                        </RequireAuth>
                    }
                >
                    <Route index element={<Overview />} />

                    {/*
                      The self-service routes are ungated, matching the service:
                      no /auth route and no /administrators/me route carries a
                      permission, because gating one would let a level be locked
                      out of its own account. /permissions/me and
                      /permissions/catalog — which is all MyAccess reads — are
                      permission-free for the same reason.
                    */}
                    <Route path="account" element={<Navigate to="security" replace />} />
                    <Route path="account/security" element={<AccountSecurity />} />
                    <Route path="account/access" element={<MyAccess />} />
                    {/*
                      Notification preferences belong here rather than under the
                      Notifications module: both preference routes are declared
                      *self* and check no permission, while a nav child inherits
                      its parent's gate. Mounting them there would declare a
                      stricter rule than the server has.
                    */}
                    <Route path="account/notifications" element={<NotificationPreferences />} />

                    {/*
                      Contracts is reachable but not visible, and is the only
                      route declared by hand rather than generated from
                      `navigation.ts`.

                      `/contracts` has **no list endpoint** — all four routes
                      address one contract by id — so a sidebar entry would link
                      to nothing. It is reached from an agency's roster, from an
                      agent's contract list, and from a contract id pasted out of
                      a support ticket, which is the case the mount exists for.

                      The guard is written here because there is no nav entry to
                      derive it from: `agencies.read` + `agents.read` in `all`
                      mode, matching the endpoint, which carries a party from
                      each directory and so needs both.
                    */}
                    <Route
                        path="contracts/*"
                        element={
                            <RequirePermission
                                permission={['agencies.read', 'agents.read']}
                                mode="all"
                                subject="Contracts"
                            >
                                <ContractsModule />
                            </RequirePermission>
                        }
                    />

                    {MODULE_ROUTES.map((item) => {
                        const path = relativePath(item.path, '/dashboard');
                        const children = item.children ?? [];

                        if (children.length === 0) {
                            return (
                                <Route
                                    key={item.id}
                                    path={`${path}/*`}
                                    element={gate(item, screenFor(item))}
                                />
                            );
                        }

                        const indexChild = children.find((child) => child.index);

                        return (
                            <Route key={item.id} path={path} element={gate(item, <Outlet />)}>
                                {children
                                    .filter((child) => !child.index)
                                    .map((child) => (
                                        <Route
                                            key={child.id}
                                            path={`${relativePath(child.path, item.path)}/*`}
                                            element={gate(child, screenFor(child))}
                                        />
                                    ))}

                                {indexChild?.implemented ? (
                                    /*
                                      Two routes, one element, and both are needed.

                                      An index route cannot nest, so an index child
                                      whose screen is a module — the orders list and
                                      its `:orderId` detail — needs a splat as well.
                                      And a child `path="*"` does **not** match its
                                      parent's own path, only deeper ones, so the
                                      splat alone would leave `/dashboard/orders`
                                      matching nothing and the outlet empty.

                                      The static `disputes/*` above still outranks
                                      the splat, so the sibling child keeps its own
                                      path and its own permission. The module owns
                                      its 404 from here, exactly as a childless one
                                      does, which is why no catch-all follows.
                                    */
                                    <>
                                        <Route
                                            index
                                            element={gate(indexChild, screenFor(indexChild))}
                                        />
                                        <Route
                                            path="*"
                                            element={gate(indexChild, screenFor(indexChild))}
                                        />
                                    </>
                                ) : (
                                    <>
                                        <Route
                                            index
                                            element={
                                                indexChild ? (
                                                    gate(indexChild, screenFor(indexChild))
                                                ) : (
                                                    <ModuleIndexRedirect item={item} />
                                                )
                                            }
                                        />
                                        {/*
                                          A module's own 404. Without it the
                                          shell-level catch-all never sees these
                                          paths — the module route already matched —
                                          and React Router would render the gated
                                          outlet with nothing inside it.
                                        */}
                                        <Route path="*" element={<NotFound />} />
                                    </>
                                )}
                            </Route>
                        );
                    })}
                    <Route path="*" element={<NotFound />} />
                </Route>

                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>

            <Toaster richColors position="top-right" />
        </>
    );
}
