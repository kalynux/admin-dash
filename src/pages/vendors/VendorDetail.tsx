import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, BadgeCheck, BadgeX, RotateCcw, RotateCw, SlidersHorizontal } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { CascadeResultNotice } from '@/components/vendors/CascadeResultNotice';
import { VendorAgenciesPanel } from '@/components/vendors/VendorAgenciesPanel';
import { EditVendorSettingsDialog } from '@/components/vendors/EditVendorSettingsDialog';
import { RestoreVendorDialog } from '@/components/vendors/RestoreVendorDialog';
import { SuspendVendorDialog } from '@/components/vendors/SuspendVendorDialog';
import { AccountPanel } from '@/components/accounts/AccountPanel';
import { VendorActivityPanel } from '@/components/vendors/VendorActivityPanel';
import {
    ApproveVendorKycDialog,
    RejectVendorKycDialog,
} from '@/components/vendors/VendorKycDialogs';
import {
    VendorAddressesPanel,
    VendorContactPanel,
    VendorCountsPanel,
    VendorIdentityPanel,
    VendorPoliciesPanel,
    VendorSettingsPanel,
    VendorSignInAccountPanel,
    VendorStorePanel,
    VendorVerificationPanel,
} from '@/components/vendors/VendorProfilePanels';
import { VendorProductsPanel } from '@/components/vendors/VendorProductsPanel';
import { VendorStatusPanel } from '@/components/vendors/VendorStatusPanel';
import { VendorSuspensionPanel } from '@/components/vendors/VendorSuspensionPanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { ACCOUNT_READ_PERMISSIONS } from '@/services/accounts.service';
import { getVendor } from '@/services/vendors.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import { vendorDisplayName, type PlatformVendor } from '@/types/vendors.types';
import { CopyableId } from '@/components/common/CopyableId';

/** Ids on this service are 24-hex ObjectIds, validated at the service's edge. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /vendors/:vendorId` — one shop, and everything an administrator may do to it.
 *
 * ── Four tabs, two of them conditional ────────────────────────────────────────
 * Overview and Catalogue need `vendors.read`, which the module gate already
 * required. Activity needs `vendors.read` **and** `audit.read`; Account reads a
 * different mount entirely and needs three money permissions. Neither tab is
 * rendered without them, rather than rendered and then refusing — the sidebar
 * follows the same rule, and a tab whose only content is a denial teaches people
 * the screen is broken.
 *
 * They also fetch lazily. Radix unmounts an inactive tab's content, so the
 * catalogue, the activity feed and the (expensive, thirteen-source) account read
 * are only issued when somebody opens them.
 *
 * ── The tab is controlled, for one reason ─────────────────────────────────────
 * A reinstatement returns fewer listings than the suspension took, and the useful
 * next step is *see what stayed down*. That hands the Catalogue tab a status to
 * open filtered on, which needs the tab state to live here. It is not in the URL:
 * the detail's query string belongs to the vendor, and adding a second list's
 * parameters to it would make a shared link ambiguous.
 *
 * ── Every write refetches; nothing is merged ──────────────────────────────────
 * The seven writes are delegated and answer narrower shapes than this read — the
 * vendor writes return jovi-mall's DTO with no store, account or counts, and the
 * product writes return only an id. Merging any of them needs a second mapper that
 * can drift from the first, so a successful write calls `reload()` and bumps the
 * tokens the panels are keyed on.
 *
 * The two cascade counts are the exception, held in state rather than refetched:
 * they exist on their own write's response and **nowhere else**.
 */
export function VendorDetail() {
    const { vendorId = '' } = useParams();

    /**
     * Validated **before the fetching component mounts**, not inside it.
     *
     * A malformed id is a `400 VALIDATION_ERROR` at the service's edge, and this
     * only happens when somebody edits the URL or follows a broken link — so the
     * round trip buys nothing. Checking it inside the screen would not do: hooks
     * cannot be conditional, so the read would already have been issued by the
     * time an early return could refuse it.
     */
    if (!OBJECT_ID.test(vendorId)) return <InvalidVendorId />;

    return <VendorDetailScreen vendorId={vendorId} />;
}

