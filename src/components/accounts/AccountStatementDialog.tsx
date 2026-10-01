import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { Can } from '@/components/auth/Can';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { calendarDayInZone, formatCalendarDay, parseCalendarDay } from '@/lib/datetime';
import { formatBytes } from '@/lib/format';
import { notify } from '@/lib/notify';
import { saveFile } from '@/lib/save-file';
import { cn } from '@/lib/utils';
import {
    ACCOUNT_STATEMENT_PERMISSION,
    downloadAccountStatement,
    emailAccountStatement,
} from '@/services/accounts.service';
import {
    CODE_STATEMENT_TOO_LARGE_TO_EMAIL,
    PLATFORM_CODE_STATEMENT_RECIPIENT_MISSING,
    PLATFORM_CODE_STATEMENT_RECIPIENT_UNVERIFIED,
    STATEMENT_MAX_DAYS,
    type AccountOwnerType,
    type StatementDelivery,
    type StatementEmailResult,
    type StatementFormat,
    type StatementRequest,
} from '@/types/accounts.types';
import { ApiError } from '@/types/api.types';

const DAY_MS = 86_400_000;

/**
 * The **Statement** button, gated on `money.statements.send`.
 *
 * ⚠ **Every tier holds it, Support included** (owner decision 2026-09-27), and
 * that is why this sits in the page header rather than inside the Account tab:
 * the tab needs `ACCOUNT_READ_PERMISSIONS`, which Support does not hold, so a
 * button inside it would be one Support could never reach. Do not move it there.
 */
export function AccountStatementButton({
    ownerType,
    ownerId,
    timeZone,
}: {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <Can permission={ACCOUNT_STATEMENT_PERMISSION}>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <FileSpreadsheet className="size-4" />
                Statement
            </Button>
            {open ? (
                <AccountStatementDialog
                    ownerType={ownerType}
                    ownerId={ownerId}
                    timeZone={timeZone}
                    open={open}
                    onOpenChange={setOpen}
                />
            ) : null}
        </Can>
    );
}

/** Which refusal the email met, reduced to the remedy the operator needs. */
type EmailRefusal = 'no-verified-email' | 'too-large';

function emailRefusalOf(error: unknown): EmailRefusal | null {
    if (!(error instanceof ApiError)) return null;
    if (error.code === CODE_STATEMENT_TOO_LARGE_TO_EMAIL) return 'too-large';
    if (
        error.platformCode === PLATFORM_CODE_STATEMENT_RECIPIENT_MISSING ||
        error.platformCode === PLATFORM_CODE_STATEMENT_RECIPIENT_UNVERIFIED
    ) {
        return 'no-verified-email';
    }
    return null;
}

/**
 * The period check the server makes (`statement-period.ts`), made first so an
 * impossible range costs no audit row: both days real, `from` not after `to`,
 * and at most 366 days **counting both ends**.
 */
function periodProblem(from: string, to: string): string | null {
    const start = parseCalendarDay(from);
    const end = parseCalendarDay(to);
    if (!start || !end) return 'Choose both a first and a last day.';

    const startMs = Date.UTC(start.year, start.month - 1, start.day);
    const endMs = Date.UTC(end.year, end.month - 1, end.day);
    if (startMs > endMs) return 'The first day must not be after the last day.';

    const days = Math.round((endMs - startMs) / DAY_MS) + 1;
    if (days > STATEMENT_MAX_DAYS) {
        return `A statement covers at most ${STATEMENT_MAX_DAYS} days. Choose a shorter period.`;
    }
    return null;
}

const FORMAT_OPTIONS: { value: StatementFormat; label: string; description: string }[] = [
    {
        value: 'xlsx',
        label: 'Excel',
        description: 'Every section, including the wide per-order tables.',
    },
    {
        value: 'pdf',
        label: 'PDF',
        description: 'The summary and the narrower tables. The per-order tables are in Excel only.',
    },
];

