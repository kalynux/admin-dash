import { useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatInstantInZone } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
    buildChecks,
    draftVerdictText,
    estimateVerdict,
    preselectedVerdict,
} from '@/lib/verification-review';
import type {
    CurrentVerdict,
    VerdictOption,
    PartyVerification,
    VerificationParty,
} from '@/types/verification.types';
import { VERDICT_REASON_MAX, VERDICT_REASON_MIN } from '@/types/verification.types';

import { VerdictEstimateBadge } from './VerdictEstimateBadge';

/** Every field name the three verdict routes can report against the text box. */
const TEXT_FIELD_NAMES = ['reason', 'rejectionReason', 'note', 'text'] as const;

/**
 * One review dialog for all three parties: **see the evidence, then decide.**
 *
 * ── Why the verdict is chosen inside the dialog and not before it ────────────
 * Every one of these three surfaces used to put the verdict buttons in the page
 * toolbar — *Approve verification* / *Reject verification* — so the operator
 * picked an outcome and was then shown a form about it. That ordering is the
 * whole of the complaint this dialog answers: there was nothing to look at
 * either way, so the toolbar was not really offering a choice, it was offering
 * two ways to record one that had already been made somewhere else. Here the
 * evidence comes first and the verdict is a control inside it.
 *
 * ── ⚠ The estimate never narrows what the operator may do ────────────────────
 * `preselectedVerdict` may open the dialog on a suggestion, and an
 * `indeterminate` estimate opens it on none. **Every option stays selectable
 * regardless** — approving a party whose paperwork is short is a legitimate and
 * ordinary act (the documents may have arrived by another route), and a dialog
 * that disabled it would push that decision off-platform where nothing records
 * it. What the estimate changes is the default and the drafted text, never the
 * permission.
 *
 * ── ⚠ The draft stops as soon as the operator types ──────────────────────────
 * Switching verdicts re-drafts the text **only while the field is untouched**.
 * Once it has been edited, changing the verdict leaves it alone: silently
 * replacing a sentence somebody wrote — which on a rejection is forwarded to the
 * applicant and stored on their record — is the one thing a convenience feature
 * here must never do.
 */
export interface VerificationReviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Which checklist to build. */
    party: VerificationParty;
    /** Whose review this is, for the title. */
    subjectName: string;
    title: string;
    description: ReactNode;
    /**
     * The verification record, **already loaded by the panel that opened this**.
     *
     * ⚠ Passed in rather than fetched here, and it matters: the evidence tab is
     * where the operator has just been reading the documents, so re-requesting
     * would risk showing a verdict form built on a *different* snapshot from the
     * one they looked at. `null` means the read failed or the account has none —
     * every row then reports `unavailable`, and the estimate declines to guess.
     */
    record: PartyVerification | null;
    /** The verdict on the record now, so the dialog can say what it is changing. */
    current: CurrentVerdict;
    /**
     * What the reviewer may record. **Only verdicts that would change
     * something** — asking a surface for the verdict it already holds is a `409`
     * on all three, so an option that could only ever produce one is not an
     * option. The caller filters, because only it knows the conflict rule.
     */
    options: VerdictOption[];
    /**
     * Perform the write. Throwing surfaces the error in the dialog; resolving
     * closes it. Conflict handling (`409`) belongs to the caller, which knows
     * which platform code its surface produces.
     */
    onSubmit: (verdict: string, text: string) => Promise<void>;
    /** IANA zone for the "decided at" line — the operator's, not the party's. */
    timeZone: string;
    /**
     * Controls this surface needs that the other two do not — the agent's
     * off-platform `reference`, today the only one.
     *
     * The caller owns their state and reads it in its own `onSubmit` closure, so
     * the shell stays ignorant of a field that exists on one route out of three.
     * Rendered under the verdict, above the reason.
     */
    extraFields?: ReactNode;
    /**
     * What the record already carries that bears on the decision: a registration
     * number, a licence id, an off-platform reference, the addresses on file.
     * Rendered under the checklist, because it is context and not evidence.
     */

}