function InvalidVendorId() {
    return (
        <PageContainer title="Vendor not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid vendor id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function VendorDetailScreen({ vendorId }: { vendorId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [suspending, setSuspending] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [approving, setApproving] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [editingSettings, setEditingSettings] = useState(false);

    const [cascade, setCascade] = useState<PlatformVendor | null>(null);
    const [activityToken, setActivityToken] = useState(0);
    const [catalogueToken, setCatalogueToken] = useState(0);
    /**
     * A hand-off into the Catalogue tab, applied once.
     *
     * Two flows use it and each sets only its own half: a reinstatement sends a
     * `status` (*"show the listings still off sale"*), and the connections panel
     * sends an `agencyId` (*"show the listings behind this count"*). The token is
     * what makes a repeat of the same hand-off apply again.
     */
    const [focus, setFocus] = useState<{
        status?: string;
        agencyId?: string;
        token: number;
    } | null>(null);

    const vendor = useAsyncData(`/vendors/${vendorId}`, (signal) =>
        getVendor(vendorId, { signal }),
    );

    /** One write moves three reads: the record, the trail, and the catalogue. */
    function reconcile() {
        vendor.reload();
        setActivityToken((current) => current + 1);
        setCatalogueToken((current) => current + 1);
    }

    /** A vendor-level write, plus whatever it did to the catalogue. */
    function reconcileCascade(result: PlatformVendor | null) {
        setCascade(result);
        reconcile();
    }

    if (vendor.isLoading) {
        return (
            <PageContainer title="Vendor">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!vendor.data) {
        return (
            <PageContainer title="Vendor">
                {/* A `404` here is the denial for a record outside your scope as well
                    as one that does not exist — `ErrorState` already renders that as a
                    calm "not available to you" rather than a fault. */}
                <ErrorState
                    error={vendor.error}
                    onRetry={vendor.reload}
                    deniedTitle="No such vendor"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const record = vendor.data;
    const canSeeActivity = can(['vendors.read', 'audit.read'], 'all');
    const canSeeAccount = can(ACCOUNT_READ_PERMISSIONS, 'all');
    /*
      ⚠ `all`, and `satisfies` takes no default mode precisely so this cannot be
      read as `any`. Both tiers holding either permission hold both today, so this
      costs nobody access — it states the dependency so a future tier change
      cannot quietly open a side door onto the agency directory.
    */
    const canSeeConnections = can(['vendors.read', 'agencies.read'], 'all');

    return (
        <PageContainer
            title={vendorDisplayName(record)}
            description={<CopyableId value={record.id} label="vendor ID" truncate={false} />}
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={vendor.reload}
                        disabled={vendor.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    {/*
                      One permission, two verdicts — and each is offered only where it
                      would change something. Asking for the verdict a vendor already
                      holds is `409 VENDOR_KYC_STATUS_CONFLICT`, so a button that could
                      only ever produce it is not a button.
                    */}
                    <Can permission="vendors.kyc.review">
                        {record.kycStatus !== 'verified' ? (
                            <Button variant="outline" size="sm" onClick={() => setApproving(true)}>
                                <BadgeCheck className="size-4" />
                                Approve verification
                            </Button>
                        ) : null}
                        {record.kycStatus !== 'rejected' ? (
                            <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
                                <BadgeX className="size-4" />
                                Reject verification
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="vendors.settings.manage">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingSettings(true)}
                        >
                            <SlidersHorizontal className="size-4" />
                            Order settings
                        </Button>
                    </Can>

                    {/*
                      One permission, two directions — `vendors.suspend` governs both.
                      Which button is offered follows the record's status, so a vendor
                      can never be offered both at once.
                    */}
                    <Can permission="vendors.suspend">
                        {record.status === 'inactive' ? (
                            <Button variant="outline" size="sm" onClick={() => setRestoring(true)}>
                                <RotateCcw className="size-4" />
                                Reinstate
                            </Button>
                        ) : (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setSuspending(true)}
                            >
                                <Ban className="size-4" />
                                Suspend
                            </Button>
                        )}
                    </Can>
                </>
            }
        >
            <BackLink />

            {cascade ? (
                <CascadeResultNotice
                    result={cascade}
                    onDismiss={() => setCascade(null)}
                    onShowSuspendedListings={() => {
                        setTab('catalogue');
                        setFocus((current) => ({
                            status: 'suspended',
                            token: (current?.token ?? 0) + 1,
                        }));
                    }}
                />
            ) : null}

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
                    {canSeeAccount ? <TabsTrigger value="account">Account</TabsTrigger> : null}
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    {/* Keyed on `status`, never on the object alone: the service sends
                        `null` here on a trading vendor precisely so a stale reason
                        cannot read as a current suspension. */}
                    {record.status === 'inactive' && record.suspension ? (
                        <VendorSuspensionPanel
                            suspension={record.suspension}
                            timeZone={timeZone}
                        />
                    ) : null}

                    <VendorStatusPanel vendor={record} />
                    <VendorIdentityPanel vendor={record} timeZone={timeZone} />
                    <VendorStorePanel vendor={record} timeZone={timeZone} />
                    <VendorSignInAccountPanel vendor={record} />
                    <VendorVerificationPanel vendor={record} timeZone={timeZone} />
                    <VendorContactPanel vendor={record} />
                    <VendorAddressesPanel vendor={record} />
                    <VendorPoliciesPanel vendor={record} />
                    <VendorSettingsPanel vendor={record} />
                    <VendorCountsPanel vendor={record} timeZone={timeZone} />

                    {/*
                      ⚠ Rendered only for a caller holding BOTH permissions, never
                      rendered and then refused. The rows carry agency business
                      names, contact people and commercial state, so `vendors.read`
                      alone would be a second door onto the agency directory — the
                      endpoint guards it as a composite in `all` mode, and a panel
                      whose only content is a 403 teaches people the screen is
                      broken. The counts above stay either way: they are on this
                      payload and need nothing extra.
                    */}
                    {canSeeConnections ? (
                        <VendorAgenciesPanel
                            vendorId={record.id}
                            timeZone={timeZone}
                            onShowListings={(agencyId) => {
                                setTab('catalogue');
                                setFocus((current) => ({
                                    agencyId,
                                    token: (current?.token ?? 0) + 1,
                                }));
                            }}
                        />
                    ) : (
                        <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                            The connections behind those counts are listed one row each for an
                            account holding both vendor and agency read access. The rows name
                            agencies and carry their commercial state, so the endpoint asks for
                            the permission that governs the agency directory as well as this one.
                        </p>
                    )}

                    {/*
                      Stated in the open, not hidden behind an info icon, because an
                      administrator holding `vendors.*` reasonably goes looking for
                      each of these. Every one is unbuilt for a recorded reason.
                    */}
                    <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                        Suspension, verification, listing takedowns and the three order settings are
                        everything this screen can change. There is deliberately no profile editor,
                        no policy editor and no way to delete a vendor: their business name,
                        addresses, policies and payout details are theirs; editing policies would
                        pause every one of their delivery-agency connections pending reapproval; and
                        a vendor is referenced by historical orders, so suspension is the model
                        rather than deletion.
                    </p>
                </TabsContent>

                <TabsContent value="catalogue">
                    <VendorProductsPanel
                        vendorId={record.id}
                        timeZone={timeZone}
                        reloadToken={catalogueToken}
                        focusStatus={focus?.status}
                        focusAgencyId={focus?.agencyId}
                        focusToken={focus?.token}
                    />
                </TabsContent>

                {canSeeAccount ? (
                    <TabsContent value="account">
                        <AccountPanel
                            ownerType="vendor"
                            ownerId={record.id}
                            timeZone={timeZone}
                        />
                    </TabsContent>
                ) : null}

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <VendorActivityPanel
                            vendorId={record.id}
                            timeZone={timeZone}
                            reloadToken={activityToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <SuspendVendorDialog
                vendor={record}
                open={suspending}
                onOpenChange={setSuspending}
                onSuspended={reconcileCascade}
            />
            <RestoreVendorDialog
                vendor={record}
                open={restoring}
                onOpenChange={setRestoring}
                onRestored={reconcileCascade}
            />
            <ApproveVendorKycDialog
                vendor={record}
                open={approving}
                onOpenChange={setApproving}
                onDecided={reconcile}
            />
            <RejectVendorKycDialog
                vendor={record}
                open={rejecting}
                onOpenChange={setRejecting}
                onDecided={reconcile}
            />
            <EditVendorSettingsDialog
                vendor={record}
                open={editingSettings}
                onOpenChange={setEditingSettings}
                onUpdated={reconcile}
            />
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/vendors"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
            <ArrowLeft className="size-4" />
            All vendors
        </Link>
    );
}
