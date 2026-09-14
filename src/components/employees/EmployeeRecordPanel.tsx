import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { ListSkeleton } from '@/components/common/Loading';
import { EmployeeDocumentsPanel } from '@/components/employees/EmployeeDocumentsPanel';
import { EmployeeEmploymentPanel } from '@/components/employees/EmployeeEmploymentPanel';
import { EmployeeReadinessPanel } from '@/components/employees/EmployeeReadinessPanel';
import { useAsyncData } from '@/hooks/use-async-data';
import { googleMapsUrlFromGeoJson } from '@/lib/geo';
import { getEmployeeRecord } from '@/services/employees.service';
import { geoCandidateLabel } from '@/types/geo.types';

/**
 * Somebody else's employee record. `GET /employees/:adminId` · **`employees.read`**.
 *
 * ── ⚠ Tier 1 and the subject, and nobody else at any rung ────────────────────
 * Including tier 2, who can suspend accounts and reset passwords and still
 * cannot open this. Being its own permission family *is* the access control, and
 * a **boot assertion** refuses it to any other tier — so a screen that rendered
 * it for an Admin would be showing something the service will not serve.
 *
 * ── ⚠ One body, not two ──────────────────────────────────────────────────────
 * The subject and the Developer see exactly the same response. `employees.md`:
 * *"Do not build a screen that expects a redacted variant for some readers;
 * there is not one."* Which is why this panel reuses the same components the
 * self-service page does, `readOnly` aside.
 *
 * ── ⚠ Reading the record does NOT disclose the documents ─────────────────────
 * It returns file ids. The bytes need `files.content.read`, audited per file and
 * fail-closed — two separate exposures, separately recorded. Every document here
 * still waits for a click.
 *
 * ── ⚠ Nothing here is editable except the employment block ───────────────────
 * And that is on its own route, its own permission and its own audit action. The
 * personal, identity, address, contact and payout halves have **no administrative
 * write path at all**.
 */
export function EmployeeRecordPanel({ adminId }: { adminId: string }) {
    const record = useAsyncData(`/employees/${adminId}`, (signal) =>
        getEmployeeRecord(adminId, { signal }),
    );

    if (record.isLoading) return <ListSkeleton rows={5} />;

    if (!record.data) {
        return (
            <ErrorState
                error={record.error}
                onRetry={record.reload}
                deniedTitle="Not available to you"
            />
        );
    }

    const employee = record.data;
    const mapUrl = googleMapsUrlFromGeoJson(employee.homeAddress?.coordinates?.coordinates);
    const payout = employee.payoutMethods[0];

    return (
        <div className="space-y-8">
            <EmployeeReadinessPanel readiness={employee.readiness} audience="reviewer" />

            <section className="space-y-3" aria-label="Personal">
                <h3 className="text-sm font-medium">Personal</h3>

                <DefinitionList className="rounded-lg border p-3 text-sm">
                    {/*
                      ⚠ Labelled "legal name" rather than "name". The account's
                      `displayName` is what colleagues call them; this is what the
                      state calls them, and a reviewer compares it against a
                      scanned card. They differ for ordinary reasons.
                    */}
                    <Definition label="Full legal name">
                        {employee.fullName ?? <NotSet />}
                    </Definition>
                    <Definition label="Date of birth">
                        {employee.dateOfBirth?.slice(0, 10) ?? <NotSet />}
                    </Definition>
                    <Definition label="Place of birth">
                        {employee.placeOfBirth ?? <NotSet />}
                    </Definition>
                    <Definition label="Nationality">
                        {employee.nationality ?? <NotSet />}
                    </Definition>
                    <Definition label="Mother">{employee.motherFullName ?? <NotSet />}</Definition>
                    <Definition label="Father">{employee.fatherFullName ?? <NotSet />}</Definition>

                    <Definition label="Identity document">
                        {employee.idNumber ? (
                            <span className="flex flex-wrap items-center gap-2">
                                <CopyableValue
                                    value={employee.idNumber}
                                    variant="plain"
                                    label="ID number"
                                />
                                <span className="text-muted-foreground text-xs">
                                    {employee.idType ?? 'type not stated'}
                                    {employee.idExpiresOn
                                        ? ` · expires ${employee.idExpiresOn.slice(0, 10)}`
                                        : ''}
                                </span>
                            </span>
                        ) : (
                            <NotSet />
                        )}
                    </Definition>

                    <Definition label="Phones">
                        {employee.phones.length > 0 ? (
                            <ul className="space-y-1">
                                {employee.phones.map((phone) => (
                                    <li key={phone.number}>
                                        <CopyableValue
                                            value={phone.number}
                                            variant="phone"
                                            label="phone"
                                        />
                                        {phone.label ? (
                                            <span className="text-muted-foreground text-xs">
                                                {' '}
                                                ({phone.label})
                                            </span>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <NotSet>None</NotSet>
                        )}
                    </Definition>

                    <Definition label="Home address">
                        {employee.homeAddress ? (
                            <span className="space-y-1">
                                <span className="block">
                                    {geoCandidateLabel(employee.homeAddress)}
                                </span>
                                {mapUrl ? (
                                    <a
                                        href={mapUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="text-primary text-xs hover:underline"
                                    >
                                        Open the pin
                                    </a>
                                ) : null}
                            </span>
                        ) : (
                            <NotSet />
                        )}
                    </Definition>

                    {/*
                      ⚠ Masked for EVERYBODY, the subject included — there is no
                      reveal route on this surface and none should be asked for.
                      Echoing an account number to anything that can read a profile
                      turns a session hijack into a banking leak, and nobody needs
                      the digits back.
                    */}
                    <Definition label="Payout destination">
                        {payout ? (
                            <span className="text-sm">
                                {payout.mobileMoney?.provider ?? payout.method}{' '}
                                <span className="text-muted-foreground">
                                    {payout.mobileMoney?.phoneNumberMasked ?? 'masked'}
                                </span>
                            </span>
                        ) : (
                            <NotSet>None set</NotSet>
                        )}
                    </Definition>
                </DefinitionList>
            </section>

            {/* No write path from here — every slot is read-only for a reviewer. */}
            <EmployeeDocumentsPanel record={employee} onChange={() => {}} readOnly />

            <EmployeeEmploymentPanel employment={employee.employment} />
        </div>
    );
}
