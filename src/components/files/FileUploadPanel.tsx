import { useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBytes, formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { uploadFiles } from '@/services/files.service';
import { ApiError } from '@/types/api.types';
import {
    FILE_UPLOAD_ACCEPTED_MIME_TYPES,
    FILE_UPLOAD_MAX_BYTES,
    FILE_UPLOAD_MAX_FILES,
    PLATFORM_CODE_UPLOAD_POLICY_VIOLATION,
    type FileDetail,
} from '@/types/files.types';

/**
 * `POST /files/upload` · `files.upload` (tiers 1 · 2) · **audited**.
 *
 * The form behind both upload affordances — the Media library's button and the
 * picker's second tab — so the constraints are stated once and the refusals are
 * read once.
 *
 * ── ⚠ Three of the four constraints are ADVISORY here, and saying so matters ─
 * wi-admin never parses the body, so it enforces the **byte ceiling only**. Max
 * files, the field name and the accepted MIME list belong to jovi-mall's
 * pipeline and are *published* to this client so it can filter the dialog
 * politely. This panel therefore checks what it can before spending an audited
 * write — the size, and the count — and lets the type be jovi-mall's answer,
 * because the type it would check is the browser's guess from the extension and
 * the platform sniffs the actual bytes.
 *
 * ── ⚠ The refusal that is not a fault ────────────────────────────────────────
 * A file the platform will not take comes back as `400
 * PLATFORM_OPERATION_REJECTED` with `details.platformCode:
 * "UPLOAD_POLICY_VIOLATION"` and a `details.violations[]` array naming it. That
 * is a normal answer and is rendered as a list of files with reasons, not as an
 * incident. **Branch on `platformCode`, never on `error.code`** — the outer code
 * is the same for every delegated refusal on the service.
 *
 * ── ⚠ Whatever is uploaded here is PUBLIC ────────────────────────────────────
 * jovi-mall files each part under the folder for its own detected media type and
 * all six of those trees are classified `public`, so an admin upload comes back
 * with a real, unauthenticated URL that never expires. There is no way to ask
 * for a private tree and no reason the blog would want one — but the person at
 * this form has to be told before they choose the file, not after.
 */
export function FileUploadPanel({
    onUploaded,
    accept,
    description,
}: {
    /** Handed the created files, in the order the parts were sent. */
    onUploaded: (files: FileDetail[]) => void;
    /**
     * The `accept` attribute for the file input. Defaults to the whole published
     * list; the pickers narrow it to images.
     *
     * ⚠ **A hint to the file dialog, not a guard.** A renamed file passes it and
     * is caught by the platform's sniff instead.
     */
    accept?: string;
    /** Replaces the default sentence above the input, where a caller has a better one. */
    description?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [chosen, setChosen] = useState<File[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const totalBytes = chosen.reduce((sum, file) => sum + file.size, 0);

    /**
     * ⚠ **The whole request body, not the largest file.** The ceiling counts
     * multipart framing and every part together, so four 9 MiB images are over
     * it while none of them is.
     */
    const overSize = totalBytes > FILE_UPLOAD_MAX_BYTES;
    const overCount = chosen.length > FILE_UPLOAD_MAX_FILES;

    /**
     * The per-file reasons on a policy refusal.
     *
     * ⚠ **Read defensively.** `details` is scrubbed and forwarded from another
     * service; the array is documented but its element shape is not pinned by
     * anything this repository can diff, so anything unrecognised falls back to
     * the raw value rather than rendering `[object Object]` or vanishing.
     */
    const violations =
        formError instanceof ApiError &&
        formError.platformCode === PLATFORM_CODE_UPLOAD_POLICY_VIOLATION &&
        Array.isArray(formError.details?.violations)
            ? (formError.details.violations as unknown[]).map(describeViolation)
            : [];

    async function submit() {
        if (chosen.length === 0 || overSize || overCount) return;
        setSubmitting(true);
        setFormError(null);
        try {
            const result = await uploadFiles(chosen);
            notify.success(
                result.files.length === 1
                    ? 'File uploaded'
                    : `${formatCount(result.files.length)} files uploaded`,
                {
                    // ⚠ Said on success, because it is the moment the operator
                    // still has a choice about what happens to the file next.
                    description:
                        'It is stored in a public tree, so its address works for anyone who has it.',
                },
            );
            setChosen([]);
            if (inputRef.current) inputRef.current.value = '';
            onUploaded(result.files);
        } catch (error) {
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <Label htmlFor="file-upload-input">Choose a file</Label>
                <Input
                    ref={inputRef}
                    id="file-upload-input"
                    type="file"
                    multiple
                    accept={accept ?? FILE_UPLOAD_ACCEPTED_MIME_TYPES.join(',')}
                    disabled={submitting}
                    onChange={(event) => {
                        setFormError(null);
                        setChosen(Array.from(event.target.files ?? []));
                    }}
                />
                <p className="text-muted-foreground text-xs">
                    {description ??
                        `Up to ${FILE_UPLOAD_MAX_FILES} files, ${formatBytes(FILE_UPLOAD_MAX_BYTES)} in total.`}
                </p>
                {/*
                  ⚠ Before the choice, not after the refusal. An operator who
                  uploads a customer's document here has published it, and the
                  audit row records that we uploaded it — never that it is
                  readable by anyone holding the link.
                */}
                <p className="text-warning flex items-start gap-1.5 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                        Anything uploaded here is stored in a public tree. Its address is
                        unauthenticated and does not expire — treat the file as published, not as
                        shared.
                    </span>
                </p>
            </div>

            {chosen.length > 0 ? (
                <ul className="space-y-1 text-sm">
                    {chosen.map((file) => (
                        <li key={`${file.name}-${file.size}`} className="flex justify-between gap-3">
                            <span className="truncate">{file.name}</span>
                            <span className="text-muted-foreground shrink-0">
                                {formatBytes(file.size)}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {/*
              Checked here so the request is never made: a `413` is an audited
              round trip to be told a number this client already knew.
            */}
            {overSize ? (
                <p className="text-destructive text-sm">
                    These files come to {formatBytes(totalBytes)} together, over the{' '}
                    {formatBytes(FILE_UPLOAD_MAX_BYTES)} limit on the whole request. The limit is
                    the total, not the largest file.
                </p>
            ) : null}

            {overCount ? (
                <p className="text-destructive text-sm">
                    {formatCount(chosen.length)} files chosen; the platform accepts{' '}
                    {FILE_UPLOAD_MAX_FILES} at a time.
                </p>
            ) : null}

            {violations.length > 0 ? (
                <ul className="text-destructive space-y-1 text-sm">
                    {violations.map((line, index) => (
                        <li key={index}>{line}</li>
                    ))}
                </ul>
            ) : null}

            {formError ? <AuthFormError error={formError} /> : null}

            <Button
                onClick={submit}
                disabled={chosen.length === 0 || overSize || overCount || submitting}
            >
                {submitting ? <InlineLoader /> : <Upload className="size-4" />}
                {submitting ? 'Uploading…' : 'Upload'}
            </Button>
        </div>
    );
}

/**
 * One entry of `details.violations[]`, as a sentence.
 *
 * jovi-mall's shape is `{ file, reason }` in the cases seen, but nothing in this
 * repository can diff that — so an entry that is not that shape is stringified
 * rather than dropped. **A refusal the operator cannot read is worse than an
 * ugly one.**
 */
function describeViolation(entry: unknown): string {
    if (typeof entry === 'string') return entry;

    if (entry && typeof entry === 'object') {
        const row = entry as Record<string, unknown>;
        const name = typeof row.file === 'string' ? row.file : undefined;
        const reason =
            typeof row.reason === 'string'
                ? row.reason
                : typeof row.message === 'string'
                  ? row.message
                  : undefined;

        if (name && reason) return `${name} — ${reason}`;
        if (name) return name;
        if (reason) return reason;
    }

    return JSON.stringify(entry);
}
