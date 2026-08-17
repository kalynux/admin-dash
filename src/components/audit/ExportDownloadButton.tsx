import { useState } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import { downloadAuditExport } from '@/services/audit.service';
import { ApiError } from '@/types/api.types';
import type { AuditExport } from '@/types/audit.types';

/**
 * Hand an export's NDJSON file to the browser.
 *
 * ── Three failures worth distinguishing ───────────────────────────────────────
 * The download endpoint is the one on this service that does not answer with the
 * JSON envelope — but **its errors still do**, so they arrive as ordinary
 * `ApiError`s and can be branched on by code:
 *
 * - **409 `AUDIT_EXPORT_INCOMPLETE`** — the export did not finish. `downloadable`
 *   is `false` on such a record, so the button is not offered; a 409 means the
 *   record was still `running` when this page loaded, i.e. the view is stale.
 * - **410 `AUDIT_EXPORT_FILE_MISSING`** — the record exists, the file does not.
 *   Behind a load balancer with more than one instance this is the **normal**
 *   answer unless `ADMIN_AUDIT_EXPORT_DIR` points at shared storage, so the copy
 *   names that rather than implying data loss. The operationally important half:
 *   the rows it covered are **still stamped as exported**, so the retention clock
 *   has already started even though the file is gone.
 * - **404** — the record itself is gone.
 *
 * ── The file is the bulk of the trail, in one object ──────────────────────────
 * Every covered row's stored `payload`, `before` and `after`, server-redacted
 * only. It is handed straight to the operating system and never previewed in the
 * page: rendering it would put thousands of rows of recorded state on a screen
 * at once, which is the exact thing `audit.export` being withheld from Support
 * is meant to control.
 */
export function ExportDownloadButton({ record }: { record: AuditExport }) {
    const [isBusy, setBusy] = useState(false);

    async function run() {
        setBusy(true);
        try {
            const file = await downloadAuditExport(record.id);

            // The manifest records a checksum so a client can verify what it
            // downloaded; the header carries it too. A disagreement means the
            // file on disk is not the file that was written.
            if (file.sha256 && record.sha256 && file.sha256 !== record.sha256) {
                notify.warning('The downloaded file does not match its recorded checksum', {
                    description:
                        'The file was saved, but its SHA-256 differs from the one on the export record. Treat it as unverified.',
                });
            }

            const url = URL.createObjectURL(file.blob);
            try {
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download =
                    file.fileName ?? record.fileName ?? `audit-export-${record.id}.ndjson`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
            } finally {
                // Safe synchronously — the download is queued by the time
                // `click()` returns — and in a `finally` so a throw above cannot
                // leak the object URL for the life of the document.
                URL.revokeObjectURL(url);
            }
        } catch (caught) {
            notify.apiError(caught, messageFor(caught));
        } finally {
            setBusy(false);
        }
    }

    // `downloadable` is the server's own gate: true once the file is durable.
    if (!record.downloadable) {
        return (
            <span className="text-muted-foreground text-xs">
                {record.status === 'failed' ? 'Export failed' : 'Not ready'}
            </span>
        );
    }

    return (
        <Button variant="outline" size="sm" onClick={run} disabled={isBusy}>
            <Download className="size-4" />
            {isBusy ? 'Preparing…' : 'Download'}
        </Button>
    );
}

/** Branch on `code`, never on `message`. */
function messageFor(error: unknown): string | undefined {
    if (!(error instanceof ApiError)) return undefined;

    if (error.code === 'AUDIT_EXPORT_FILE_MISSING') {
        return 'The export record exists, but its file is gone';
    }
    if (error.code === 'AUDIT_EXPORT_INCOMPLETE') {
        return 'This export did not finish, so there is no file to download';
    }
    return undefined;
}
