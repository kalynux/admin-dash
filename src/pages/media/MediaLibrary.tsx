import { useMemo, useState } from 'react';
import { FileIcon, ImageOff, Lock, RotateCw, Trash2, Upload } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { DeleteFileDialog, type DeletableFile } from '@/components/files/DeleteFileDialog';
import { FileUploadPanel } from '@/components/files/FileUploadPanel';
import { ImageBox, ImageBoxFrame } from '@/components/files/ImageBox';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { resolveDayFilter, resolveTimeZone } from '@/lib/datetime';
import { formatBytes, formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listFileLibrary } from '@/services/files.service';
import { useAdmin, useCan } from '@/store';
import {
    FILE_CATEGORIES,
    FILE_LIBRARY_SORT_DEFAULT,
    FILE_OWNER_TYPES,
    FILE_PROVIDERS,
    FILE_USAGE_FILTERS,
    isViewableImage,
    type FileLibraryQuery,
    type LibraryFile,
} from '@/types/files.types';

/**
 * The filters this screen owns, and therefore the query keys in the URL.
 *
 * `createdFrom` / `createdTo` hold **calendar days**, not instants, and are named
 * differently from the wire's `createdAfter` / `createdBefore` for that reason:
 * the contract refuses a date-only value, so the day is resolved in the
 * operator's own timezone at request time. A shared link then says the same
 * *days* to each reader rather than the same absolute moment — the rule every
 * other list on this dashboard follows.
 */
