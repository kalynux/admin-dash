import { useState } from 'react';
import { Images } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { MediaPickerDialog } from '@/components/files/MediaPickerDialog';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { createAuthor, updateAuthor } from '@/services/content.service';
import { ApiError } from '@/types/api.types';
import {
    ARTICLE_AUTHOR_TYPES,
    ARTICLE_ID_MAX,
    ARTICLE_ID_MIN,
    ARTICLE_ID_PATTERN,
    AUTHOR_BIO_MAX,
    AUTHOR_NAME_MAX,
    AUTHOR_TITLE_MAX,
    AVATAR_URL_MAX,
    CODE_AUTHOR_KEY_TAKEN,
    DEFAULT_CONTENT_LOCALE,
    type ArticleAuthor,
    type ArticleAuthorType,
} from '@/types/content.types';

/**
 * `POST /content/authors` and `PATCH /content/authors/:authorId`.
 *
 * ── 🔴 Three fields here were wrong until the 2026-08-25 contract correction ──
 * This dialog sent `{ key, name, bio, avatarUrl }`. The schema is `.strict()`
 * and expects `{ id, name, type, avatarUrl?, translations }`, so **every save
 * was a `400`**: `key` is not a field, `bio` is not a field, and `type` — which
 * is required — was never sent at all. See `content.types.ts`.
 *
 * ── The id is the address, and it is immutable ────────────────────────────────
 * Like an article's, a byline is addressed by a stable string rather than an
 * ObjectId, and it is `id` on the wire even though the *path* parameter is
 * `:authorId`. On an edit the field is shown and disabled: it identifies the
 * record every article's `authorId` points at, and changing it would strand
 * them.
 *
 * ── ⚠ `type` is not cosmetic ─────────────────────────────────────────────────
 * It becomes the `@type` of the `author` node in the article's `BlogPosting`
 * structured data. A house byline like "Wi-Mall Editorial" is an
 * `Organization`; marking it `Person` asserts to a search engine that a human by
 * that name exists, which is the class of claim that earns a manual action
 * rather than a warning. So it is a deliberate choice, defaulted to
 * `Organization` — the safer assertion of the two.
 *
 * ── ⚠ The bio is per language, and English is required ───────────────────────
 * There is no scalar `bio`. `translations` is keyed by locale and **`en` is
 * mandatory**: it is the fallback every other locale resolves to, so an author
 * without it renders a blank byline in four languages. This dialog edits the
 * English entry, which is the one that must exist; the others are preserved
 * untouched, because `translations` is a **full replace** and dropping them here
 * would silently delete four languages of copy.
 *
 * ── `avatarUrl` is an absolute URL, not an upload ─────────────────────────────
 * wi-admin accepts no multipart body anywhere. And unlike an article image's, it
 * is `.url()` — an internal path is refused here.
 */
