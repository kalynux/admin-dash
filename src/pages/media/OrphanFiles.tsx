import { useState } from 'react';
import { FileWarning, RotateCw, Trash2 } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { CopyableId } from '@/components/common/CopyableId';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { resolveTimeZone } from '@/lib/datetime';
import { formatBytes, formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { listOrphanFiles } from '@/services/files.service';
import { useAdmin, useCan } from '@/store';
import { ORPHAN_MIN_AGE_HOURS, type OrphanFile } from '@/types/files.types';
import { DeleteFileDialog } from '@/components/files/DeleteFileDialog';

/**
 * `GET /files/orphans` and `DELETE /files/:fileId/permanent`.
 *
 * ── ⚠ It lives under Media now, and it used to live under System ─────────────
 * Moved on 2026-08-27 with Phase F. It sat in System because there was nothing
 * for it to sit beside — *"`files.resolve` answers ids a caller already holds,
 * and there is deliberately no listing route beyond orphans."* BR-015 built that
 * listing, so one module now holds every file on the platform and this child
 * holds the subset nothing points at. **The screen itself is unchanged.**
 *
 * ── Two permissions, and they are not the same tier ───────────────────────────
 * `files.orphans.read` is tiers 1–2; `files.delete` is **tier 1 only** and
 * flagged `destructive`. So an Admin reads this list and is offered no delete —
 * the nav entry gates on either in `any` mode, and the affordance gates on its
 * own permission. Support enumerates no files.
 *
 * ── The listing is the judgement, so it withholds the storage key ─────────────
 * An orphan row carries no `key`, no `url`, no `provider`, `checksum` or
 * `ownerId` — six fields and no more. What makes a delete judgeable is the
 * filename, the type, the size and whose it was; the storage key is an internal
 * locator that adds nothing to the decision.
 *
 * ⚠ **And that is why there is no picture on this screen, unlike the library.**
 * A library row carries a `url` wi-admin built, so its thumbnail costs nothing
 * and discloses nothing. An orphan row carries neither, so a preview here would
 * mean the audited content route — a disclosure row per file per page load,
 * against an operator who is only deciding whether to sweep. The one-line
 * judgement the rows already support is the cheaper answer.
 *
 * ── The 24-hour floor is refused, not clamped ─────────────────────────────────
 * A file is uploaded and attached seconds later, so a window reaching into the
 * last minute would list files about to be referenced and feed them to an
 * unrecoverable delete. Both services refuse it rather than quietly widening —
 * a clamp would answer `200` for a window the caller did not ask for. This
 * screen therefore renders `meta.olderThan` — the cutoff jovi-mall **actually
 * applied** — rather than the value it sent.
 */
export function OrphanFiles() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const { token, refresh } = useRefreshToken();

    const [olderThan, setOlderThan] = useState('');
    const [applied, setApplied] = useState('');
    const [deleting, setDeleting] = useState<OrphanFile | null>(null);

    const orphans = useAsyncData(`/files/orphans?olderThan=${applied}#${token}`, (signal) =>
        listOrphanFiles(applied ? { olderThan: applied } : {}, { signal }),
    );

    const canDelete = can('files.delete');
    const rows = orphans.data?.files ?? [];

    const columns: Column<OrphanFile>[] = [
        {
            id: 'name',
            header: 'File',
            className: 'align-top',
            cell: (row) => (
                <div className="min-w-0 space-y-0.5">
                    {/* `null` rather than absent when jovi-mall has none. */}
                    <p className="truncate text-sm font-medium">
                        {row.originalName ?? 'Unnamed upload'}
                    </p>
                    <CopyableId value={row.id} label="file ID" />
                </div>
            ),
        },
        {
            id: 'type',
            header: 'Type',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => row.mimeType,
        },
        {
            id: 'size',
            header: 'Size',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatBytes(row.size),
        },
        {
            id: 'owner',
            header: 'Uploaded by',
            className: 'align-top text-sm',
            cell: (row) =>
                row.ownerType ? (
                    (humaniseEnum(row.ownerType) ?? row.ownerType)
                ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                ),
        },
        {
            id: 'createdAt',
            header: 'Uploaded',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone),
        },
    ];

    if (canDelete) {
        columns.push({
            id: 'actions',
            header: '',
            className: 'align-top',
            cell: (row) => (
                <Button variant="outline" size="sm" onClick={() => setDeleting(row)}>
                    <Trash2 className="size-4" />
                    Delete
                </Button>
            ),
        });
    }

    return (
        <PageContainer
            title="Orphan files"
            description="Uploads that no live record refers to, and the permanent delete."
        >
            <Card>
                <CardHeader>
                    <CardTitle>Orphaned uploads</CardTitle>
                    <CardDescription>
                        Files jovi-mall holds that nothing points at any more. Records are
                        soft-deleted and swept, so a file legitimately outlives the thing that
                        referenced it — an entry here is a candidate for removal, not proof of a
                        fault.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="orphans-older-than">Uploaded before</Label>
                            <Input
                                id="orphans-older-than"
                                type="datetime-local"
                                value={olderThan}
                                onChange={(event) => setOlderThan(event.target.value)}
                            />
                            <p className="text-muted-foreground text-xs">
                                Must be at least {ORPHAN_MIN_AGE_HOURS} hours ago — a nearer window
                                would list files about to be attached. Leave blank for seven days.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() =>
                                // A `datetime-local` value is a wall clock with no
                                // zone. The contract refuses date-only values and
                                // wants an explicit offset, so resolve it here —
                                // in the browser's zone, which is the one the
                                // operator just typed in.
                                setApplied(olderThan ? new Date(olderThan).toISOString() : '')
                            }
                        >
                            Apply
                        </Button>
                        <Button variant="outline" onClick={refresh} disabled={orphans.isRefreshing}>
                            <RotateCw className="size-4" />
                            Refresh
                        </Button>
                    </div>

                    {orphans.data?.meta.olderThan ? (
                        <p className="text-muted-foreground text-sm">
                            {/*
                              The cutoff jovi-mall ACTUALLY applied, not the one
                              sent — they differ whenever the request omitted one.
                            */}
                            Showing {formatCount(orphans.data.meta.count)} file
                            {orphans.data.meta.count === 1 ? '' : 's'} uploaded before{' '}
                            {formatInstantInZone(orphans.data.meta.olderThan, timeZone)}.
                        </p>
                    ) : null}

                    <DataTable
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.id}
                        caption="Uploaded files that no live record refers to"
                        isLoading={orphans.isLoading}
                        isRefreshing={orphans.isRefreshing}
                        error={orphans.error}
                        onRetry={orphans.reload}
                        empty={
                            <EmptyState
                                icon={FileWarning}
                                title="Nothing is orphaned"
                                description="Every stored file is still referenced by a live record in this window."
                            />
                        }
                    />

                    <Can permission="files.orphans.read">
                        {canDelete ? null : (
                            <p className="text-muted-foreground text-xs">
                                Deleting a file permanently is a Developer-only action, so no
                                delete is offered here.
                            </p>
                        )}
                    </Can>
                </CardContent>
            </Card>

            {deleting ? (
                <DeleteFileDialog
                    file={deleting}
                    open
                    onOpenChange={(next) => setDeleting(next ? deleting : null)}
                    onDeleted={() => {
                        setDeleting(null);
                        refresh();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