const DELIVERY_OPTIONS: { value: StatementDelivery; label: string; description: string }[] = [
    {
        value: 'download',
        label: 'Download',
        description: 'Save the file to this computer.',
    },
    {
        value: 'email',
        label: 'Email to the account holder',
        description:
            'Sent only to the email address registered on the account, and only if it is verified. You cannot choose another address.',
    },
];

/**
 * `POST /accounts/:ownerType/:ownerId/statements` · `money.statements.send`.
 *
 * ── Every request is audited, including a refused one ─────────────────────────
 * The audit row is written before anything is read, so a failed email is still
 * on the owner's activity feed, stamped `failed`. The copy says so rather than
 * implying a refusal left no trace.
 *
 * ── The three email refusals share one remedy ─────────────────────────────────
 * No address on file, an unverified address (both jovi-mall's, as
 * `details.platformCode` on a 409) and a file over 8 MB (wi-admin's own 413)
 * all end at *"download it instead"* — so each renders a notice with a button
 * that sends the same period as a download. Too large also offers a shorter
 * period, which is the one remedy that still lets the email go.
 *
 * ── The recipient is masked, and is the confirmation ──────────────────────────
 * `recipient` arrives as `j***@example.com`. It is enough to tell the operator
 * where the file went and never the full address, so it is shown as given.
 */
