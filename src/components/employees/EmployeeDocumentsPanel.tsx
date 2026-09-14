import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';

import { ResolvedImageBox } from '@/components/files/ResolvedImageBox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/common/Loading';
import { notify } from '@/lib/notify';
import { deleteEmployeeDocument, uploadEmployeeDocument } from '@/services/employees.service';
import {
    documentSlot,
    EMPLOYEE_DOCUMENT_LABELS,
    EMPLOYEE_DOCUMENT_SLOTS,
    EMPLOYEE_REQUIRED_DOCUMENT_SLOTS,
    type EmployeeDocumentSlot,
    type EmployeeRecord,
} from '@/types/employees.types';

/** `employees.md`: jpeg, png, webp, pdf. PDF because a scanner app produces one. */
const ACCEPTED = 'image/jpeg,image/png,image/webp,application/pdf';

/**
 * The six document slots on an employee record.
 *
 * ── ⚠ One file per request, always ───────────────────────────────────────────
 * *"A second part is refused outright. A multi-value slot is filled one upload at
 * a time — which is what a picker does anyway, and it is what lets the backend
 * refuse a full slot **before** spending the bandwidth rather than after."* So
 * the input is not `multiple`, on every slot including the two that append.
 *
 * ── ⚠ `single` replaces, `multi` appends ─────────────────────────────────────
 * There is one front of one identity card, so a second upload means the first was
 * bad — and **the displaced file is soft-deleted immediately** rather than waiting
 * out the unreferenced-file grace period, because it is a photograph of a national
 * identity card. The copy says so before the picker opens, since it cannot be
 * undone afterwards.
 *
 * ── ⚠ Every one of these files is PRIVATE, and that is the point ─────────────
 * They live in a private storage tree, so `url` does not exist for them and never
 * will. `ResolvedImageBox` resolves the metadata (unaudited, every tier) and the
 * **bytes wait for a click**, because `GET /files/:fileId/content` writes an audit
 * row against whoever opened it. Your own documents are no exception — the row
 * records who looked, and that includes you.
 *
 * ── ⚠ The response is the whole record ───────────────────────────────────────
 * Both the upload and the delete answer an `EmployeeRecord` with `readiness`
 * recomputed, so the checklist updates from the same response that changed it.
 * Never refetch to find out; hand it to `onChange`.
 */
export function EmployeeDocumentsPanel({
    record,
    onChange,
    readOnly = false,
}: {
    record: EmployeeRecord;
    onChange: (next: EmployeeRecord) => void;
    /** A reviewer reading somebody else's file — there is no admin write path. */
    readOnly?: boolean;
}) {
    return (
        <section className="space-y-3" aria-label="Documents">
            <div className="space-y-1">
                <h3 className="text-sm font-medium">Documents</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                    These are stored privately. Opening one is recorded against whoever opened it,
                    including you — so each waits for a click rather than loading on the page.
                </p>
            </div>

            <ul className="divide-y rounded-lg border">
                {EMPLOYEE_DOCUMENT_SLOTS.map((slot) => (
                    <li key={slot} className="p-3">
                        <DocumentSlotRow
                            slot={slot}
                            record={record}
                            onChange={onChange}
                            readOnly={readOnly}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function DocumentSlotRow({
    slot,
    record,
    onChange,
    readOnly,
}: {
    slot: EmployeeDocumentSlot;
    record: EmployeeRecord;
    onChange: (next: EmployeeRecord) => void;
    readOnly: boolean;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const state = documentSlot(record, slot);
    const required = EMPLOYEE_REQUIRED_DOCUMENT_SLOTS.includes(slot);
    const single = state.cardinality === 'single';
    const filled = state.fileIds.length > 0;

    async function upload(file: File) {
        setBusy(true);
        try {
            onChange(await uploadEmployeeDocument(slot, file));
            notify.success('Uploaded');
        } catch (error) {
            notify.apiError(error);
        } finally {
            setBusy(false);
            // Clearing lets the same filename be chosen again after a failure —
            // without it the change event never fires a second time.
            if (input.current) input.current.value = '';
        }
    }

    async function remove(fileId: string) {
        setBusy(true);
        try {
            onChange(await deleteEmployeeDocument(slot, fileId));
            notify.success('Removed');
        } catch (error) {
            notify.apiError(error);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 text-sm font-medium">
                    {EMPLOYEE_DOCUMENT_LABELS[slot]}
                </span>
                <Badge
                    variant="outline"
                    className={required ? 'text-[0.65rem]' : 'text-muted-foreground text-[0.65rem]'}
                >
                    {required ? 'Required' : 'Optional'}
                </Badge>
                {!readOnly ? (
                    <>
                        <input
                            ref={input}
                            type="file"
                            accept={ACCEPTED}
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void upload(file);
                            }}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => input.current?.click()}
                        >
                            {busy ? (
                                <InlineLoader label="Working…" />
                            ) : (
                                <>
                                    <Upload className="size-4" />
                                    {single && filled ? 'Replace' : 'Add'}
                                </>
                            )}
                        </Button>
                    </>
                ) : null}
            </div>

            {/*
              ⚠ Said before the picker opens, because it cannot be undone after.
              A `single` slot's previous file is detached AND soft-deleted the
              moment a replacement lands.
            */}
            {!readOnly && single && filled ? (
                <p className="text-muted-foreground text-xs">
                    Uploading again replaces this one, and the old file is deleted immediately.
                </p>
            ) : null}

            {!readOnly && !single ? (
                <p className="text-muted-foreground text-xs">
                    Up to ten. To change one, remove it and add another.
                </p>
            ) : null}

            {filled ? (
                <div className="flex flex-wrap gap-2">
                    {state.fileIds.map((fileId) => (
                        <div key={fileId} className="space-y-1">
                            <ResolvedImageBox
                                fileId={fileId}
                                alt={EMPLOYEE_DOCUMENT_LABELS[slot]}
                                className="max-w-[14rem]"
                                caption={EMPLOYEE_DOCUMENT_LABELS[slot]}
                            />
                            {!readOnly ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => void remove(fileId)}
                                >
                                    <Trash2 className="size-3.5" />
                                    Remove
                                </Button>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-muted-foreground text-xs">Nothing uploaded yet.</p>
            )}
        </div>
    );
}
