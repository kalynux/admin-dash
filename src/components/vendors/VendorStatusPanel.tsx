import { Link } from 'react-router-dom';

import { VendorKycBadge } from '@/components/vendors/VendorKycBadge';
import { VendorStatusBadge } from '@/components/vendors/VendorStatusBadge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { UserStatusBadge } from '@/components/users/UserStatusBadge';
import type { VendorDetail } from '@/types/vendors.types';

/**
 * The four state axes, side by side, each labelled with what it governs.
 *
 * ── Why this is one card and not four scattered fields ────────────────────────
 * `docs/admin/api/vendors.md:29` opens a section titled *"Three status axes, and
 * they are not the same thing"* and calls confusing them the commonest mistake
 * here. The failure it describes is an operator seeing one word — "active" — and
 * concluding the shop is fine when the account behind it is suspended, or seeing a
 * closed shop and reaching for a reinstate button when the vendor simply went on
 * holiday.
 *
 * Putting all four in one place, each under the question it answers, is the fix.
 * They are shown as four rows rather than one composite badge precisely because
 * **suspending one does not touch the others** and no single word is true of all
 * four.
 *
 * The fourth is verification, which is on its own axis again: it is written by an
 * administrator like `status` is, but it **gates nothing**
 * ([ADR-008 D-5](../../docs/admin/ADR-008-VENDOR-MANAGEMENT.md)) — so it sits here
 * with that stated, rather than beside the trading status where it would read as a
 * second thing stopping the shop.
 */
export function VendorStatusPanel({ vendor }: { vendor: VendorDetail }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>State</CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="grid gap-4 sm:grid-cols-2">
                    <Axis
                        question="May the shop trade?"
                        detail="Written by an administrator, here. Suspending also takes the whole catalogue off sale."
                        value={<VendorStatusBadge status={vendor.status} />}
                    />

                    <Axis
                        question="May the person sign in?"
                        detail="A separate account, with its own permission. Changed on the Users screen — nothing on this page touches it."
                        value={
                            vendor.account ? (
                                <span className="flex flex-wrap items-center gap-2">
                                    <UserStatusBadge status={vendor.account.status} />
                                    <Link
                                        to={`/dashboard/users/${vendor.userId}`}
                                        className="text-xs hover:underline"
                                    >
                                        Open account
                                    </Link>
                                </span>
                            ) : (
                                /* The sign-in row is missing entirely — see
                                   `VendorSignInAccountPanel`, which explains it. */
                                <Badge
                                    variant="outline"
                                    className="border-destructive/30 bg-destructive/10 text-destructive"
                                >
                                    No account
                                </Badge>
                            )
                        }
                    />

                    <Axis
                        question="Is the shop open?"
                        detail="The vendor's own vacation switch. There is no admin endpoint for it, and a closed shop is not a suspension."
                        value={
                            vendor.store ? (
                                <Badge variant="outline" className="gap-1.5">
                                    <span
                                        aria-hidden
                                        className={
                                            vendor.store.isOpen
                                                ? 'size-1.5 shrink-0 rounded-full bg-success'
                                                : 'bg-muted-foreground size-1.5 shrink-0 rounded-full'
                                        }
                                    />
                                    {vendor.store.isOpen ? 'Open' : 'Closed by the vendor'}
                                </Badge>
                            ) : (
                                <span className="text-muted-foreground text-sm">No store yet</span>
                            )
                        }
                    />

                    <Axis
                        question="Is the business verified?"
                        detail="Reviewed by an administrator, and visible to delivery agencies — but it gates nothing. A rejected vendor still trades."
                        value={<VendorKycBadge status={vendor.kycStatus} />}
                    />
                </ul>
            </CardContent>
        </Card>
    );
}

function Axis({
    question,
    detail,
    value,
}: {
    question: string;
    detail: string;
    value: React.ReactNode;
}) {
    return (
        <li className="space-y-1.5">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
                {question}
                <InfoHint label={question}>{detail}</InfoHint>
            </p>
            {value}
        </li>
    );
}
