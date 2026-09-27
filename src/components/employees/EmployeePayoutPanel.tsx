import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { updateMyEmployeeRecord } from '@/services/employees.service';
import type { EmployeeRecord, UpdateEmployeeRecordBody } from '@/types/employees.types';

/**
 * The wallet names the platform already stores on a vendor's, agency's and agent's
 * payout destination (vendor-dash `paymentBrands.ts` → `payoutValue`). wi-admin
 * takes `provider` as free text; offering the same five strings keeps one wallet
 * spelled one way across both databases.
 */
const MOBILE_MONEY_PROVIDERS = [
    'MTN Mobile Money',
    'Orange Money',
    'Airtel Money',
    'Moov Money',
    'Wave',
] as const;

/** `employees.md`: at most three entries; index `0` is the preferred one. */
const MAX_DESTINATIONS = 3;

interface Draft {
    provider: string;
    phoneNumber: string;
    accountName: string;
}

/**
 * Where the company sends this person's salary — `PATCH /employees/me` with
 * `payoutMethods` alone. **ADR-023.** Closes the `payout_missing` gap.
 *
 * ── ⚠ Saved destinations can never be edited in place ────────────────────────
 * They come back **masked for everybody, the subject included**, and
 * `payoutMethods` is a **full replace**. So the stored list cannot be read back
 * and re-sent with one entry changed: changing anything means entering the whole
 * list again, and the copy says so before the save rather than after.
 *
 * ── ⚠ Mobile money only ──────────────────────────────────────────────────────
 * `bank` and `card` are refused today with a message naming what is accepted,
 * so the form does not offer them. The phone must be full E.164, the same rule
 * the server enforces.
 */
export function EmployeePayoutPanel({
    record,
    onChange,
}: {
    record: EmployeeRecord;
    onChange: (next: EmployeeRecord) => void;
}) {
    const saved = record.payoutMethods;
    const [editing, setEditing] = useState(false);
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [localError, setLocalError] = useState<string | null>(null);

    function blankDraft(): Draft {
        return { provider: MOBILE_MONEY_PROVIDERS[0], phoneNumber: '', accountName: record.fullName ?? '' };
    }

    function startEditing() {
        setDrafts([blankDraft()]);
        setFormError(null);
        setLocalError(null);
        setEditing(true);
    }

    function patchDraft(index: number, patch: Partial<Draft>) {
        setDrafts(drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
    }

    async function save(event: React.FormEvent) {
        event.preventDefault();
        setFormError(null);
        setLocalError(null);

        const cleaned = drafts.map((draft) => ({
            provider: draft.provider.trim(),
            phone_number: draft.phoneNumber.trim(),
            account_name: draft.accountName.trim(),
        }));

        if (cleaned.some((entry) => !entry.provider || !entry.account_name)) {
            setLocalError('Every destination needs a provider and the name the account is registered to.');
            return;
        }
        if (cleaned.some((entry) => !/^\+[1-9]\d{6,14}$/.test(entry.phone_number))) {
            setLocalError('Every number needs its country code, starting with +237.');
            return;
        }

        const body: UpdateEmployeeRecordBody = {
            payoutMethods: cleaned.map((mobile_money) => ({ method: 'mobile_money', mobile_money })),
        };

        setSaving(true);
        try {
            onChange(await updateMyEmployeeRecord(body));
            notify.success('Payout destination saved');
            setEditing(false);
        } catch (error) {
            setFormError(error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="space-y-3" aria-label="Salary payout">
            <div className="space-y-1">
                <h3 className="text-sm font-medium">Salary payout</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                    Where the company pays your salary. Once saved, the number is shown masked —
                    to you as well as to everyone else.
                </p>
            </div>

            {saved.length > 0 ? (
                <ul className="divide-y rounded-lg border">
                    {saved.map((method, index) => (
                        <li key={index} className="flex items-center justify-between gap-3 p-3 text-sm">
                            <span>
                                {method.mobileMoney?.provider ?? method.method}{' '}
                                <span className="text-muted-foreground">
                                    {method.mobileMoney?.phoneNumberMasked ?? 'masked'}
                                </span>
                                {method.mobileMoney?.accountName ? (
                                    <span className="text-muted-foreground block text-xs">
                                        {method.mobileMoney.accountName}
                                    </span>
                                ) : null}
                            </span>
                            {index === 0 ? <Badge variant="secondary">Preferred</Badge> : null}
                        </li>
                    ))}
                </ul>
            ) : !editing ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                    No payout destination yet. One is needed before the account can be activated.
                </p>
            ) : null}

            {!editing ? (
                <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={startEditing}>
                        {saved.length > 0 ? 'Replace' : 'Add a payout destination'}
                    </Button>
                </div>
            ) : (
                <form onSubmit={save} noValidate className="space-y-3 rounded-lg border p-3">
                    {saved.length > 0 ? (
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            Saved numbers cannot be shown back to you, so enter the full list again.
                            Saving replaces every destination above.
                        </p>
                    ) : null}

                    <ul className="space-y-4">
                        {drafts.map((draft, index) => (
                            <li key={index} className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium">
                                        {index === 0 ? 'Preferred destination' : `Destination ${index + 1}`}
                                    </span>
                                    {drafts.length > 1 ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Remove destination ${index + 1}`}
                                            onClick={() =>
                                                setDrafts(drafts.filter((_, position) => position !== index))
                                            }
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <Select
                                        value={draft.provider}
                                        onValueChange={(provider) => patchDraft(index, { provider })}
                                    >
                                        <SelectTrigger aria-label={`Provider for destination ${index + 1}`}>
                                            <SelectValue placeholder="Provider" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {MOBILE_MONEY_PROVIDERS.map((provider) => (
                                                <SelectItem key={provider} value={provider}>
                                                    {provider}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        aria-label={`Mobile money number ${index + 1}`}
                                        placeholder="+237670001122"
                                        inputMode="tel"
                                        value={draft.phoneNumber}
                                        onChange={(event) => patchDraft(index, { phoneNumber: event.target.value })}
                                    />
                                    <Input
                                        aria-label={`Account name ${index + 1}`}
                                        placeholder="Name on the account"
                                        value={draft.accountName}
                                        onChange={(event) => patchDraft(index, { accountName: event.target.value })}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>

                    {drafts.length < MAX_DESTINATIONS ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setDrafts([...drafts, blankDraft()])}
                        >
                            <Plus className="size-4" />
                            Add another
                        </Button>
                    ) : null}

                    {localError ? <p className="text-destructive text-xs">{localError}</p> : null}
                    <AuthFormError error={formError} />

                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={saving}
                            onClick={() => setEditing(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={saving}>
                            {saving ? <InlineLoader label="Saving…" /> : 'Save'}
                        </Button>
                    </div>
                </form>
            )}
        </section>
    );
}
