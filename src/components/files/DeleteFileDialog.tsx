import { useState } from 'react';

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
import { formatBytes } from '@/lib/format';
import { notify } from '@/lib/notify';
import { deleteFilePermanently } from '@/services/files.service';
import type { OrphanFile } from '@/types/files.types';

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
    file: OrphanFile;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleted: () => void;
}) {
    const [confirmation, setConfirmation] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const matches = confirmation.trim() === file.id;

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
                    <div className="bg-muted/50 space-y-1 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">{file.originalName ?? 'Unnamed upload'}</p>
                        <p className="text-muted-foreground">
                            {file.mimeType} · {formatBytes(file.size)}
                            {file.ownerType ? ` · uploaded by a ${file.ownerType}` : ''}
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
                    <Button variant="destructive" onClick={confirm} disabled={!matches || submitting}>
                        {submitting ? <InlineLoader /> : null}
                        Delete permanently
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
