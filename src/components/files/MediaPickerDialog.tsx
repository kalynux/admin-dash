import { useState } from 'react';
import { HardDrive, ImageOff, Lock, RotateCw } from 'lucide-react';

import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { FileUploadPanel } from '@/components/files/FileUploadPanel';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatBytes } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import { listFileLibrary } from '@/services/files.service';
import { useCan } from '@/store';
import {
    isDisplayableImage,
    isQuotaBlocked,
    type FileDetail,
    type LibraryFile,
} from '@/types/files.types';

/** How many tiles a page of the picker shows. Small enough to stay a grid. */
const PICKER_PAGE_SIZE = 12;

interface PickerScope {
    /**
     * Only offer files that carry a usable public `url`. Set by the blog, whose
     * two image fields store a URL rather than a file id.
     */
    requirePublicUrl: boolean;
    /** Narrow the listing and the file dialog to images. */
    imagesOnly: boolean;
}

/**
 * The media picker — **the thing BR-015 was opened for**, and the last of its
 * five blocked asks.
 *
 * ── Why it could not exist before 2026-08-26 ─────────────────────────────────
 * It is specified as showing *only files uploaded by the administration*, and
 * **no administrator had ever been able to upload anything**: wi-admin accepted
 * no multipart body, and the door onto jovi-mall's own upload route was closed
 * at Phase 5 Part B. A picker built then would have been permanently empty, and
 * *a picker with nothing to offer is worse than no picker* — it teaches the
 * operator the feature is broken. Both halves arrived together, which is why
 * this ships with an Upload tab rather than a browse surface alone.
 *
 * ── ⚠ `ownerType=admin` is not a default, it is the specification ────────────
 * The one parameter that makes "only files uploaded by the administration" true.
 * It is deliberately **not** offered as a filter here: widening it would turn a
 * picker into a second door onto every customer's uploaded photographs,
 * reachable from a blog editor. Browsing everything is the Media library, behind
 * its own destination and its own deliberate click.
 *
 * ── ⚠ Two permissions, and neither implies the other ─────────────────────────
 * `files.library.read` browses and `files.upload` writes; both are tiers 1–2 and
 * they are granted separately. A caller holding one sees that tab and a sentence
 * where the other would be — never a control that would 403, and never a request
 * made to discover the refusal.
 *
 * ── ⚠ `requirePublicUrl` is the blog's constraint, and it is real ────────────
 * An article's `cover.url` and an `image` block's `url` are stored strings served
 * to anonymous readers, so a file with `url: null` is unusable there and always
 * will be. The ticket attachment takes a **`fileId`** instead and does not care.
 * Rather than hide the unusable rows — which reads as "there are no files" — they
 * render disabled with the reason on them.
 *
 * ⚠ **"Always will be" has one exception, and it is why the reason is written
 * out rather than inferred from `url === null`.** A file with
 * `access: "quota_blocked"` is in a *public* tree and has had its address
 * withheld because its owner is over their plan's storage cap — so it is
 * unusable on the blog's scope **until somebody upgrades a plan**, which is a
 * different sentence and a different next action from "this file is private".
 * On the `fileId` scopes it is not unusable at all; it is offered with a warning.
 */
