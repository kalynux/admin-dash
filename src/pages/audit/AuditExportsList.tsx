import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive } from 'lucide-react';

import { CreateAuditExportDialog } from '@/components/audit/CreateAuditExportDialog';
import { ExportDownloadButton } from '@/components/audit/ExportDownloadButton';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatBytes, formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAuditExports } from '@/services/audit.service';
import { useAdmin } from '@/store';
import type { AuditExport, AuditExportListQuery } from '@/types/audit.types';

/**
 * `GET /audit/exports` — every export written, from here or from the CLI.
 *
 * ── No filters, and that is the contract rather than an omission ──────────────
 * The endpoint offers none. Sorting is `startedAt` only. Saying so in the page
 * description matters: a list with no filter bar reads as unfinished unless
 * something explains that there is nothing to filter by.
 *
 * ── An export is the precondition for deletion ────────────────────────────────
 * Which is why `audit.export` is flagged `destructive` and withheld from Support,
 * even though exporting removes nothing by itself. A row's `purgeAfter` stays
 * `null` until an export has stamped it, so this screen is where the retention
 * clock is started.
 */

const FILTER_KEYS = ['sort'] as const;
const SORT_DEFAULT = '-startedAt';
const FILTER_DEFAULTS = { sort: SORT_DEFAULT } as const;

export function AuditExportsList() {
    const admin = useAdmin();
    const navigate = useNavigate();
    const { values, set, page, setPage } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);

    const timeZone = resolveTimeZone(admin.timezone);

    // Bumped after a write so the new manifest appears without a full remount.
    const [reloadToken, setReloadToken] = useState(0);

    const query = useMemo<AuditExportListQuery>(
        () => ({ page, limit: PAGE_SIZE_DEFAULT, sort: values.sort || SORT_DEFAULT }),
        [page, values.sort],
    );

    const path = withQuery('/audit/exports', { ...query });
    const exports = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listAuditExports(query, { signal }),
    );

    const rows = exports.data?.data ?? [];
    const meta = exports.data?.meta;

    const columns = useMemo<Column<AuditExport>[]>(
        () => [
            {
                id: 'startedAt',
                header: 'Started',
                // The only key the endpoint sorts on.
                sortKey: 'startedAt',
                className: 'align-top text-sm whitespace-nowrap',
                cell: (row) => (
                    <Link
                        to={`/dashboard/audit/exports/${row.id}`}
                        className="font-medium hover:underline"
                    >
                        {formatInstantInZone(row.startedAt, timeZone) ?? '—'}
                    </Link>
                ),
            },
            {
                id: 'range',
                header: 'Range covered',
                className: 'align-top text-muted-foreground text-sm',
                cell: (row) =>
                    row.rangeFrom && row.rangeTo ? (
                        <>
                            {formatInstantInZone(row.rangeFrom, timeZone)} —{' '}
                            {formatInstantInZone(row.rangeTo, timeZone)}
                        </>
                    ) : (
                        // The CLI takes an open range; the API does not.
                        <span className="italic">Open range (CLI)</span>
                    ),
            },
            {
                id: 'rows',
                numeric: true,
                header: 'Rows',
                className: 'align-top text-sm',
                cell: (row) => (row.rowCount !== null ? formatCount(row.rowCount) : '—'),
            },
            {
                id: 'size',
                numeric: true,
                header: 'Size',
                className: 'align-top text-muted-foreground text-sm',
                cell: (row) => formatBytes(row.byteSize),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        <Badge
                            variant="outline"
                            className={
                                row.status === 'complete'
                                    ? 'border-success/30 bg-success/10 text-success capitalize'
                                    : row.status === 'failed'
                                      ? 'border-destructive/30 bg-destructive/10 text-destructive capitalize'
                                      : 'border-warning/30 bg-warning/10 text-warning capitalize'
                            }
                        >
                            {row.status}
                        </Badge>
                        <p className="text-muted-foreground text-xs uppercase">{row.source}</p>
                    </div>
                ),
            },
            {
                id: 'requestedBy',
                header: 'Requested by',
                className: 'align-top text-sm',
                cell: (row) =>
                    // Both are null on a CLI export — there is no administrator
                    // behind it, which is a fact rather than missing data.
                    row.requestedByName ??
                    (row.requestedBy ? (
                        // Shortened, unlike the same field on the detail screen:
                        // this is a table cell with no name to sit beside, and the
                        // whole value is in the title and on the clipboard.
                        <CopyableValue value={row.requestedBy} label="requester ID" />
                    ) : (
                        <span className="text-muted-foreground">Command line</span>
                    )),
            },
            {
                id: 'download',
                header: 'File',
                className: 'align-top',
                cell: (row) => <ExportDownloadButton record={row} />,
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer
            title="Audit exports"
            description="Every export written, here or from the command line. There is nothing to filter by and only one ordering — the endpoint offers neither."
            actions={
                <CreateAuditExportDialog
                    timeZone={timeZone}
                    onCreated={(id) => {
                        setReloadToken((token) => token + 1);
                        navigate(`/dashboard/audit/exports/${id}`);
                    }}
                />
            }
        >
            <DataTable
                caption="Audit exports"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                sort={values.sort || SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={exports.isLoading}
                isRefreshing={exports.isRefreshing}
                error={exports.error}
                onRetry={exports.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={Archive}
                        title="Nothing has been exported yet"
                        description="An export writes the trail to an NDJSON file and marks the rows it covered as exported. It deletes nothing — but it is what makes those rows eligible for the retention purge later, which is why the permission is flagged destructive."
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="exports"
                    isBusy={exports.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
