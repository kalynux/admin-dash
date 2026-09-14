import { Check, CircleDashed } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { gapsBySection, type EmployeeReadiness } from '@/types/employees.types';

const SECTION_LABELS: Record<string, string> = {
    security: 'Two-factor',
    personal: 'About you',
    identity: 'Identity document',
    address: 'Where you live',
    contact: 'How to reach you',
    payout: 'Where you are paid',
    documents: 'Documents',
};

/**
 * What is still missing before this account can be activated.
 *
 * 🔴 **This list comes from the server and is never computed here**, which is the
 * opposite of the applicant checklist next door in `verification-review.ts` — and
 * the asymmetry is deliberate on the backend's side, not an inconsistency.
 * `employees.md` gives the reasoning: an applicant is a member of the public, and
 * refusing their submission for incompleteness denies them the one thing they
 * need — to be told by a human what is missing. An employee is somebody about to
 * be handed administrative access, and the Developer activating them is a
 * colleague who can say what is missing in a message.
 *
 * ⚠ **The same `readiness` block is on the reviewer's read and on the subject's
 * own**, computed once — *"so the button the Developer sees disabled and the list
 * the employee sees outstanding can never disagree."* Rendering a second
 * checklist anywhere in this dashboard would break that guarantee, which is why
 * this component takes `readiness` and derives nothing.
 *
 * ⚠ It also arrives as `details.gaps` on a `422 ADMIN_ACTIVATION_INCOMPLETE`, so
 * the activation dialog renders **these same codes** without a second call.
 */
export function EmployeeReadinessPanel({
    readiness,
    className,
    /** Softens the copy for the subject, who is being asked rather than assessed. */
    audience = 'subject',
}: {
    readiness: EmployeeReadiness;
    className?: string;
    audience?: 'subject' | 'reviewer';
}) {
    const sections = [...gapsBySection(readiness)];

    if (readiness.ready) {
        return (
            <div
                className={cn(
                    'border-success/30 bg-success/10 flex items-start gap-2 rounded-lg border p-3 text-sm',
                    className,
                )}
            >
                <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="leading-relaxed">
                    <span className="font-medium">Everything needed is on file.</span>{' '}
                    {audience === 'subject'
                        ? 'A Developer can activate the account now — you do not have to do anything else.'
                        : 'Nothing blocks activation.'}
                </p>
            </div>
        );
    }

    return (
        <section className={cn('space-y-3', className)} aria-label="What is still needed">
            <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                    {audience === 'subject' ? 'Still to do' : 'Not complete yet'}
                </h3>
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                    {readiness.gaps.length} outstanding
                </Badge>
            </header>

            {audience === 'subject' ? (
                <p className="text-muted-foreground text-xs leading-relaxed">
                    The account is created and you can sign in — it just cannot reach the dashboard
                    until a Developer activates it, and they cannot do that until this list is
                    empty. Most of it is yours to fill in.
                </p>
            ) : null}

            <ul className="divide-y rounded-lg border">
                {sections.map(([section, gaps]) => (
                    <li key={section} className="space-y-1.5 p-3">
                        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                            {SECTION_LABELS[section] ?? section}
                        </p>
                        <ul className="space-y-1">
                            {gaps.map((gap) => (
                                <li key={gap.code} className="flex items-start gap-2 text-sm">
                                    <CircleDashed
                                        className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                                        aria-hidden
                                    />
                                    {/*
                                      The server's own sentence, written for the
                                      employee. Rewriting it here would be a second
                                      copy of a rule that lives on the backend.
                                    */}
                                    <span className="leading-relaxed">{gap.message}</span>
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>
        </section>
    );
}
