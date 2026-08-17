import { useState } from 'react';
import { Download } from 'lucide-react';

import { AuditFormError } from '@/components/audit/AuditFormError';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dayRangeToInstants, parseCalendarDay } from '@/lib/datetime';
import { notify } from '@/lib/notify';
import { createAuditExport } from '@/services/audit.service';

/**
 * `POST /audit/exports` — write an NDJSON file for a range and stamp the rows it
 * covered as exported.
 *
 * ── Why not `DateRangeFilter` ─────────────────────────────────────────────────
 * That control models a range whose ends are **independently optional**, offers a
 * clear affordance, and validates nothing when only one end is set — all correct
 * for a filter. Here both ends are required: an export with no range means the
 * whole collection, and this path is bounded by row count rather than by span.
 * So this is two date inputs with their own rules.
 *
 * ── There is deliberately no 92-day cap here ──────────────────────────────────
 * `MAX_DAYS_AUDIT` is right there and applying it would be wrong.
 * `CreateExportSchema` passes **no** `maxDays` — the export is bounded by row
 * count, not span — so capping the form would refuse a perfectly legal quarterly
 * export that the server would have written. The real bound arrives as
 * `422 AUDIT_EXPORT_TOO_LARGE`, which is handled inline below.
 *
 * ── What an export does and does not do ───────────────────────────────────────
 * `audit.export` is flagged `destructive`, which reads alarmingly for an action
 * that deletes nothing. It is flagged that way because an export is the
 * **precondition** for deletion: retention is exported-AND-aged, so stamping a
 * row starts a clock that was not running before. The dialog says both halves,
 * and the success toast repeats the server's own sentence verbatim.
 */

interface CreateAuditExportDialogProps {
    timeZone: string;
    /** Called with the new export's id once it is written. */
    onCreated: (exportId: string) => void;
}

export function CreateAuditExportDialog({ timeZone, onCreated }: CreateAuditExportDialogProps) {
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [isSubmitting, setSubmitting] = useState(false);

    const fromDay = parseCalendarDay(from);
    const toDay = parseCalendarDay(to);

    /**
     * The server's own sentence for a missing bound, verbatim, so the inline
     * message and the `400` say the same thing rather than two similar things.
     */
    const localError =
        !fromDay || !toDay
            ? 'An export needs both a start and an end date. Use the CLI for an open-ended export.'
            : dayRangeToInstants(fromDay, toDay, timeZone).to <=
                dayRangeToInstants(fromDay, toDay, timeZone).from
              ? 'The end date must be after the start date.'
              : null;

    function reset() {
        setFrom('');
        setTo('');
        setError(null);
        setSubmitting(false);
    }

    async function submit() {
        if (!fromDay || !toDay || localError) return;

        setSubmitting(true);
        setError(null);

        try {
            // Days in, instants out. The contract refuses date-only values —
            // `2026-08-11` is not an instant — and the day is resolved in the
            // operator's zone, not the browser's.
            const range = dayRangeToInstants(fromDay, toDay, timeZone);
            const result = await createAuditExport(range);

            // Verbatim: "Exported N row(s). Nothing was deleted — use the CLI
            // with --purge for that." is the whole reassurance that an action
            // flagged `destructive` destroyed nothing.
            notify.success(result.message ?? 'The export was written.');
            setOpen(false);
            reset();
            onCreated(result.data.id);
        } catch (caught) {
            // Stays open: a too-large range is fixed in the form the operator is
            // already looking at, not on the screen behind it.
            setError(caught);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) reset();
            }}
        >
            <DialogTrigger asChild>
                <Button size="sm">
                    <Download className="size-4" />
                    New export
                </Button>
            </DialogTrigger>

            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Export the audit trail</DialogTitle>
                    <DialogDescription>
                        Writes every row in the range to an NDJSON file and marks those rows as
                        exported. <strong>Nothing is deleted.</strong> Deleting lives in the CLI,
                        because a purge from a dashboard would be one misclick from irreversible.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="export-from">From</Label>
                        <Input
                            id="export-from"
                            type="date"
                            value={from}
                            onChange={(event) => setFrom(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="export-to">To</Label>
                        <Input
                            id="export-to"
                            type="date"
                            value={to}
                            onChange={(event) => setTo(event.target.value)}
                        />
                    </div>
                </div>

                <p className="text-muted-foreground text-xs">
                    Both dates are inclusive, resolved in your own timezone. Marking rows as
                    exported is what makes them eligible for the retention purge later —
                    retention is exported <em>and</em> aged, never aged alone.
                </p>

                {error ? <AuditFormError error={error} /> : null}

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={Boolean(localError) || isSubmitting}>
                        {isSubmitting ? 'Exporting…' : 'Export'}
                    </Button>
                </DialogFooter>

                {localError && (from || to) ? (
                    <p className="text-destructive text-xs" role="alert">
                        {localError}
                    </p>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
