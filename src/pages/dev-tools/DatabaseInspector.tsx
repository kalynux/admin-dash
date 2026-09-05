import { Database, RotateCw } from 'lucide-react';

import { DataState, EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatBytes, formatCount } from '@/lib/format';
import { inspectDatabase } from '@/services/system.service';

interface IndexEntry {
    name?: string;
    key?: Record<string, number>;
    unique?: boolean;
    sparse?: boolean;
    reason?: string;
}

function IndexList({
    label,
    tone,
    entries,
    explanation,
}: {
    label: string;
    tone: string;
    entries: IndexEntry[];
    explanation: string;
}) {
    if (entries.length === 0) return null;

    return (
        <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-medium">
                <Badge variant="outline" className={`${tone} font-normal`}>
                    {label} ({entries.length})
                </Badge>
                <span className="text-muted-foreground font-normal">{explanation}</span>
            </p>
            <ul className="text-muted-foreground space-y-0.5 font-mono text-xs">
                {entries.map((entry, index) => (
                    <li key={entry.name ?? index} className="break-all">
                        {entry.name ?? JSON.stringify(entry.key)}
                        {entry.unique ? ' · unique' : ''}
                        {entry.sparse ? ' · sparse' : ''}
                        {entry.reason ? ` — ${entry.reason}` : ''}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Collection statistics and **index drift** — the read that earns this endpoint.
 *
 * ── Why drift is worth a screen ──────────────────────────────────────────────
 * `autoIndex` is on in the platform and **a failed index build fails silently at boot**. A
 * missing unique index does not throw; it lets a duplicate through, months later, in a collection
 * nobody watches. Until this existed the only detector ran by hand over a handful of models.
 *
 * Three buckets, and they are not equally interesting — `missing` leads because it is the
 * actionable one, and `mismatched` is the nastiest (a "unique" index that is not unique in
 * production).
 *
 * ── Reporting only, deliberately ─────────────────────────────────────────────
 * There is no repair button and no endpoint behind one. A unique index build fails outright on a
 * collection that already holds duplicates, and a large build on a primary is an availability
 * event. Reporting is the useful ninety percent; repairing is a decision with a maintenance
 * window attached.
 *
 * ── And two caveats that travel on the wire ──────────────────────────────────
 * `truncated` and `notReached` are rendered prominently, because silent truncation reads as
 * completeness. Drift also reflects only the models that process registered, and an index build
 * in progress reads as `missing`.
 *
 * ── ⚠ Nothing on this screen is a copyable value ─────────────────────────────
 * Worth stating because the name invites the opposite guess: an "inspector" sounds like it
 * returns documents, and a document `_id` would be the obvious thing to copy. It returns
 * **no documents**. Every mono string here is a schema name — a collection, an index, an index
 * key object — read as a set and never pasted anywhere: there is no query box on this service to
 * paste one into, and the screen reports rather than repairs. The counts and byte sizes are
 * figures, not identifiers.
 */
export function DatabaseInspector() {
    const { token, refresh } = useRefreshToken();
    const report = useAsyncData(`/system/platform/database#${token}`, (signal) =>
        inspectDatabase({}, { signal }),
    );

    const collections = report.data?.collections ?? [];

    return (
        <PageContainer
            title="Database"
            description="The platform's collections, their sizes, and where the live indexes differ from what the models declare."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">This reports; it never repairs</CardTitle>
                    <CardDescription>
                        There is no “fix the drift” action here and no endpoint behind one. A
                        unique index build fails outright on a collection that already holds
                        duplicates, and a large build on a primary is an availability event — both
                        are decisions with a maintenance window attached. What this catches is the
                        failure mode that has no other detector: <code>autoIndex</code> is on, and
                        a failed build at boot is silent.
                    </CardDescription>
                </CardHeader>
                {report.data && (report.data.truncated || report.data.notReached.length > 0) ? (
                    <CardContent>
                        <div className="border-warning/40 bg-warning/10 space-y-1 rounded-md border p-3 text-sm">
                            <p className="font-medium">This sweep did not finish</p>
                            <p className="text-muted-foreground text-xs">
                                It is bounded by a wall clock, and stopping quietly would read as
                                “nothing else is wrong”.
                                {report.data.notReached.length > 0
                                    ? ` Not reached: ${report.data.notReached.join(', ')}.`
                                    : ''}
                            </p>
                        </div>
                    </CardContent>
                ) : null}
            </Card>

            <DataState
                isLoading={report.isLoading}
                error={report.error}
                isEmpty={collections.length === 0}
                onRetry={report.reload}
                empty={<EmptyState icon={Database} title="No collections reported" />}
            >
                <div className="space-y-3">
                    {report.data?.summary ? (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {Object.entries(report.data.summary).map(([key, value]) => (
                                <Badge key={key} variant="outline" className="font-normal">
                                    {key}: {formatCount(value)}
                                </Badge>
                            ))}
                        </div>
                    ) : null}

                    <ul className="space-y-2">
                        {collections.map((collection, index) => {
                            const missing = (collection.indexes?.missing ?? []) as IndexEntry[];
                            const extra = (collection.indexes?.extra ?? []) as IndexEntry[];
                            const mismatched = (collection.indexes?.mismatched ??
                                []) as IndexEntry[];
                            const hasDrift =
                                missing.length + extra.length + mismatched.length > 0;

                            return (
                                <li
                                    key={String(collection.name ?? index)}
                                    className="space-y-2 rounded-lg border p-3"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-mono text-sm">
                                            {String(collection.name ?? '—')}
                                        </span>
                                        <span className="text-muted-foreground text-xs">
                                            {typeof collection.documents === 'number'
                                                ? `${formatCount(collection.documents)} documents`
                                                : ''}
                                            {typeof collection.storageSizeBytes === 'number'
                                                ? ` · ${formatBytes(collection.storageSizeBytes)}`
                                                : ''}
                                        </span>
                                    </div>

                                    {hasDrift ? (
                                        <div className="space-y-2 border-t pt-2">
                                            <IndexList
                                                label="Missing"
                                                tone="border-destructive/40 text-destructive"
                                                entries={missing}
                                                explanation="declared but not built — the actionable one"
                                            />
                                            <IndexList
                                                label="Mismatched"
                                                tone="border-warning/40 text-warning"
                                                entries={mismatched}
                                                explanation="same key, different options"
                                            />
                                            <IndexList
                                                label="Extra"
                                                tone="text-muted-foreground"
                                                entries={extra}
                                                explanation="built but declared nowhere — usually migration residue"
                                            />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>

                    {report.data?.notes?.length ? (
                        <ul className="text-muted-foreground space-y-0.5 text-xs">
                            {report.data.notes.map((note) => (
                                <li key={note}>{note}</li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            </DataState>
        </PageContainer>
    );
}