export function VerificationReviewDialog(props: VerificationReviewDialogProps) {
    const { open, onOpenChange, title, description } = props;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/*
              ⚠ **Bounded height, or this dialog runs off the top AND bottom of a
              laptop screen.** `DialogContent` is centred with
              `translate-y-[-50%]` and carries **no** max-height of its own, so a
              tall child simply overflows the viewport in both directions with
              nothing to scroll — the evidence checklist plus the verdict options
              plus a reason field clears 100vh easily.

              `grid-rows-[auto_minmax(0,1fr)]` is the load-bearing half:
              `DialogContent` is already `grid`, and a `1fr` row without
              `minmax(0, …)` takes its min-content height from the child, which
              defeats the inner `overflow-y-auto` entirely.

              `dvh` rather than `vh` so a mobile browser's retracting toolbar does
              not clip the footer.
            */}
            <DialogContent className="grid-rows-[auto_minmax(0,1fr)] max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                {/* Radix unmounts this when the dialog closes, which is what resets
                    the draft, the selection and any error — no effect needed. */}
                <ReviewForm {...props} />
            </DialogContent>
        </Dialog>
    );
}

function ReviewForm({
    party,
    subjectName,
    record,
    current,
    options,
    onSubmit,
    onOpenChange,
    timeZone,
    extraFields,
}: VerificationReviewDialogProps) {
    const checks = useMemo(() => buildChecks(party, record), [party, record]);
    const estimate = useMemo(() => estimateVerdict(checks, record), [checks, record]);

    const suggested = useMemo(() => preselectedVerdict(estimate, options), [estimate, options]);

    const [verdict, setVerdict] = useState<string | null>(suggested?.value ?? null);
    const [text, setText] = useState(() => (suggested ? draftVerdictText(estimate, suggested) : ''));
    const [textEdited, setTextEdited] = useState(false);
    const [textError, setTextError] = useState<string | null>(null);
    const [formError, setFormError] = useState<unknown>(null);
    const [submitting, setSubmitting] = useState(false);

    const selected = options.find((option) => option.value === verdict) ?? null;

    function chooseVerdict(value: string) {
        setVerdict(value);
        setTextError(null);

        const option = options.find((candidate) => candidate.value === value);
        // See the header: the draft is a convenience, and it yields the moment
        // there is something of the operator's own to overwrite.
        if (option && !textEdited) setText(draftVerdictText(estimate, option));
    }

    function validate(option: VerdictOption, value: string): string | null {
        const trimmed = value.trim();
        if (option.textMode === 'none') return null;
        if (option.textMode === 'required-reason') {
            if (trimmed.length < VERDICT_REASON_MIN) {
                return `A reason is required — ${subjectName} is shown it. Give at least ${VERDICT_REASON_MIN} characters.`;
            }
        }
        if (trimmed.length > VERDICT_REASON_MAX) {
            return `Use at most ${VERDICT_REASON_MAX} characters.`;
        }
        return null;
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!selected) return;

        const message = validate(selected, text);
        setTextError(message);
        if (message) return;

        setFormError(null);
        setSubmitting(true);
        try {
            await onSubmit(selected.value, selected.textMode === 'none' ? '' : text.trim());
        } catch (error) {
            /*
              A server-side complaint about the text belongs *on* the text, not in
              a banner above it. The four names are every field the three routes
              can report against this one control — `note` and `reason` on
              `/vendors`, `reason` on `/agencies`, `rejectionReason` on `/agents`.
              Anything else is a fault with the request rather than with what was
              typed, and reads better as a banner.
            */
            const fieldErrors = pickFieldErrors(error, TEXT_FIELD_NAMES);
            const reported =
                fieldErrors.reason ??
                fieldErrors.rejectionReason ??
                fieldErrors.note ??
                fieldErrors.text;
            if (reported) setTextError(reported);
            else setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    const decidedAt = formatInstantInZone(current.decidedAt, timeZone);

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col gap-4">
            {/*
              Only the evidence scrolls. The verdict options and the footer stay
              put, so the operator can always see what they are about to record —
              a dialog that scrolls as a whole hides the buttons exactly when the
              checklist is long, which is when the decision is hardest.

              `min-h-0` is required on a flex child that scrolls; without it the
              default `min-height: auto` refuses to shrink and the overflow moves
              back out to the dialog.
            */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <CurrentVerdictLine current={current} decidedAt={decidedAt} />

                {/*
                  ⚠ **The evidence is NOT repeated here, deliberately.** The
                  checklist, the documents and the record context all sit on the
                  Verification tab immediately behind this dialog — the operator
                  has just read them, and reprinting them made the dialog taller
                  than the viewport while answering a question nobody had.

                  What stays is the **estimate**, because it is the one thing that
                  is not on the tab in this form: it is what preselected the
                  verdict below and drafted the text, so hiding it would leave
                  both looking like they came from nowhere.

                  ⚠ It still narrows nothing — every option below stays
                  selectable whatever this says.
                */}
                <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border p-3">
                    <VerdictEstimateBadge estimate={estimate} />
                    <span className="text-muted-foreground text-xs">
                        From the checklist on the Verification tab.
                    </span>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Verdict</Label>
                {/*
                  No default when the estimate is `indeterminate`. A dialog that
                  opens with an outcome already selected has answered the question
                  the operator was opened to answer.
                */}
                <RadioGroup
                    value={verdict ?? ''}
                    onValueChange={chooseVerdict}
                    className="gap-2"
                    aria-label="Verdict"
                >
                    {options.map((option) => (
                        <label
                            key={option.value}
                            htmlFor={`verdict-${option.value}`}
                            className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
                                verdict === option.value && 'border-primary bg-accent/40',
                            )}
                        >
                            <RadioGroupItem
                                id={`verdict-${option.value}`}
                                value={option.value}
                                className="mt-0.5"
                            />
                            <span className="space-y-0.5">
                                <span className="block font-medium">{option.label}</span>
                                <span className="text-muted-foreground block text-xs leading-relaxed">
                                    {option.description}
                                </span>
                            </span>
                        </label>
                    ))}
                </RadioGroup>
            </div>

            {extraFields}

            {selected && selected.textMode !== 'none' ? (
                <FormField
                    id="verification-verdict-text"
                    label={selected.textLabel ?? 'Reason'}
                    error={textError ?? undefined}
                    hint={selected.textHint}
                >
                    {(field) => (
                        <Textarea
                            rows={3}
                            maxLength={VERDICT_REASON_MAX}
                            placeholder={selected.textPlaceholder}
                            value={text}
                            onChange={(event) => {
                                setText(event.target.value);
                                setTextEdited(true);
                            }}
                            {...field}
                        />
                    )}
                </FormField>
            ) : null}

            {selected && selected.textMode === 'none' ? (
                <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                    This verdict takes no text. Your name and the time are recorded on the record
                    and in the audit trail.
                </p>
            ) : null}

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={submitting}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant={selected?.destructive ? 'destructive' : 'default'}
                    disabled={submitting || !selected}
                >
                    {submitting ? <InlineLoader label="Recording…" /> : null}
                    {selected ? selected.label : 'Choose a verdict'}
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * What the record says now.
 *
 * ⚠ **The last rejection reason is shown, and it matters more than it looks.**
 * A party who was refused and has come back is the commonest thing in this
 * queue, and the useful question is *did they fix the thing they were told
 * about* — which cannot be asked without the sentence they were told.
 */
function CurrentVerdictLine({
    current,
    decidedAt,
}: {
    current: CurrentVerdict;
    decidedAt: string | null;
}) {
    return (
        <div className="bg-muted/40 space-y-1 rounded-lg border p-3 text-xs">
            <p>
                <span className="text-muted-foreground">Current verdict: </span>
                <span className="font-medium capitalize">{current.status}</span>
                {decidedAt ? <span className="text-muted-foreground"> · {decidedAt}</span> : null}
                {current.decidedBy?.name ? (
                    <span className="text-muted-foreground"> · {current.decidedBy.name}</span>
                ) : null}
            </p>
            {current.reason ? (
                <p className="text-muted-foreground leading-relaxed">
                    Last reason given to them: &ldquo;{current.reason}&rdquo;
                </p>
            ) : null}
        </div>
    );
}