export function MediaPickerDialog({
    open,
    onOpenChange,
    onSelect,
    title = 'Choose an image',
    requirePublicUrl = false,
    imagesOnly = true,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Handed the chosen file. The dialog closes itself afterwards. */
    onSelect: (file: FileDetail) => void;
    title?: string;
    requirePublicUrl?: boolean;
    imagesOnly?: boolean;
}) {
    const can = useCan();
    const canBrowse = can('files.library.read');
    const canUpload = can('files.upload');
    const scope: PickerScope = { requirePublicUrl, imagesOnly };

    function choose(file: FileDetail) {
        onSelect(file);
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Files uploaded by the administration. Everything here is stored in a public
                        tree, so its address works for anyone who has it.
                    </DialogDescription>
                </DialogHeader>

                {!canBrowse && !canUpload ? (
                    <p className="text-muted-foreground text-sm">
                        Browsing and uploading files each need a permission this account does not
                        hold. Paste a file id instead, or ask an administrator who holds them.
                    </p>
                ) : (
                    <Tabs defaultValue={canBrowse ? 'library' : 'upload'}>
                        <TabsList>
                            <TabsTrigger value="library" disabled={!canBrowse}>
                                Library
                            </TabsTrigger>
                            <TabsTrigger value="upload" disabled={!canUpload}>
                                Upload
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="library" className="pt-4">
                            {/*
                              ⚠ Mounted behind the permission, not merely hidden by
                              it: `useAsyncData` fires on mount, so rendering this
                              subtree for a caller who cannot browse would spend a
                              request to be told 403 and then draw the refusal.
                            */}
                            {canBrowse ? (
                                <LibraryBrowser scope={scope} onChoose={choose} />
                            ) : (
                                <p className="text-muted-foreground text-sm">
                                    Browsing the library needs a permission this account does not
                                    hold. Upload a file instead.
                                </p>
                            )}
                        </TabsContent>

                        <TabsContent value="upload" className="pt-4">
                            {canUpload ? (
                                <FileUploadPanel
                                    accept={imagesOnly ? 'image/*' : undefined}
                                    onUploaded={(files) => {
                                        // The route answers an array because it
                                        // accepts ten; a picker wants one, and the
                                        // first is the first part sent.
                                        const [first] = files;
                                        if (first) choose(first);
                                    }}
                                />
                            ) : (
                                <p className="text-muted-foreground text-sm">
                                    Uploading needs a permission this account does not hold. Choose
                                    a file from the library instead.
                                </p>
                            )}
                        </TabsContent>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}

/**
 * The browse half. **Mounted only behind `files.library.read`** — see the note
 * at its call site.
 */
function LibraryBrowser({
    scope,
    onChoose,
}: {
    scope: PickerScope;
    onChoose: (file: FileDetail) => void;
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const { token, refresh } = useRefreshToken();

    const query = {
        // ⚠ Fixed, never a filter. See the note on the dialog.
        ownerType: 'admin',
        category: scope.imagesOnly ? 'image' : undefined,
        // `buildQuery` drops `''`, which is what makes clearing the box safe: an
        // empty `?search=` is a `400`, not "no filter".
        search: search || undefined,
        page,
        limit: PICKER_PAGE_SIZE,
    };

    const path = withQuery('/files/library', { ...query });
    const library = useAsyncData(`${path}#${token}`, (signal) => listFileLibrary(query, { signal }));

    const rows = library.data?.files ?? [];
    const meta = library.data?.meta;

    return (
        <div className="space-y-4">
            <div className="flex items-end gap-2">
                <SearchInput
                    label="Search uploads"
                    placeholder="File name"
                    value={search}
                    onChange={(next) => {
                        setSearch(next);
                        setPage(1);
                    }}
                />
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

            {/*
              ⚠ A claim about the DEPLOYMENT, not about these files. `false` means
              wi-admin cannot build a public URL for anything here, so every tile
              would be unusable for a reason that has nothing to do with what was
              uploaded.
            */}
            {meta && !meta.publicUrlsConfigured ? (
                <p className="text-warning text-sm">
                    File previews are not configured on this deployment, so no file here has a
                    usable address. This is a server setting, not a property of these files.
                </p>
            ) : null}

            {library.error ? (
                <ErrorState error={library.error} onRetry={library.reload} />
            ) : library.isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {Array.from({ length: 8 }, (_, index) => (
                        <Skeleton key={index} className="h-32 w-full rounded-lg" />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <EmptyState
                    icon={ImageOff}
                    title={search ? 'No uploads match that' : 'Nothing has been uploaded yet'}
                    description={
                        search
                            ? 'Only files uploaded by the administration appear here. Try a different term, or upload one.'
                            : 'The Upload tab puts the first file here. Files uploaded by vendors, agencies and customers are not offered — this picker only shows the administration’s own.'
                    }
                />
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {rows.map((file) => (
                        <PickerTile key={file.id} file={file} scope={scope} onChoose={onChoose} />
                    ))}
                </div>
            )}

            {meta ? (
                <Pager
                    meta={meta}
                    noun="files"
                    isBusy={library.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}

/**
 * One tile.
 *
 * ⚠ **An unusable file is DISABLED, never hidden.** Filtering it out of the grid
 * would leave an operator looking at a short page with no way to tell whether
 * their file is missing or merely unusable here — and the second is the one they
 * can do something about.
 *
 * ⚠ **No audited read from a picker.** The thumbnail is `<img src>` on a URL the
 * listing already handed over, so nothing is disclosed that the browse did not
 * already give. A private file has no URL and is exactly the file this picker
 * cannot offer, so there is nothing the content route would add here.
 */
function PickerTile({
    file,
    scope,
    onChoose,
}: {
    file: LibraryFile;
    scope: PickerScope;
    onChoose: (file: FileDetail) => void;
}) {
    const displayable = isDisplayableImage(file);

    /**
     * ⚠ `url === null` is the check, not `access`. The blog stores the string, so
     * what matters is whether there is a string to store — and a public file on a
     * deployment that cannot build URLs has `access: "public"` and no `url`.
     */
    const unusable = scope.requirePublicUrl && file.url === null;

    /**
     * ⚠ **The same `null`, for a reason the operator can do something about.**
     * A quota-blocked file is in a public tree and has had its address withheld
     * because its owner is over their plan's storage cap — so on the blog's
     * scope it is unusable *for now* rather than unusable, and saying only "no
     * public address" hides the one fact that would resolve it.
     *
     * ⚠ **It is not disabled where a `fileId` is what gets stored.** The two
     * ticket forms keep the id, the id is valid, and the attachment is a legal
     * thing to make — it simply will not render until the plan is upgraded. That
     * is a warning, not a refusal, and refusing it would be this picker deciding
     * something the contract does not.
     */
    const blocked = isQuotaBlocked(file);

    return (
        <button
            type="button"
            disabled={unusable}
            onClick={() => onChoose(file)}
            title={file.originalName ?? file.id}
            className={cn(
                'focus-visible:ring-ring group flex flex-col overflow-hidden rounded-lg border text-left focus-visible:ring-2 focus-visible:outline-none',
                unusable
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:border-primary hover:bg-muted/40 transition-colors',
            )}
        >
            <div className="bg-muted/30 flex h-24 w-full items-center justify-center overflow-hidden">
                {displayable && file.url ? (
                    <img
                        src={file.url}
                        alt={file.originalName ?? 'Uploaded file'}
                        className="h-full w-full object-contain"
                    />
                ) : blocked ? (
                    // Not a padlock: nothing here is private. The tile is
                    // unrenderable because somebody is over a storage plan.
                    <HardDrive className="text-muted-foreground size-6" aria-hidden />
                ) : (
                    <Lock className="text-muted-foreground size-6" aria-hidden />
                )}
            </div>

            <div className="min-w-0 space-y-0.5 px-2 py-1.5">
                <p className="truncate text-xs font-medium">
                    {file.originalName ?? 'Unnamed upload'}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                    {file.mimeType} · {formatBytes(file.size)}
                </p>
                {blocked ? (
                    <p className="text-muted-foreground text-xs">
                        {unusable
                            ? 'Blocked by a storage limit — no public address until the owner’s plan is upgraded.'
                            : 'Blocked by a storage limit — it will not display until the owner’s plan is upgraded.'}
                    </p>
                ) : unusable ? (
                    <p className="text-muted-foreground text-xs">
                        No public address — cannot be used here.
                    </p>
                ) : null}
            </div>
        </button>
    );
}