const schema = z.object({
    id: z
        .string()
        .trim()
        .min(ARTICLE_ID_MIN, `Use at least ${ARTICLE_ID_MIN} characters`)
        .max(ARTICLE_ID_MAX)
        .regex(
            ARTICLE_ID_PATTERN,
            'Use lowercase letters, numbers and hyphens — it becomes part of an address',
        ),
    name: z.string().trim().min(1, 'A name is required').max(AUTHOR_NAME_MAX),
    type: z.enum(ARTICLE_AUTHOR_TYPES),
    title: z
        .string()
        .trim()
        .min(1, 'An English title is required — it is the fallback for every other language')
        .max(AUTHOR_TITLE_MAX),
    bio: z
        .string()
        .trim()
        .min(1, 'An English bio is required — it is the fallback for every other language')
        .max(AUTHOR_BIO_MAX, `Use at most ${AUTHOR_BIO_MAX} characters`),
    avatarUrl: z
        .string()
        .trim()
        .max(AVATAR_URL_MAX)
        // Absolute only, and only when given: the field is optional, so an empty
        // box must not fail `.url()` on its way to being omitted.
        .refine((value) => value.length === 0 || /^https?:\/\/\S+$/i.test(value), {
            message: 'Use a full https:// address, or leave it blank',
        }),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['id', 'name', 'type', 'avatarUrl', 'translations'] as const;
/** The subset that maps to a control; `translations` has no field of its own. */
const FORM_FIELDS = ['id', 'name', 'type', 'avatarUrl'] as const;

export function AuthorFormDialog({
    author,
    open,
    onOpenChange,
    onSaved,
}: {
    /** Absent means create. */
    author?: ArticleAuthor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const editing = author !== undefined;
    const english = author?.translations[DEFAULT_CONTENT_LOCALE];

    /**
     * Every language except English, kept aside so the full-array replace does
     * not destroy them. This dialog edits `en` because `en` is the one the
     * schema requires; the rest travel back unchanged.
     */
    const otherLocales = Object.fromEntries(
        Object.entries(author?.translations ?? {}).filter(
            ([locale]) => locale !== DEFAULT_CONTENT_LOCALE,
        ),
    );
    const otherLocaleCount = Object.keys(otherLocales).length;

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            id: author?.id ?? '',
            name: author?.name ?? '',
            type: author?.type ?? 'Organization',
            title: english?.title ?? '',
            bio: english?.bio ?? '',
            avatarUrl: author?.avatarUrl ?? '',
        },
    });

    // `useWatch`, not `useForm`'s `watch()` — the latter cannot be memoized, so
    // the compiler skips the whole component and every render re-runs.
    const authorType = useWatch({ control: form.control, name: 'type' });

    async function onSubmit(values: Values) {
        setFormError(null);

        const translations = {
            ...otherLocales,
            en: { title: values.title, bio: values.bio },
        };

        try {
            if (editing) {
                await updateAuthor(author.id, {
                    name: values.name,
                    type: values.type,
                    // `null` clears it; `""` is refused by the schema, so the
                    // empty box has to become an explicit null rather than pass
                    // straight through.
                    avatarUrl: values.avatarUrl || null,
                    translations,
                });
                notify.success('Byline updated');
            } else {
                await createAuthor({
                    id: values.id,
                    name: values.name,
                    type: values.type,
                    avatarUrl: values.avatarUrl || null,
                    translations,
                });
                notify.success('Byline created');
            }
            onOpenChange(false);
            onSaved();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.code === CODE_AUTHOR_KEY_TAKEN) {
                    form.setError('id', { message: 'Another byline already uses that id.' });
                    return;
                }
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                for (const key of FORM_FIELDS) {
                    if (fields[key]) {
                        form.setError(key, { message: fields[key] });
                        return;
                    }
                }
                // A `translations` failure has no control of its own — the two
                // English boxes are the only part of it this dialog writes, so
                // it lands on the bio rather than disappearing into the banner.
                if (fields.translations) {
                    form.setError('bio', { message: fields.translations });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{editing ? 'Edit byline' : 'New byline'}</DialogTitle>
                    <DialogDescription>
                        How an article is credited on the public site. This is not an
                        administrator account.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                        id="author-id"
                        label="Id"
                        error={form.formState.errors.id?.message}
                        hint={
                            editing
                                ? 'Immutable — every article credits this byline by id, so changing it would strand them.'
                                : 'Becomes part of an address. Lowercase letters, numbers and hyphens.'
                        }
                    >
                        {(field) => (
                            <Input
                                {...field}
                                {...form.register('id')}
                                disabled={editing}
                                placeholder="wimall-editorial"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        )}
                    </FormField>

                    <FormField
                        id="author-name"
                        label="Name"
                        error={form.formState.errors.name?.message}
                        hint="What a reader sees under the headline."
                    >
                        {(field) => (
                            <Input
                                {...field}
                                {...form.register('name')}
                                placeholder="Wi-Mall Editorial"
                            />
                        )}
                    </FormField>

                    <FormField
                        id="author-type"
                        label="Kind of byline"
                        error={form.formState.errors.type?.message}
                        hint="A house or team byline is an organisation. Choose “person” only for a real named individual — it is published as a claim that they exist."
                    >
                        {(field) => (
                            <Select
                                value={authorType}
                                onValueChange={(next) =>
                                    form.setValue('type', next as ArticleAuthorType, {
                                        shouldDirty: true,
                                    })
                                }
                            >
                                <SelectTrigger {...field}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Organization">
                                        Organisation — a house or team byline
                                    </SelectItem>
                                    <SelectItem value="Person">
                                        Person — a named individual
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </FormField>

                    <FormField
                        id="author-title"
                        label="Title (English)"
                        error={form.formState.errors.title?.message}
                        hint="The line under the name — “Payments lead”, say."
                    >
                        {(field) => (
                            <Input
                                {...field}
                                {...form.register('title')}
                                placeholder="The Wi-Mall editorial desk"
                            />
                        )}
                    </FormField>

                    <FormField
                        id="author-bio"
                        label="Bio (English)"
                        error={form.formState.errors.bio?.message}
                        hint="Required. English is the fallback every other language resolves to, so a byline without it renders blank in four languages."
                    >
                        {(field) => <Textarea rows={3} {...field} {...form.register('bio')} />}
                    </FormField>

                    {otherLocaleCount > 0 ? (
                        <p className="text-muted-foreground text-xs">
                            This byline also has copy in {otherLocaleCount} other language
                            {otherLocaleCount === 1 ? '' : 's'}. It is kept as it is — only the
                            English entry is edited here.
                        </p>
                    ) : null}

                    {/*
                      🔴 The hint here said *"no route on this service accepts a
                      file"*, which was the contract until BR-015 landed
                      `POST /files/upload` on 2026-08-26. The field is still a
                      **url** — a byline's avatar is a stored string served to
                      anonymous readers — so the picker is `requirePublicUrl`, and
                      a private-tree file stays unusable here for a reason that has
                      nothing to do with uploading.
                    */}
                    <FormField
                        id="author-avatar"
                        label="Avatar URL"
                        error={form.formState.errors.avatarUrl?.message}
                        hint="Optional, and a full address rather than a file id. Leave blank to clear it."
                    >
                        {(field) => (
                            <div className="flex items-start gap-2">
                                <Input
                                    {...field}
                                    {...form.register('avatarUrl')}
                                    placeholder="https://cdn.example.com/authors/editorial.png"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setPickerOpen(true)}
                                >
                                    <Images className="size-4" />
                                    Browse
                                </Button>
                            </div>
                        )}
                    </FormField>

                    <MediaPickerDialog
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        title="Choose an avatar"
                        requirePublicUrl
                        onSelect={(file) => {
                            if (file.url) {
                                // `shouldDirty` so the form knows it changed —
                                // a picked value that leaves the form pristine
                                // would be dropped by a submit guard.
                                form.setValue('avatarUrl', file.url, { shouldDirty: true });
                            }
                        }}
                    />

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            {editing ? 'Save byline' : 'Create byline'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
