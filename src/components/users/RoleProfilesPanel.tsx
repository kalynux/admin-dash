import { AlertTriangle, BadgeCheck, BadgeX } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatInstantInZone } from '@/lib/format';
import { isMissingProfile, type UserProfile } from '@/types/users.types';

interface RoleProfilesPanelProps {
    profiles: UserProfile[];
    timeZone: string;
}

/**
 * What this person is on the platform, one entry per role they hold.
 *
 * ── The entry that matters most is the broken one ─────────────────────────────
 * `missing: true` means the role is on the `users` row but its entity does not
 * exist. jovi-mall's `requireAuth` answers `AUTH_ROLE_PROFILE_NOT_FOUND` for it,
 * so **the person cannot use that role at all** — and nothing else on the
 * platform surfaces it. The service reports it rather than dropping the row for
 * exactly that reason, and dropping it here would put the omission back.
 *
 * ── Why there is so little here, and no links ─────────────────────────────────
 * The projection behind this is deliberately narrow: id, display name, status,
 * the business-verification flag for the two businesses, `kyc.status` for the
 * agent, created date. Anything richer belongs on that role's own screen behind
 * that role's own permission — `vendors.read`, `agencies.read`, `agents.read` —
 * rather than smuggled in where `users.read` alone would reach it.
 *
 * Those screens are not built yet, and there is **no `/customers` surface at all**
 * on this service, so no entry links anywhere today. Add the links when the
 * modules ship; a link to a placeholder is worse than none.
 *
 * `status` and `kycStatus` are unenumerated pass-throughs from four different
 * collections, so both render raw.
 */
export function RoleProfilesPanel({ profiles, timeZone }: RoleProfilesPanelProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Role profiles</CardTitle>
                <CardDescription>
                    One entry per role on the account. Each role&apos;s own record — its store, its
                    agency, its agent file — lives on that role&apos;s screen.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
                {profiles.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        This account holds no roles. It can sign in, but there is nothing on the
                        platform it can do.
                    </p>
                ) : null}

                {profiles.map((profile) =>
                    isMissingProfile(profile) ? (
                        <div
                            key={profile.role}
                            className="border-destructive/40 bg-destructive/10 flex gap-3 rounded-lg border p-3"
                        >
                            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                            <div className="min-w-0 space-y-1">
                                {/* One text node, not a sentence broken around a
                                    styled span — a split heading is unsearchable
                                    on the page and reads in pieces to a screen
                                    reader. Role names are already lower case. */}
                                <p className="text-destructive text-sm font-medium">
                                    {`The ${profile.role} profile is missing`}
                                </p>
                                <p className="text-destructive/90 text-xs">
                                    The account claims this role but its record does not exist, so
                                    sign-in fails outright with
                                    <code className="mx-1">AUTH_ROLE_PROFILE_NOT_FOUND</code>
                                    rather than merely refusing this role. Nothing on this dashboard
                                    can repair it — it needs fixing in the platform database.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div
                            key={profile.role}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                        >
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary" className="capitalize">
                                        {profile.role}
                                    </Badge>
                                    <span className="truncate text-sm font-medium">
                                        {profile.name ?? 'Unnamed'}
                                    </span>
                                </div>
                                {/*
                                  No entry links anywhere (see the note above), so
                                  this id is the *only* way to reach the role's own
                                  screen — the operator pastes it into that
                                  module's search box. `truncate={false}` because
                                  that is what a whole id being on screen already
                                  bought them, and the label names the role because
                                  an account can carry four of these.
                                */}
                                <p className="mt-1">
                                    <CopyableValue
                                        value={profile.id}
                                        label={`${profile.role} profile ID`}
                                        truncate={false}
                                        className="text-muted-foreground"
                                    />
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                {profile.status ? (
                                    <Badge variant="outline" className="font-normal">
                                        {profile.status}
                                    </Badge>
                                ) : null}

                                {profile.verified !== null ? (
                                    <span
                                        className={
                                            profile.verified
                                                ? 'text-success flex items-center gap-1 text-xs'
                                                : 'text-muted-foreground flex items-center gap-1 text-xs'
                                        }
                                    >
                                        {profile.verified ? (
                                            <BadgeCheck className="size-3.5" />
                                        ) : (
                                            <BadgeX className="size-3.5" />
                                        )}
                                        {profile.verified ? 'Verified' : 'Not verified'}
                                    </span>
                                ) : null}

                                {profile.kycStatus ? (
                                    <span className="text-muted-foreground text-xs">
                                        KYC: {profile.kycStatus}
                                    </span>
                                ) : null}

                                <span className="text-muted-foreground text-xs">
                                    {formatInstantInZone(profile.createdAt, timeZone) ?? '—'}
                                </span>
                            </div>
                        </div>
                    ),
                )}
            </CardContent>
        </Card>
    );
}
