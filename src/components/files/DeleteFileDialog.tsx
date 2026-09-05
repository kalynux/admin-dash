import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { formatBytes, formatCount, humaniseEnum } from '@/lib/format';
import { notify } from '@/lib/notify';
import { deleteFilePermanently } from '@/services/files.service';

/**
 * The four fields the audit row keeps, plus the one thing that decides how loud
 * this dialog has to be.
 *
 * ⚠ **Deliberately a shape rather than a union of `OrphanFile | LibraryFile`.**
 * The two rows differ — an orphan carries `ownerType`, a library row carries a
 * whole `owner` object — and a union would push that difference into every
 * branch here. What the delete actually needs is five values, so it asks for
 * five values and each screen maps its own row.
 */
export interface DeletableFile {
    id: string;
    originalName: string | null;
    mimeType: string;
    size: number;
    /** `vendor` · `admin` · `system` … **open**, so it is rendered rather than switched on. */
    ownerType: string | null;
    /**
     * ⚠ **How many live records point at this file, or `undefined` when the
     * caller cannot know.**
     *
     * `undefined` and `0` are different facts and must not collapse. The orphan
     * listing sends `undefined` — its rows carry no count, and *being on that
     * screen* is already the statement that nothing refers to them. The library
     * sends the real number, which on a browse surface is frequently **not**
     * zero: that is the whole reason this dialog needed a second voice.
     */
    referenceCount?: number;
}

/**
 * `DELETE /files/:fileId/permanent` · `files.delete` · **tier 1**, `destructive`.
 *
 * ── The confirmation is the file id, byte for byte ────────────────────────────
 * The same pattern as `dev-tools/outbox/prune`: make the operator restate the
 * value that decides the blast radius. There it is the retention age; here it is
 * the id, because the id is the whole of what this operation acts on. A
 * mismatch never leaves the browser, and wi-admin refuses it again before
 * anything reaches jovi-mall (`400 FILE_DELETE_NOT_CONFIRMED`).
 *
 * ── ⚠ Since Phase F it is reachable from a screen where the file is IN USE ───
 * It used to be offered only from the orphan listing, where *"nothing refers to
 * this"* was a property of the screen rather than a thing the dialog had to say.
 * The media library offers it over **every** file, so `referenceCount` is now
 * part of the confirmation: a file on four products is four broken images and a
 * support ticket, and an operator who cannot see that number before typing the
 * id is being asked to confirm something they have not been told.
 *
 * The delete is not *blocked* on a live reference — a tier-1 administrator
 * removing something that must go is exactly who this route is for, and the
 * platform will not refuse it either. It is **stated**, in the loudest terms the
 * dialog has, and the entities are named where they are known.
 *
 * ── What the dialog shows is what the audit row will keep ─────────────────────
 * `originalName`, `mimeType`, `size`, `ownerType` — the file **as the operator
 * saw it before confirming** — because afterwards there is nothing left to look
 * it up in. `after` is `null` by construction.
 *
 * ── A success means the record is gone, not that the bytes are ────────────────
 * jovi-mall deletes the row first and removes the object best-effort, treating
 * its own database as the source of truth. A storage failure is logged there and
 * the delete stands rather than rolling back into a half state — so the
 * confirmation message says "record", not "file".
 */
export function DeleteFileDialog({
    file,
    open,
    onOpenChange,
    onDeleted,
}: {
    file: DeletableFile;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleted: () => void;
}) {
    const [confirmation, setConfirmation] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const matches = confirmation.trim() === file.id;

    /**
     * ⚠ **`> 0`, never truthiness on a possibly-`undefined` number.** `undefined`
     * means "this screen does not carry the count" and must render as the ordinary
     * dialog, not as a reassurance that nothing refers to the file.
     */
    const inUse = typeof file.referenceCount === 'number' && file.referenceCount > 0;

    async function confirm() {
        if (!matches) return;
        setSubmitting(true);
        setFormError(null);
        try {
            await deleteFilePermanently(file.id, { confirmFileId: file.id });
            notify.success('File record deleted', {
                description:
                    'The record is gone. Removing the stored object is best-effort on the platform side and is not reported back.',
            });
            onDeleted();
        } catch (error) {
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete this file permanently?</DialogTitle>
                    <DialogDescription>
                        There is no undo. The database row goes, then the stored object goes.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/*
                      ⚠ Above the file card, not below it — an operator who reads
                      one thing in this dialog must read this one. The count is the
                      subject of the sentence rather than a parenthetical, because
                      "four things point at this" is the fact that decides whether
                      to go on.
                    */}
                    {inUse ? (
                        <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                            <div className="space-y-1">
                                <p className="font-medium">
                                    {formatCount(file.referenceCount ?? 0)} live record
                                    {file.referenceCount === 1 ? '' : 's'} still point
                                    {file.referenceCount === 1 ? 's' : ''} at this file.
                                </p>
                                <p>
                                    Deleting it does not detach anything. Each of those records
                                    keeps its reference and loses what it pointed at — a product
                                    with no picture, a ticket whose attachment opens nothing. The
                                    platform will not refuse this and there is no undo.
                                </p>
                            </div>
                        </div>
                    ) : null}

                    <div className="bg-muted/50 space-y-1 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">{file.originalName ?? 'Unnamed upload'}</p>
                        <p className="text-muted-foreground">
                            {file.mimeType} · {formatBytes(file.size)}
                            {file.ownerType
                                ? ` · uploaded by ${(humaniseEnum(file.ownerType) ?? file.ownerType).toLowerCase()}`
                                : ''}
                        </p>
                        <p className="text-muted-foreground text-xs">
                            These four details are what the audit trail keeps — afterwards there is
                            nothing left to look the file up in.
                        </p>
                    </div>

                    <FormField
                        id="confirm-file-id"
                        label="Type the file id to confirm"
                        error={
                            confirmation.length > 0 && !matches
                                ? 'This does not match the file id above.'
                                : undefined
                        }
                        hint={file.id}
                    >
                        {(field) => (
                            <Input
                                {...field}
                                value={confirmation}
                                onChange={(event) => setConfirmation(event.target.value)}
                                placeholder={file.id}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        )}
                    </FormField>

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={confirm}
                        disabled={!matches || submitting}
                    >
                        {submitting ? <InlineLoader /> : null}
                        {inUse ? 'Delete anyway' : 'Delete permanently'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
