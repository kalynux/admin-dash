import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { ExportDownloadButton } from '@/components/audit/ExportDownloadButton';
import { DataState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { MAX_DAYS_AUDIT, rangeExceedsMaxDays, resolveTimeZone } from '@/lib/datetime';
import { formatBytes, formatCount, formatInstantInZone } from '@/lib/format';
import { getAuditExport } from '@/services/audit.service';
import { useAdmin } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import type { AuditExport } from '@/types/audit.types';

/** 24-hex, like every id on this service. */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * One export manifest.
 *
 * The fields worth understanding rather than merely displaying:
 *
 * - **`stampedAt` / `stampedCount`** — when the covered rows were marked as
 *   exported, and how many. This is the half that matters for retention: a
 *   stamped row's `purgeAfter` starts counting, an unstamped one's stays `null`
 *   however old it is.
 * - **`purgedAt` / `purgedCount`** — always `null` here. Purging is the CLI's,
 *   deliberately: deletion from a dashboard would be one misclick from
 *   irreversible.
 * - **`fileName`, never a path.** The service does not send a filesystem path,
 *   because it is nothing a dashboard can use and something an attacker can.
 */
export function AuditExportDetail() {
    const { exportId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const isValidId = OBJECT_ID.test(exportId);

    const record = useAsyncData(isValidId ? `/audit/exports/${exportId}` : '', (signal) =>
        isValidId
            ? getAuditExport(exportId, { signal })
            : Promise.reject(new Error('invalid export id')),
    );

    if (!isValidId) {
        return (
            <PageContainer title="Audit export" actions={<BackLink />}>
                <ErrorState
                    error={
                        new ApiError({
                            status: 400,
                            code: CODE_CLIENT_INVALID_ID,
                            message: 'That is not a valid export id.',
                            category: 'validation',
                        })
                    }
                />
            </PageContainer>
        );
    }

    return (
        <PageContainer
            title={record.data?.fileName ?? 'Audit export'}
            description="An export writes rows to a file and marks them as exported. It deletes nothing."
            actions={
                <div className="flex items-center gap-2">
                    <BackLink />
                    {record.data ? <ExportDownloadButton record={record.data} /> : null}
                </div>
            }
        >
            <DataState
                isLoading={record.isLoading}
                error={record.error}
                onRetry={record.reload}
                loading={<DetailSkeleton />}
            >
                {record.data ? <ExportBody record={record.data} timeZone={timeZone} /> : null}
            </DataState>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/audit/exports">
                <ArrowLeft className="size-4" />
                All exports
            </Link>
        </Button>
    );
}

function ExportBody({ record, timeZone }: { record: AuditExport; timeZone: string }) {
    /**
     * A link into the trail for the range this export covered — but only when the
     * trail could actually answer it. `GET /audit` caps a range at 92 days, so
     * offering the link for a wider export would be offering a guaranteed 400.
     */
    const range =
        record.rangeFrom && record.rangeTo ? { from: record.rangeFrom, to: record.rangeTo } : null;
    const rangeIsQueryable = range !== null && !rangeExceedsMaxDays(range, MAX_DAYS_AUDIT);

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">The file</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Name">
                            {record.fileName ? (
                                <span className="font-mono text-xs break-all">
                                    {record.fileName}
                                </span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Rows">
                            {record.rowCount !== null ? formatCount(record.rowCount) : <NotSet />}
                        </Definition>
                        <Definition label="Size">{formatBytes(record.byteSize)}</Definition>
                        <Definition
                            label="SHA-256"
                            hint={
                                <span className="sr-only">
                                    Verify a downloaded file against this.
                                </span>
                            }
                        >
                            {record.sha256 ? (
                                <span className="font-mono text-xs break-all">
                                    {record.sha256}
                                </span>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Status">
                            <span className="capitalize">{record.status}</span>
                            {record.status !== 'complete' ? (
                                <p className="text-muted-foreground text-xs">
                                    {record.status === 'failed'
                                        ? 'This export never finished, so its file is not available and its rows were not stamped.'
                                        : 'Still running — the file is not durable yet.'}
                                </p>
                            ) : null}
                        </Definition>
                        {record.failureReason ? (
                            <Definition label="Failed because">{record.failureReason}</Definition>
                        ) : null}
                        <Definition label="Written by">
                            {record.source === 'cli' ? 'The command line' : 'This dashboard'}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">What it covered</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="From">
                            {record.rangeFrom ? (
                                formatInstantInZone(record.rangeFrom, timeZone)
                            ) : (
                                <NotSet>Open range</NotSet>
                            )}
                        </Definition>
                        <Definition label="To">
                            {record.rangeTo ? (
                                formatInstantInZone(record.rangeTo, timeZone)
                            ) : (
                                <NotSet>Open range</NotSet>
                            )}
                        </Definition>
                        <Definition label="Requested by">
                            {record.requestedByName ??
                                (record.requestedBy ? (
                                    <span className="font-mono text-xs">{record.requestedBy}</span>
                                ) : (
                                    <NotSet>No administrator — written from the CLI</NotSet>
                                ))}
                        </Definition>
                        <Definition label="Started">
                            {formatInstantInZone(record.startedAt, timeZone) ?? '—'}
                        </Definition>
                        <Definition label="Finished">
                            {record.completedAt ? (
                                formatInstantInZone(record.completedAt, timeZone)
                            ) : (
                                <NotSet>Never finished</NotSet>
                            )}
                        </Definition>
                        {rangeIsQueryable ? (
                            <Definition label="In the trail">
                                <Link
                                    to={`/dashboard/audit?from=${range.from.slice(0, 10)}&to=${range.to.slice(0, 10)}`}
                                    className="hover:underline"
                                >
                                    Browse this range
                                </Link>
                            </Definition>
                        ) : null}
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card className="lg:col-span-2">
                <CardHeader>
                    <CardTitle className="text-base">Retention</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">
                        Rows leave the trail only once they have been <strong>exported</strong> and
                        have <strong>aged</strong> — never for age alone. Stamping is what starts
                        the clock; nothing here deletes anything.
                    </p>
                    <DefinitionList>
                        <Definition label="Rows stamped">
                            {record.stampedCount !== null ? (
                                formatCount(record.stampedCount)
                            ) : (
                                <NotSet>None</NotSet>
                            )}
                        </Definition>
                        <Definition label="Stamped at">
                            {record.stampedAt ? (
                                formatInstantInZone(record.stampedAt, timeZone)
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                        <Definition label="Retention window">
                            {formatCount(record.retentionDays)} days
                        </Definition>
                        <Definition label="Rows purged">
                            {record.purgedCount !== null ? (
                                formatCount(record.purgedCount)
                            ) : (
                                <NotApplicable>
                                    Never from the API — purging lives in the CLI
                                </NotApplicable>
                            )}
                        </Definition>
                        <Definition label="Purged at">
                            {record.purgedAt ? (
                                formatInstantInZone(record.purgedAt, timeZone)
                            ) : (
                                <NotApplicable>Never from the API</NotApplicable>
                            )}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>
        </div>
    );
}
