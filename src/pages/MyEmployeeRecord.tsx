import { useState } from 'react';

import { ErrorState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { EmployeeDocumentsPanel } from '@/components/employees/EmployeeDocumentsPanel';
import { EmployeeEmploymentPanel } from '@/components/employees/EmployeeEmploymentPanel';
import { EmployeeReadinessPanel } from '@/components/employees/EmployeeReadinessPanel';
import { EmployeeRecordForm } from '@/components/employees/EmployeeRecordForm';
import { PageContainer } from '@/components/layout/PageContainer';
import { useAsyncData } from '@/hooks/use-async-data';
import { getMyEmployeeRecord } from '@/services/employees.service';
import type { EmployeeRecord } from '@/types/employees.types';

/**
 * Your own employee record, inside the dashboard. **ADR-023.**
 *
 * The same five self-service routes `/onboarding` uses — this is where they live
 * once the account is activated, because **there is no lock**. `employees.md` is
 * explicit that an employee can edit their record forever, unlike the applicant
 * record, which freezes on submission: *"They move house, change their phone,
 * switch bank. The activation decision is about the person, not about a snapshot
 * of their paperwork, and every later change is audited."*
 *
 * ⚠ **Self-service, so no permission gates it** — `/employees/me` is declared
 * *self*, the same rule as `/administrators/me` and `/auth/*`. Gating it would
 * let a level be locked out of its own record.
 *
 * ⚠ **`employment` is read-only here and always will be.** It is what the company
 * states *to* this person, written by a tier-1 Developer on the other route:
 * *"An employee states their own facts; the company states its terms."*
 */
export function MyEmployeeRecord() {
    const [record, setRecord] = useState<EmployeeRecord | null>(null);
    const loaded = useAsyncData('/employees/me', (signal) => getMyEmployeeRecord({ signal }));

    /* Every write answers the whole record with `readiness` recomputed. */
    const current = record ?? loaded.data ?? null;

    return (
        <PageContainer
            title="Employee record"
            description="What the company holds about you. Most of it is yours to keep up to date."
        >
            {loaded.isLoading ? <ListSkeleton rows={5} /> : null}

            {loaded.error && !current ? (
                <ErrorState error={loaded.error} onRetry={loaded.reload} />
            ) : null}

            {current ? (
                <div className="space-y-8">
                    {/*
                      Shown only while something is outstanding. On an activated
                      account it is usually empty, and a green "all done" banner on
                      a page somebody opened to change their phone number is noise.
                    */}
                    {current.readiness.ready ? null : (
                        <EmployeeReadinessPanel readiness={current.readiness} audience="subject" />
                    )}

                    <EmployeeRecordForm record={current} onSaved={setRecord} />

                    <EmployeeDocumentsPanel record={current} onChange={setRecord} />

                    <EmployeeEmploymentPanel employment={current.employment} />
                </div>
            ) : null}
        </PageContainer>
    );
}