export function AccountStatementDialog({
    ownerType,
    ownerId,
    timeZone,
    open,
    onOpenChange,
}: {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const today = calendarDayInZone(new Date(), timeZone);
    const [from, setFrom] = useState(() => formatCalendarDay({ ...today, day: 1 }));
    const [to, setTo] = useState(() => formatCalendarDay(today));
    const [format, setFormat] = useState<StatementFormat>('xlsx');
    const [delivery, setDelivery] = useState<StatementDelivery>('download');
    const [busy, setBusy] = useState(false);
    const [periodError, setPeriodError] = useState<string | null>(null);
    const [formError, setFormError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<EmailRefusal | null>(null);
    const [emailed, setEmailed] = useState<StatementEmailResult | null>(null);

    function clearOutcome() {
        setPeriodError(null);
        setFormError(null);
        setRefusal(null);
    }

    async function submit(chosen: StatementDelivery) {
        clearOutcome();
        const problem = periodProblem(from, to);
        if (problem) {
            setPeriodError(problem);
            return;
        }

        const request: StatementRequest = { from, to, format };
        setBusy(true);
        try {
            if (chosen === 'download') {
                const file = await downloadAccountStatement(ownerType, ownerId, request);
                saveFile(file.blob, file.fileName);
                notify.success('Statement downloaded', {
                    description: `${file.fileName} — the request is recorded in the ${ownerType}'s activity trail.`,
                });
                onOpenChange(false);
            } else {
                setEmailed(await emailAccountStatement(ownerType, ownerId, request));
            }
        } catch (error) {
            const kind = chosen === 'email' ? emailRefusalOf(error) : null;
            if (kind) setRefusal(kind);
            else setFormError(error);
        } finally {
            setBusy(false);
        }
    }

    function downloadInstead() {
        setDelivery('download');
        void submit('download');
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Account statement</DialogTitle>
                    <DialogDescription>
                        Orders, fees, cash on delivery, refunds, payouts, credits and plans for this{' '}
                        {ownerType}, over the period you choose. Every request is recorded in the
                        audit trail.
                    </DialogDescription>
                </DialogHeader>

                {emailed ? (
                    <EmailedConfirmation result={emailed} onDone={() => onOpenChange(false)} />
                ) : (
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submit(delivery);
                        }}
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="statement-from">First day</Label>
                                <Input
                                    id="statement-from"
                                    type="date"
                                    value={from}
                                    onChange={(event) => {
                                        setFrom(event.target.value);
                                        clearOutcome();
                                    }}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="statement-to">Last day</Label>
                                <Input
                                    id="statement-to"
                                    type="date"
                                    value={to}
                                    onChange={(event) => {
                                        setTo(event.target.value);
                                        clearOutcome();
                                    }}
                                />
                            </div>
                        </div>
                        <p className="text-muted-foreground text-xs">
                            Both days are included, read in Douala time (UTC+01:00). At most{' '}
                            {STATEMENT_MAX_DAYS} days.
                        </p>
                        {periodError ? (
                            <p role="alert" className="text-destructive text-sm">
                                {periodError}
                            </p>
                        ) : null}

                        <ChoiceGroup
                            name="statement-format"
                            legend="Format"
                            value={format}
                            options={FORMAT_OPTIONS}
                            onChange={(value) => {
                                setFormat(value);
                                clearOutcome();
                            }}
                        />
                        <ChoiceGroup
                            name="statement-delivery"
                            legend="Delivery"
                            value={delivery}
                            options={DELIVERY_OPTIONS}
                            onChange={(value) => {
                                setDelivery(value);
                                clearOutcome();
                            }}
                        />

                        {refusal ? (
                            <EmailRefusalNotice
                                refusal={refusal}
                                busy={busy}
                                onDownload={downloadInstead}
                            />
                        ) : null}
                        {formError ? <AuthFormError error={formError} /> : null}

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={busy}>
                                {busy ? <InlineLoader /> : null}
                                {delivery === 'email' ? 'Email statement' : 'Download statement'}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function ChoiceGroup<T extends string>({
    name,
    legend,
    value,
    options,
    onChange,
}: {
    name: string;
    legend: string;
    value: T;
    options: { value: T; label: string; description: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{legend}</legend>
            <RadioGroup
                value={value}
                onValueChange={(next) => onChange(next as T)}
                className="gap-2"
                aria-label={legend}
            >
                {options.map((option) => (
                    <label
                        key={option.value}
                        htmlFor={`${name}-${option.value}`}
                        className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
                            value === option.value && 'border-primary bg-accent/40',
                        )}
                    >
                        <RadioGroupItem
                            id={`${name}-${option.value}`}
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
        </fieldset>
    );
}

function EmailRefusalNotice({
    refusal,
    busy,
    onDownload,
}: {
    refusal: EmailRefusal;
    busy: boolean;
    onDownload: () => void;
}) {
    return (
        <div
            role="alert"
            className="border-warning/40 bg-warning/5 space-y-2 rounded-lg border px-3 py-2 text-sm"
        >
            {refusal === 'too-large' ? (
                <>
                    <p className="font-medium">This statement is too large to email.</p>
                    <p className="text-muted-foreground">
                        The file is over the 8 MB mail providers accept, so nothing was sent.
                        Download it instead, or choose a shorter period and email that.
                    </p>
                </>
            ) : (
                <>
                    <p className="font-medium">No verified email address — download it instead.</p>
                    <p className="text-muted-foreground">
                        The statement can only be emailed to the address registered on the account,
                        and this account has none, or has not verified it. Nothing was sent.
                    </p>
                </>
            )}
            <p className="text-muted-foreground text-xs">
                The attempt is still recorded in the audit trail.
            </p>
            <Button type="button" size="sm" onClick={onDownload} disabled={busy}>
                {busy ? <InlineLoader /> : null}
                Download instead
            </Button>
        </div>
    );
}

function EmailedConfirmation({
    result,
    onDone,
}: {
    result: StatementEmailResult;
    onDone: () => void;
}) {
    return (
        <div className="space-y-4">
            <div role="status" className="bg-muted/50 space-y-1 rounded-lg border px-3 py-2 text-sm">
                {result.sent ? (
                    <p className="font-medium">Statement emailed to {result.recipient}</p>
                ) : (
                    <p className="font-medium">
                        The statement was prepared for {result.recipient}, but the platform did not
                        confirm it was sent.
                    </p>
                )}
                <p className="text-muted-foreground">
                    {result.fileName} · {formatBytes(result.bytes)}
                </p>
                <p className="text-muted-foreground text-xs">
                    The address is shown masked. Only the account&rsquo;s registered, verified
                    address can receive a statement.
                </p>
            </div>
            <DialogFooter>
                <Button type="button" onClick={onDone}>
                    Done
                </Button>
            </DialogFooter>
        </div>
    );
}
