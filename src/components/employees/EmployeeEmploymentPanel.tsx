import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { formatMoney } from '@/lib/format';
import { humaniseEnum } from '@/lib/format';
import type { EmployeeEmployment } from '@/types/employees.types';

/**
 * The employment terms — **what the company states to this person.**
 *
 * ⚠ **Read-only on every screen that is not the tier-1 editor.** The employee
 * reads it and cannot write it; `PATCH /employees/me` refuses the key with a
 * `400`. *"An employee states their own facts; the company states its terms."*
 *
 * 🔴 **`monthlySalaryMinor` is in MINOR CURRENCY UNITS, and it is the one money
 * field on this dashboard that is.** Everywhere else on wi-admin money is *"a
 * plain number in the account currency … never divide by 100"*, so the reflex
 * built by every other screen is wrong exactly here. `450000` with `XAF` is
 * 450,000 FCFA — the same number, because XAF has no subdivision — which is
 * precisely why a currency that *does* subdivide would be rendered a hundred
 * times too large by a screen that forgot. {@link displayableSalary} is the one
 * place the conversion happens.
 */
export function EmployeeEmploymentPanel({
    employment,
}: {
    employment: EmployeeEmployment | null;
}) {
    return (
        <section className="space-y-3" aria-label="Employment">
            <div className="space-y-1">
                <h3 className="text-sm font-medium">Employment</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                    Set by the company. You cannot change it here — raise anything wrong with a
                    Developer.
                </p>
            </div>

            {employment ? (
                <DefinitionList className="rounded-lg border p-3 text-sm">
                    <Definition label="Position">{employment.position ?? <NotSet />}</Definition>
                    <Definition label="Department">
                        {employment.department ?? <NotSet />}
                    </Definition>
                    <Definition label="Type">
                        {humaniseEnum(employment.employmentType) ?? <NotSet />}
                    </Definition>
                    <Definition label="Staff number">
                        {employment.staffNumber ?? <NotSet />}
                    </Definition>
                    <Definition label="Started">
                        {calendarDay(employment.startedOn) ?? <NotSet />}
                    </Definition>
                    <Definition label="Ended">
                        {calendarDay(employment.endedOn) ?? (
                            <NotSet>Still employed</NotSet>
                        )}
                    </Definition>
                    <Definition label="Monthly salary">
                        {displayableSalary(employment) ?? <NotSet />}
                    </Definition>
                    {employment.notes ? (
                        <Definition label="Notes">{employment.notes}</Definition>
                    ) : null}
                </DefinitionList>
            ) : (
                <p className="text-muted-foreground rounded-lg border p-3 text-sm">
                    Nothing recorded yet. A Developer fills this in.
                </p>
            )}
        </section>
    );
}

/**
 * Minor units → the displayable figure.
 *
 * ⚠ **XAF has no subdivision, so the two are the same number** — which is why
 * this must not be written as "it's already right for XAF". A deployment that
 * ever records a salary in a currency with cents would otherwise render it a
 * hundred times too large, and the bug would be invisible on every existing row.
 * `Intl` knows each currency's exponent; `formatMoney` renders the major figure.
 */
function displayableSalary(employment: EmployeeEmployment): string | null {
    const { monthlySalaryMinor, currency } = employment;
    if (monthlySalaryMinor === null) return null;

    const exponent = minorUnitExponent(currency);
    return formatMoney(monthlySalaryMinor / 10 ** exponent, currency);
}

/** How many minor units make one major unit. `0` for XAF, `2` for most others. */
function minorUnitExponent(currency: string | null): number {
    if (!currency) return 0;
    try {
        const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions();
        return parts.maximumFractionDigits ?? 0;
    } catch {
        // An unrecognised code is a data problem, not a reason to render nothing.
        // Treat it as unsubdivided, which is right for every currency on this
        // platform today.
        return 0;
    }
}

/** The read returns midnight UTC; slice rather than parse. See `EmployeeRecordForm`. */
function calendarDay(iso: string | null): string | null {
    return iso ? iso.slice(0, 10) : null;
}
