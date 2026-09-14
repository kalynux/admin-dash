import { useState } from 'react';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { ErrorState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { EmployeeDocumentsPanel } from '@/components/employees/EmployeeDocumentsPanel';
import { EmployeeReadinessPanel } from '@/components/employees/EmployeeReadinessPanel';
import { EmployeeRecordForm } from '@/components/employees/EmployeeRecordForm';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { getMyEmployeeRecord } from '@/services/employees.service';
import { useAuth } from '@/store';
import type { EmployeeRecord } from '@/types/employees.types';

/**
 * Where a `pending` administrator lands. **ADR-023.**
 *
 * ── ⚠ Why this screen exists at all ──────────────────────────────────────────
 * Every new account is created `pending`, and a pending administrator signs in
 * perfectly normally — the credential check, MFA and refresh all work — and is
 * then refused every route outside their own account with
 * `403 ADMIN_ACTIVATION_REQUIRED`. Without somewhere to send them, the dashboard
 * mounts, the sidebar renders, and every link on it fails.
 * `administrators.md` puts it plainly: *"every new hire's first morning looks
 * like a fault."*
 *
 * ── ⚠ Not an error page, and the copy carries the difference ─────────────────
 * *"Not let in yet" is not "shut out."* A suspension is somebody's decision about
 * you and the remedy is a conversation; this is a queue, and the remedy is a form
 * only you can fill in. The page is a task list, not an apology.
 *
 * ── ⚠ It uses `AuthLayout`, not the dashboard shell ──────────────────────────
 * The shell renders navigation, and **every item on it points at a route this
 * session is refused**. Rendering navigation that cannot be used is the trap
 * `App.tsx` already refuses for the MFA-enrolment session, for the same reason.
 *
 * ── What they can actually reach from here ───────────────────────────────────
 * `GET`/`PATCH /employees/me`, the document uploads, `GET /geo/*` for the address
 * — plus their own session and credentials. That is the whole allowlist, and it
 * is exactly what this page needs.
 */
export function Onboarding() {
    const { admin, signOut } = useAuth();
    const [record, setRecord] = useState<EmployeeRecord | null>(null);

    const loaded = useAsyncData('/employees/me', (signal) => getMyEmployeeRecord({ signal }));

    /*
      ⚠ Every write on this page answers the WHOLE record with `readiness`
      recomputed, so the checklist updates from the same response that changed it.
      Refetching to find out would be a second call that can disagree with the
      first.
    */
    const current = record ?? loaded.data ?? null;

    return (
        <AuthLayout
            title={`Welcome${admin?.displayName ? `, ${admin.displayName}` : ''}`}
            description="Your account is created and waiting to be activated. Finish this and a Developer can let you in."
            width="lg"
        >
            <div className="space-y-6">
                {loaded.isLoading ? <ListSkeleton rows={4} /> : null}

                {loaded.error && !current ? (
                    <ErrorState error={loaded.error} onRetry={loaded.reload} />
                ) : null}

                {current ? (
                    <>
                        <EmployeeReadinessPanel readiness={current.readiness} audience="subject" />

                        <EmployeeRecordForm record={current} onSaved={setRecord} />

                        <EmployeeDocumentsPanel record={current} onChange={setRecord} />

                        {/*
                          ⚠ There is no "submit for review" button, and there is no
                          route for one. Activation is somebody else's act, gated on
                          the same `readiness` block this page renders — so the
                          honest instruction is "tell them", not a control that
                          would do nothing.
                        */}
                        <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
                            There is nothing to submit — a Developer can see this list from their
                            side, and activates the account once it is empty. Tell them when you
                            are done. You can change any of this later; the record stays yours to
                            edit after activation.
                        </p>
                    </>
                ) : null}

                <div className="flex justify-end border-t pt-4">
                    <Button variant="outline" size="sm" onClick={() => void signOut()}>
                        Sign out
                    </Button>
                </div>
            </div>
        </AuthLayout>
    );
}
