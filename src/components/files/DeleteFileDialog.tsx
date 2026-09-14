import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
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
 * What the operator types to arm the button.
 *
 * Lower case, and compared lower case — see `matches` below.
 */
const CONFIRMATION_WORD = 'delete';

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
 * ── The operator types `delete`; the wire still carries the id ────────────────
 * ⚠ **Two different confirmations, and they are not interchangeable.** The
 * request body must carry `confirmFileId` equal to the path id byte for byte or
 * wi-admin refuses it with `400 FILE_DELETE_NOT_CONFIRMED` — that is the
 * contract and it has not changed. What changed is what the *person* is asked
 * for.
 *
 * It used to be the id, transcribed by hand. A 24-hex string is not something
 * anybody reads: it is copied from the line directly above the box, or pasted,
 * and either way the gesture proves dexterity rather than intent. The operator
 * who meant to delete a different file copies the id of the one in front of them
 * just as accurately as the one who meant this one. Typing a word you cannot
 * copy from anywhere costs the same three seconds and is the only part of the
 * two that is actually a decision.
 *
 * So the dialog names the file, states what points at it, and asks for
 * `delete`. The id goes on the wire from `file.id`, where it was always correct.
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

    /**
     * Case-insensitive, whitespace-trimmed.
     *
     * The word is a statement of intent, not a password. Refusing `Delete`
     * because the D is capital would teach the operator that the box is
     * finicky, which is the lesson that gets people pasting into it without
     * reading — the opposite of what it is for.
     */
    const matches = confirmation.trim().toLowerCase() === CONFIRMATION_WORD;

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
                        {/*
                          The id is still shown — it is the one handle the audit
                          row keeps and the only way to find this afterwards — but
                          it is now a thing to copy if you need it, not a thing to
                          retype to get past the button.
                        */}
                        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <span>Id</span>
                            <CopyableValue variant="id" value={file.id} label="file id" />
                        </div>
                        <p className="text-muted-foreground text-xs">
                            These details are what the audit trail keeps — afterwards there is
                            nothing left to look the file up in.
                        </p>
                    </div>

                    <FormField
                        id="confirm-file-delete"
                        label={
                            <>
                                Type <span className="font-mono font-semibold">delete</span> to
                                confirm
                            </>
                        }
                        error={
                            confirmation.trim().length > 0 && !matches
                                ? `Type ${CONFIRMATION_WORD} to enable the button.`
                                : undefined
                        }
                        hint="There is no undo, and nothing else on this screen will ask again."
                    >
                        {(field) => (
                            <Input
                                {...field}
                                value={confirmation}
                                onChange={(event) => setConfirmation(event.target.value)}
                                placeholder={CONFIRMATION_WORD}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
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
