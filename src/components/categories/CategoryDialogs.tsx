import { useState, type FormEvent } from 'react';
import { ArrowRight, Check } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { DataState } from '@/components/common/DataState';
import { InlineLoader, ListSkeleton } from '@/components/common/Loading';
import { SearchInput } from '@/components/common/SearchInput';
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
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { withQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import {
    PLATFORM_CODE_CATEGORY_IN_USE,
    PLATFORM_CODE_CATEGORY_MERGE_INVALID,
    PLATFORM_CODE_CATEGORY_NAME_INVALID,
    PLATFORM_CODE_CATEGORY_NAME_TAKEN,
    deleteCategory,
    isCategoryGone,
    listCategories,
    mergeCategory,
    renameCategory,
} from '@/services/categories.service';
import { ApiError } from '@/types/api.types';
import {
    inUseProductCount,
    mergeInvalidReason,
    nameTakenBy,
    type Category,
    type MergeCategoryResult,
} from '@/types/categories.types';

/** What a merge needs to know about its target. A refusal hands us only these two. */
export interface MergeTarget {
    id: string;
    name: string;
}

/**
 * The one action open at a time. A refusal can turn one into another — a rename
 * whose name is taken becomes a merge into the holder, a refused delete becomes
 * a merge — which is why the three live behind a single controlled value rather
 * than three booleans that could both be true.
 */
export type CategoryAction =
    | { kind: 'rename'; category: Category }
    | { kind: 'merge'; category: Category; target?: MergeTarget }
    | { kind: 'delete'; category: Category };

const products = (count: number) => `${formatCount(count)} ${count === 1 ? 'product' : 'products'}`;

/**
 * Rename, merge and delete on the shared category list — `catalog.categories.manage`.
 *
 * Every write is **delegated** to jovi-mall, so its refusals arrive as
 * `PLATFORM_OPERATION_REJECTED` with the reason in `details.platformCode`, and
 * that is what each dialog branches on. ⚠ The `details` beside a code are
 * forwarded only when jovi-mall's envelope declares a client-safe category, so
 * every reader tolerates them missing.
 *
 * The caller gates the buttons that open these; nothing here checks a permission.
 */
export function CategoryDialogs({
    action,
    onActionChange,
    onRenamed,
    onMerged,
    onDeleted,
    onStale,
}: {
    action: CategoryAction | null;
    onActionChange: (next: CategoryAction | null) => void;
    onRenamed: () => void;
    onMerged: (result: MergeCategoryResult, source: Category) => void;
    onDeleted: (category: Category) => void;
    /** The category on screen is gone — someone else renamed, merged or deleted it. */
    onStale: () => void;
}) {
    const close = () => onActionChange(null);

    /** Shared by all three: say so, close, and let the caller reload. */
    function stale() {
        notify.warning('This category was just changed by someone else', {
            description: 'It was merged or deleted before your change reached it. The list has been refreshed.',
        });
        close();
        onStale();
    }

    // Keyed by the action and its record, so switching rename → merge (or a
    // second row's rename) starts each dialog with a clean form.
    if (action?.kind === 'rename') {
        return (
            <RenameCategoryDialog
                key={`rename-${action.category.id}`}
                category={action.category}
                onClose={close}
                onRenamed={() => {
                    close();
                    onRenamed();
                }}
                onMergeInstead={(target) =>
                    onActionChange({ kind: 'merge', category: action.category, target })
                }
                onStale={stale}
            />
        );
    }
    if (action?.kind === 'merge') {
        return (
            <MergeCategoryDialog
                key={`merge-${action.category.id}-${action.target?.id ?? ''}`}
                source={action.category}
                presetTarget={action.target}
                onClose={close}
                onMerged={(result) => {
                    close();
                    onMerged(result, action.category);
                }}
                onStale={stale}
            />
        );
    }
    if (action?.kind === 'delete') {
        return (
            <DeleteCategoryDialog
                key={`delete-${action.category.id}`}
                category={action.category}
                onClose={close}
                onDeleted={() => {
                    close();
                    onDeleted(action.category);
                }}
                onMergeInstead={() => onActionChange({ kind: 'merge', category: action.category })}
                onStale={stale}
            />
        );
    }
    return null;
}

// ─── Rename ───────────────────────────────────────────────────────────────────

/**
 * `PATCH /categories/:categoryId` — the old spelling stays as an alias, so a
 * vendor who types it still lands here.
 *
 * ⚠ **`CATEGORY_NAME_TAKEN` is an offer, not an error.** The name already
 * belongs to `details.existingName`, and the right move is almost always to
 * merge into it — so the dialog says that and offers the button. With no
 * `existingId` in the details (they may not be forwarded) there is nothing to
 * merge into by id, and it says to pick the category from the list instead.
 */
function RenameCategoryDialog({
    category,
    onClose,
    onRenamed,
    onMergeInstead,
    onStale,
}: {
    category: Category;
    onClose: () => void;
    onRenamed: () => void;
    onMergeInstead: (target: MergeTarget) => void;
    onStale: () => void;
}) {
    const [name, setName] = useState(category.name);
    const [submitting, setSubmitting] = useState(false);
    const [taken, setTaken] = useState<{ id: string | null; name: string | null } | null>(null);
    const [invalid, setInvalid] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const trimmed = name.trim();
    const unchanged = trimmed === category.name;

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        if (!trimmed || unchanged) return;
        setSubmitting(true);
        setTaken(null);
        setInvalid(false);
        setFormError(null);
        try {
            const result = await renameCategory(category.id, trimmed);
            notify.success(`Renamed to ${result.category.name}`, {
                description: `Vendors who type “${result.previousName}” will still land on it.`,
            });
            onRenamed();
        } catch (error) {
            if (isCategoryGone(error)) {
                onStale();
                return;
            }
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_CATEGORY_NAME_TAKEN) {
                    setTaken(nameTakenBy(error.details));
                    return;
                }
                if (error.platformCode === PLATFORM_CODE_CATEGORY_NAME_INVALID) {
                    setInvalid(true);
                    return;
                }
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Rename {category.name}</DialogTitle>
                    <DialogDescription>
                        Every product in it shows the new name. The old spelling keeps working:
                        vendors who type it will land here.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={onSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="category-name">New name</Label>
                        <Input
                            id="category-name"
                            value={name}
                            maxLength={200}
                            autoComplete="off"
                            aria-invalid={invalid || undefined}
                            aria-describedby="category-name-hint"
                            onChange={(event) => {
                                setName(event.target.value);
                                setTaken(null);
                                setInvalid(false);
                            }}
                        />
                        <p
                            id="category-name-hint"
                            className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
                        >
                            {invalid
                                ? 'That name cannot be used. Use 2–60 characters, with at least one letter or digit.'
                                : '2–60 characters, with at least one letter or digit.'}
                        </p>
                    </div>

                    {taken ? (
                        <div
                            role="alert"
                            className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">
                                {taken.name
                                    ? `“${taken.name}” already has that name.`
                                    : 'Another category already has that name, or a spelling of it.'}
                            </p>
                            {taken.id ? (
                                <>
                                    <p className="text-muted-foreground">
                                        Two categories cannot share a name. To bring them together,
                                        merge this one into it.
                                    </p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() =>
                                            onMergeInstead({
                                                id: taken.id as string,
                                                name: taken.name ?? 'the existing category',
                                            })
                                        }
                                    >
                                        Merge into {taken.name ?? 'it'} instead
                                        <ArrowRight className="size-4" />
                                    </Button>
                                </>
                            ) : (
                                <p className="text-muted-foreground">
                                    To bring them together, close this and use Merge on this
                                    category, then pick the other one.
                                </p>
                            )}
                        </div>
                    ) : null}

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={submitting || !trimmed || unchanged}>
                            {submitting ? <InlineLoader /> : null}
                            Rename
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * `POST /categories/:categoryId/merge` — two steps: pick the target, then
 * confirm. ⛔ **There is no un-merge**, which is why the second step exists and
 * why it repeats the product count in the button's own sentence.
 *
 * The picker reads the same list endpoint the screen does, and leaves the
 * source out. A preset target (from a taken name) skips straight to the
 * confirmation.
 */
function MergeCategoryDialog({
    source,
    presetTarget,
    onClose,
    onMerged,
    onStale,
}: {
    source: Category;
    presetTarget?: MergeTarget;
    onClose: () => void;
    onMerged: (result: MergeCategoryResult) => void;
    onStale: () => void;
}) {
    const [target, setTarget] = useState<MergeTarget | null>(presetTarget ?? null);
    const [confirming, setConfirming] = useState(presetTarget !== undefined);
    const [submitting, setSubmitting] = useState(false);
    const [refusal, setRefusal] = useState<string | null>(null);
    const [formError, setFormError] = useState<unknown>(null);

    async function merge() {
        if (!target) return;
        setSubmitting(true);
        setRefusal(null);
        setFormError(null);
        try {
            const result = await mergeCategory(source.id, target.id);
            notify.success(
                `Merged ${result.source.name} into ${result.target.name} — ${products(result.productsUpdated)} moved`,
                {
                    description: `Vendors who type “${result.source.name}” will land on ${result.target.name} from now on.`,
                },
            );
            onMerged(result);
        } catch (error) {
            if (error instanceof ApiError && error.platformCode === PLATFORM_CODE_CATEGORY_MERGE_INVALID) {
                // Back to the picker: the target was the source, or it was retired
                // while this dialog was open. Either way, choose again.
                setRefusal(
                    mergeInvalidReason(error.details) ?? 'Choose a different category that still exists.',
                );
                setConfirming(false);
                setTarget(null);
                return;
            }
            if (isCategoryGone(error)) {
                onStale();
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                {confirming && target ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Merge {source.name} into {target.name}?</DialogTitle>
                            <DialogDescription>
                                Move {products(source.productCount)} from {source.name} to{' '}
                                {target.name}? This cannot be undone.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="bg-muted/50 space-y-1 rounded-lg border px-3 py-2 text-sm">
                            <p>
                                {source.name} is retired. Its names become spellings of{' '}
                                {target.name}, so vendors who type them land there.
                            </p>
                            <p className="text-muted-foreground">
                                A product that already holds both keeps one, in its original
                                place. The count above is from when this page loaded, so the
                                number actually moved is shown afterwards.
                            </p>
                        </div>

                        {formError ? <AuthFormError error={formError} /> : null}

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={submitting}
                                onClick={() => {
                                    if (presetTarget) onClose();
                                    else setConfirming(false);
                                }}
                            >
                                {presetTarget ? 'Cancel' : 'Back'}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={submitting}
                                onClick={merge}
                            >
                                {submitting ? <InlineLoader /> : null}
                                Merge and move {products(source.productCount)}
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>Merge {source.name} into…</DialogTitle>
                            <DialogDescription>
                                Pick the category that stays. Every product in {source.name} moves
                                to it, and {source.name} is retired.
                            </DialogDescription>
                        </DialogHeader>

                        {refusal ? (
                            <p
                                role="alert"
                                className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2 text-sm"
                            >
                                {refusal}
                            </p>
                        ) : null}

                        <MergeTargetPicker
                            sourceId={source.id}
                            selectedId={target?.id ?? null}
                            onSelect={setTarget}
                        />

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={!target}
                                onClick={() => setConfirming(true)}
                            >
                                Continue
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Ten at a time is enough to pick from; a longer list wants a better search term. */
const PICKER_LIMIT = 10;

function MergeTargetPicker({
    sourceId,
    selectedId,
    onSelect,
}: {
    sourceId: string;
    selectedId: string | null;
    onSelect: (target: MergeTarget) => void;
}) {
    const [search, setSearch] = useState('');
    // One extra, so leaving the source out still fills the page.
    const query = { search: search || undefined, sort: 'name', limit: PICKER_LIMIT + 1 };
    const candidates = useAsyncData(`${withQuery('/categories', query)}#merge-target`, (signal) =>
        listCategories(query, { signal }),
    );

    const rows = (candidates.data?.data ?? [])
        .filter((row) => row.id !== sourceId)
        .slice(0, PICKER_LIMIT);
    const more = (candidates.data?.meta.total ?? 0) - (candidates.data?.data.length ?? 0) > 0;

    return (
        <div className="space-y-3">
            <SearchInput
                label="Find the category to keep"
                placeholder="Name or slug"
                value={search}
                onChange={setSearch}
            />

            <DataState
                isLoading={candidates.isLoading}
                error={candidates.error}
                onRetry={candidates.reload}
                isEmpty={rows.length === 0}
                loading={<ListSkeleton rows={4} />}
                empty={
                    <p className="text-muted-foreground py-4 text-center text-sm">
                        {search ? 'No other category matches that.' : 'There is no other category.'}
                    </p>
                }
            >
                <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Categories to merge into">
                    {rows.map((row) => {
                        const selected = row.id === selectedId;
                        return (
                            <li key={row.id}>
                                <button
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => onSelect({ id: row.id, name: row.name })}
                                    className={cn(
                                        'hover:bg-muted flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm',
                                        selected && 'border-primary bg-primary/5',
                                    )}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{row.name}</span>
                                        <span className="text-muted-foreground block truncate text-xs">
                                            {row.slug} · {products(row.productCount)}
                                        </span>
                                    </span>
                                    {selected ? <Check className="text-primary size-4 shrink-0" /> : null}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {more ? (
                    <p className="text-muted-foreground text-xs">
                        Showing the first {PICKER_LIMIT}. Type to narrow the list.
                    </p>
                ) : null}
            </DataState>
        </div>
    );
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * `DELETE /categories/:categoryId` — only an unused category, typically one a
 * vendor created on a save that then failed. The caller offers it only at
 * `productCount === 0`; if a product arrived since, `CATEGORY_IN_USE` turns the
 * dialog into an offer to merge instead, which is how a used one is retired.
 */
function DeleteCategoryDialog({
    category,
    onClose,
    onDeleted,
    onMergeInstead,
    onStale,
}: {
    category: Category;
    onClose: () => void;
    onDeleted: () => void;
    onMergeInstead: () => void;
    onStale: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [inUse, setInUse] = useState<{ count: number | null } | null>(null);
    const [formError, setFormError] = useState<unknown>(null);

    async function remove() {
        setSubmitting(true);
        setFormError(null);
        try {
            await deleteCategory(category.id);
            notify.success(`Deleted ${category.name}`);
            onDeleted();
        } catch (error) {
            if (error instanceof ApiError && error.platformCode === PLATFORM_CODE_CATEGORY_IN_USE) {
                setInUse({ count: inUseProductCount(error.details) });
                return;
            }
            if (isCategoryGone(error)) {
                onStale();
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete {category.name}?</DialogTitle>
                    <DialogDescription>
                        No product uses it, so nothing else changes. A vendor who types this name
                        again will create it again.
                    </DialogDescription>
                </DialogHeader>

                {inUse ? (
                    <div
                        role="alert"
                        className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm"
                    >
                        <p className="font-medium">
                            {inUse.count !== null
                                ? `${products(inUse.count)} now use it, so it was not deleted.`
                                : 'Products now use it, so it was not deleted.'}
                        </p>
                        <p className="text-muted-foreground">
                            A category in use is retired by merging it into another one.
                        </p>
                        <Button type="button" size="sm" onClick={onMergeInstead}>
                            Merge instead
                            <ArrowRight className="size-4" />
                        </Button>
                    </div>
                ) : null}

                {formError ? <AuthFormError error={formError} /> : null}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={submitting || inUse !== null}
                        onClick={remove}
                    >
                        {submitting ? <InlineLoader /> : null}
                        Delete
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