const FILTER_KEYS = [
    'search',
    'category',
    'ownerType',
    'usage',
    'provider',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: FILE_LIBRARY_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * `GET /files/library` · **`files.library.read`** (tiers 1 · 2) · direct read.
 *
 * Every file on the platform, with its owner's name and what refers to it — the
 * Media menu BR-015 was opened for, and the surface the picker draws from.
 *
 * ── ⚠ Why this screen has its own permission ────────────────────────────────
 * Because it **enumerates**. Every tier holds `files.resolve` on one argument:
 * the caller already holds a 24-hex id, so resolving it discloses nothing they
 * did not have. That argument does not survive a listing, which is why browsing
 * is a second name at a narrower tier — `files.orphans.read` drew the line and
 * this is its third instance. **Support sees no part of this module.**
 *
 * ── ⚠ The read is NOT audited, and this dashboard argued that it should be ───
 * The refusal is reasoned at ADR-021 D-6: ADR-006 D-5's exception test is the
 * disclosure itself, and a filename with a size is not one, while auditing every
 * page of a media picker would bury the four real disclosures. Recorded here so
 * it is revisited rather than rediscovered — it is purely additive if it is ever
 * wanted.
 *
 * ── ⚠ Three fields on this screen are traps, and each has a note where it is
 * rendered ──
 * `usage` the *filter* is not the complement of `referenceCount` the *count*;
 * `references` is capped and the cap is in `meta`; and `publicUrlsConfigured` is
 * a statement about the deployment rather than about any file.
 *
 * ── There is deliberately no size filter ─────────────────────────────────────
 * `minSize` / `maxSize` are on the wire and are not offered. The question they
 * answer — *"what is taking up space"* — is answered better by the sortable
 * **Size** column, which needs no unit convention; a byte-range box would need
 * one, and the wire has none. Recorded so the omission is read as a choice.
 */
export function MediaLibrary() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );
    const { token, refresh } = useRefreshToken();

    const [deleting, setDeleting] = useState<DeletableFile | null>(null);
    const [uploadOpen, setUploadOpen] = useState(false);

    const query = useMemo<FileLibraryQuery>(() => {
        const range = resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            // `buildQuery` drops `''`, which is what makes clearing the box safe:
            // an empty `?search=` is a `400`, not "no filter".
            search: values.search || undefined,
            category: values.category || undefined,
            ownerType: values.ownerType || undefined,
            usage: values.usage || undefined,
            provider: values.provider || undefined,
            // ⚠ One `sort` token, never `sortBy` + `sortOrder`. The wrong form is
            // dropped silently and answers `200` in the default order.
            sort: values.sort || FILE_LIBRARY_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            createdAfter: range.from,
            createdBefore: range.to,
        };
    }, [values, page, timeZone]);

    const path = withQuery('/files/library', { ...query });
    const library = useAsyncData(`${path}#${token}`, (signal) =>
        listFileLibrary(query, { signal }),
    );

    const rows = library.data?.files ?? [];
    const meta = library.data?.meta;
    const referenceCap = meta?.referenceSampleCap ?? 0;

    const columns = useMemo<Column<LibraryFile>[]>(
        () => [
            {
                id: 'file',
                header: 'File',
                sortKey: 'originalName',
                className: 'align-top',
                cell: (file) => (
                    <div className="flex min-w-0 items-start gap-3">
                        <LibraryThumbnail file={file} />
                        <div className="min-w-0 space-y-0.5">
                            <p className="truncate text-sm font-medium">
                                {file.originalName ?? 'Unnamed upload'}
                            </p>
                            <CopyableValue variant="id" value={file.id} label="file ID" />
                            {/*
                              ⚠ The storage key is diagnostic and is NOT a public
                              locator — a URL is never built from it. It is here
                              because it names the tree, which is what explains a
                              null address on the row above.
                            */}
                            <p className="text-muted-foreground truncate font-mono text-xs">
                                {file.key}
                            </p>
                        </div>
                    </div>
                ),
            },
            {
                id: 'type',
                header: 'Type',
                sortKey: 'size',
                className: 'align-top text-sm',
                cell: (file) => (
                    <div className="space-y-0.5">
                        <p>{file.mimeType}</p>
                        <p className="text-muted-foreground">{formatBytes(file.size)}</p>
                        <p className="text-muted-foreground text-xs">
                            {file.access === 'public' ? 'Public tree' : 'Private tree'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'owner',
                header: 'Owner',
                className: 'align-top text-sm',
                cell: (file) => <OwnerCell file={file} />,
            },
            {
                id: 'usage',
                header: 'Used by',
                className: 'align-top text-sm',
                cell: (file) => <UsageCell file={file} cap={referenceCap} />,
            },
            {
                id: 'createdAt',
                header: 'Uploaded',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (file) => formatInstantInZone(file.createdAt, timeZone) ?? '—',
            },
        ],
        [timeZone, referenceCap],
    );

    /**
     * The delete, appended rather than folded into the memo above.
     *
     * ⚠ **`files.delete` is tier 1 only and flagged `destructive`**, while this
     * screen is tiers 1–2 — so an Admin browses and is offered nothing to press.
     * The affordance gates on its own permission, exactly as it does on the
     * orphan listing next door.
     *
     * ⚠ **Unlike the orphan listing, a row here may be IN USE.** That is the
     * whole difference between the two screens, and it is carried into the
     * dialog as `referenceCount` rather than left for the operator to remember.
     */
    const canDelete = can('files.delete');
    const tableColumns: Column<LibraryFile>[] = canDelete
        ? [
              ...columns,
              {
                  id: 'actions',
                  header: '',
                  className: 'align-top',
                  cell: (file) => (
                      <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                              setDeleting({
                                  id: file.id,
                                  originalName: file.originalName ?? null,
                                  mimeType: file.mimeType,
                                  size: file.size,
                                  // ⚠ `owner` is `null` on a legacy row, which is
                                  // not the same as an owner whose name did not
                                  // resolve — the dialog renders the type only.
                                  ownerType: file.owner?.type ?? null,
                                  // ⚠ The count, never `references.length`: the
                                  // array is capped and the count is the truth.
                                  referenceCount: file.usage.referenceCount,
                              })
                          }
                      >
                          <Trash2 className="size-4" />
                          Delete
                      </Button>
                  ),
              },
          ]
        : columns;

    return (
        <PageContainer
            title="Library"
            description="Every file stored on the platform, with who uploaded it and what still points at it."
            actions={
                <div className="flex items-center gap-2">
                    <Can permission="files.upload">
                        <Button size="sm" onClick={() => setUploadOpen(true)}>
                            <Upload className="size-4" />
                            Upload
                        </Button>
                    </Can>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={refresh}
                        disabled={library.isLoading || library.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                </div>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search files"
                    placeholder="File name"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.category || ANY}
                    onValueChange={(value) => set({ category: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Category">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any kind</SelectItem>
                        {FILE_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                                {humaniseEnum(category) ?? category}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.ownerType || ANY}
                    onValueChange={(value) => set({ ownerType: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Uploaded by">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any uploader</SelectItem>
                        {FILE_OWNER_TYPES.map((owner) => (
                            <SelectItem key={owner} value={owner}>
                                {humaniseEnum(owner) ?? owner}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.usage || ANY}
                    onValueChange={(value) => set({ usage: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Attachment">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any usage</SelectItem>
                        {FILE_USAGE_FILTERS.map((usage) => (
                            <SelectItem key={usage} value={usage}>
                                {usage === 'used' ? 'Not swept' : 'Marked unused'}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.provider || ANY}
                    onValueChange={(value) => set({ provider: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Storage provider">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any provider</SelectItem>
                        {FILE_PROVIDERS.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                                {provider}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="Uploaded"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    /*
                      ⚠ **No cap, because the endpoint declares none.** Several
                      reads on this service bound their span with a documented
                      `maxDays` and answer `400` past it; `GET /files/library`
                      does not, and inventing a number here would refuse a range
                      the service would have accepted — a client-side refusal
                      dressed as a contract.
                    */
                    maxDays={Number.POSITIVE_INFINITY}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {/*
              ⚠ A statement about the DEPLOYMENT, not about any file. `url: null`
              has three causes and only one of them is the file being private;
              this is the other two. Without it, a page of missing thumbnails
              reads as a broken library.
            */}
            {meta && !meta.publicUrlsConfigured ? (
                <p className="text-warning text-sm">
                    File previews are not configured on this deployment, so no file here has a
                    public address to show. This is a server setting rather than a property of
                    these files — the details below are still accurate.
                </p>
            ) : null}

            {/*
              ADR-005 D-13 forbids a silent truncation, so a filter that hit its
              ceiling says so rather than answering a short page that looks
              complete. Reachable only through an entity filter, which this screen
              does not offer today — kept because the meta can carry it and a
              future drill-down would otherwise inherit the silence.
            */}
            {meta?.entityFilterTruncated ? (
                <p className="text-warning text-sm">
                    More than {formatCount(meta.entityFilterCap ?? 0)} files matched that entity, so
                    this list is a partial answer.
                </p>
            ) : null}

            {meta && !library.isLoading ? (
                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    {formatCount(meta.total)} file{meta.total === 1 ? '' : 's'}
                    {isFiltered ? ' match these filters' : ''}
                    <InfoHint label="About the two usage answers">
                        The <em>usage</em> filter and the <em>used by</em> count answer different
                        questions and can disagree on the same row. The filter reads a flag the
                        platform stamps when a file&rsquo;s last live reference goes, so a file
                        uploaded a minute ago and never attached is <em>not swept</em> with a count
                        of zero. <strong>The count is the precise answer;</strong> the filter is the
                        indexed one.
                    </InfoHint>
                </p>
            ) : null}

            <DataTable
                caption="Files stored on the platform"
                columns={tableColumns}
                rows={rows}
                rowKey={(file) => file.id}
                sort={values.sort || FILE_LIBRARY_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={library.isLoading}
                isRefreshing={library.isRefreshing}
                error={library.error}
                onRetry={library.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={ImageOff}
                        title={isFiltered ? 'No files match these filters' : 'No files stored yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches the name the file was uploaded under.'
                                : 'Every upload on the platform appears here — a vendor’s product photograph, a customer’s ticket attachment, and anything the administration uploads itself.'
                        }
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={reset}>
                                    Clear filters
                                </Button>
                            ) : undefined
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="files"
                    isBusy={library.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Upload a file</DialogTitle>
                        <DialogDescription>
                            The file is stored as the administration&rsquo;s own, which is what
                            makes it offerable in the media picker.
                        </DialogDescription>
                    </DialogHeader>
                    <FileUploadPanel
                        onUploaded={() => {
                            setUploadOpen(false);
                            refresh();
                        }}
                    />
                </DialogContent>
            </Dialog>

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

/**
 * The row's picture, and **the one place on this screen an audited read is
 * reachable**.
 *
 * Three branches, and the middle one is the whole reason this is a component:
 *
 * | Row | What it draws | Costs |
 * |---|---|---|
 * | A public image with a URL | The picture, straight away | Nothing — the listing already handed the address over, so nothing is disclosed that browsing did not |
 * | An image in a private tree | A locked tile that opens a dialog holding the reveal box | Nothing until the operator clicks **twice** |
 * | Anything else | A type icon | Nothing |
 *
 * ⚠ **The private branch is deliberately two clicks, not one.** `GET
 * /files/:fileId/content` writes an audit row on every open, and a browse table
 * is exactly the surface where a one-click reveal becomes twenty disclosures an
 * operator did not mean to file. The tile opens a dialog; the dialog holds the
 * ordinary `ImageBox`, whose own copy says the open is recorded **before** it
 * happens. Neither gesture on its own fetches anything.
 */
function LibraryThumbnail({ file }: { file: LibraryFile }) {
    const [open, setOpen] = useState(false);
    const isImage = isViewableImage(file);

    if (isImage && file.url !== null && file.access === 'public') {
        return (
            <ImageBox
                src={file.url}
                alt={file.originalName ?? 'Uploaded file'}
                className="w-24 shrink-0"
            />
        );
    }

    if (!isImage) {
        return (
            <ImageBoxFrame ratio={4 / 3} className="w-24 shrink-0">
                <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                    <FileIcon className="size-5" aria-hidden />
                </div>
            </ImageBoxFrame>
        );
    }

    return (
        <>
            <ImageBoxFrame ratio={4 / 3} className="w-24 shrink-0">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label={`Open ${file.originalName ?? 'this file'}, which is stored privately`}
                    className="text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring flex h-full w-full flex-col items-center justify-center gap-1 focus-visible:ring-2 focus-visible:outline-none"
                >
                    <Lock className="size-4" aria-hidden />
                    <span className="text-[0.65rem] leading-tight">Private</span>
                </button>
            </ImageBoxFrame>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{file.originalName ?? 'Stored file'}</DialogTitle>
                        <DialogDescription>
                            This file is in a private tree, so it has no public address. Opening it
                            reads the bytes through the platform and is recorded against your
                            account.
                        </DialogDescription>
                    </DialogHeader>
                    {/*
                      The ordinary box, with its ordinary consent copy. Nothing is
                      fetched by opening this dialog — the click inside is what
                      files the audit row.
                    */}
                    <ImageBox file={file} alt={file.originalName ?? 'Stored file'} />
                </DialogContent>
            </Dialog>
        </>
    );
}

/**
 * Who uploaded it — **the "owner (name and role)" the operator's note asked
 * for**.
 *
 * ⚠ **Three states, and collapsing any two is the mistake here.**
 *
 * - `owner: null` — nothing was recorded. A legacy row, and a different fact
 *   from an owner whose name did not resolve.
 * - `owner.name: null` — a role was recorded and the name is not available. The
 *   wire cannot say which of four causes it was (`system` has none by
 *   construction, the record was deleted, the owner is mid-onboarding with no
 *   business name, or the administrator was removed from this service) and it
 *   is deliberate that it cannot, because they render the same way.
 * - A name — rendered, with the role beneath it.
 *
 * ⚠ **`owner.id` is NOT a `users._id`** and never links anywhere. It lives in the
 * owner type's own id space — a `vendors._id`, a `delivery_agents._id`, and for
 * `admin` a wi-admin `admin_accounts._id`. It is copyable and nothing more,
 * which is exactly what `CopyableValue` exists for.
 */
function OwnerCell({ file }: { file: LibraryFile }) {
    if (!file.owner) {
        return <span className="text-muted-foreground">Not recorded</span>;
    }

    const role = file.owner.type
        ? (humaniseEnum(file.owner.type) ?? file.owner.type)
        : 'Unknown role';

    return (
        <div className="min-w-0 space-y-0.5">
            {file.owner.name ? (
                <p className="truncate font-medium">{file.owner.name}</p>
            ) : (
                <p className="text-muted-foreground">No name available</p>
            )}
            <p className="text-muted-foreground text-xs">{role}</p>
            {file.owner.id ? (
                <CopyableValue variant="id" value={file.owner.id} label="owner ID" />
            ) : null}
        </div>
    );
}

/**
 * What still points at the file — **the "is it used or linked to an entity" half
 * of the ask**.
 *
 * ⚠ **`referenceCount` is the truth and `references` is a sample.** The array is
 * capped at `meta.referenceSampleCap`, sent on every response rather than only
 * when it bit, and a stock photograph on four hundred products must not put four
 * hundred rows in one cell. So the count leads, the sample follows, and the
 * remainder is stated — a page that quietly showed five of four hundred would
 * read as the whole answer.
 *
 * ⚠ **`label` is `null` on every row today and that is the built answer**, not a
 * missing field. Filling it would mean a read of a different collection per
 * entity type on the page. The type and the id are what there is; they are
 * enough to go and look.
 */
function UsageCell({ file, cap }: { file: LibraryFile; cap: number }) {
    const { referenceCount, references } = file.usage;

    if (referenceCount === 0) {
        return (
            <div className="space-y-0.5">
                <p className="text-muted-foreground">Nothing points at this</p>
                {/*
                  ⚠ Not the same as being on the orphan screen. That listing has a
                  24-hour floor and a sweep behind it; this is the live count as of
                  this request, and a file uploaded a minute ago reads zero here
                  while being perfectly healthy.
                */}
                <p className="text-muted-foreground text-xs">
                    A file just uploaded reads this way until something attaches it.
                </p>
            </div>
        );
    }

    const hidden = referenceCount - references.length;

    return (
        <div className="min-w-0 space-y-1">
            <p className="font-medium">
                {formatCount(referenceCount)} record{referenceCount === 1 ? '' : 's'}
            </p>
            <ul className="space-y-0.5">
                {references.map((reference) => (
                    <li
                        key={`${reference.entityType}-${reference.entityId}-${reference.field}`}
                        className="min-w-0"
                    >
                        <p className="text-muted-foreground text-xs">
                            {humaniseEnum(reference.entityType) ?? reference.entityType} ·{' '}
                            {reference.field}
                        </p>
                        {/* `label` is null on every row; the id is the handle. */}
                        <CopyableValue
                            variant="id"
                            value={reference.label ?? reference.entityId}
                            label={`${reference.entityType} ID`}
                        />
                    </li>
                ))}
            </ul>
            {hidden > 0 ? (
                <p className="text-muted-foreground text-xs">
                    and {formatCount(hidden)} more — this list shows at most {formatCount(cap)}.
                </p>
            ) : null}
        </div>
    );
}
