import type { ReactNode } from 'react';
import { ImageOff } from 'lucide-react';

import { NotSet } from '@/components/common/DefinitionList';
import { ImageBox, ImageBoxNotice, IMAGE_BOX_RATIO } from '@/components/files/ImageBox';
import type { LightboxImage } from '@/components/files/ImageLightbox';
import { HighlightedText, RichDescription } from '@/components/listings/ListingBits';
import { Badge } from '@/components/ui/badge';
import { humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isRichDescription, type ListingContent, type ListingContentField } from '@/types/listings.types';

/**
 * One copy of a listing's public content — what a customer sees before paying
 * to unlock anything.
 *
 * ── What the reviewer is looking for ──────────────────────────────────────────
 * A contact slipped into the public text or the photos: that is what the
 * provider's credits pay to reveal. So the excerpts the automatic check found
 * are **marked in the text**, link addresses in the rich description are shown
 * in full, and on a change to a live listing each field the change touches says
 * **Changed** — `changed` is `changedListingFields()`, computed by the caller.
 *
 * ── Photos render from `url`, so no audit row ─────────────────────────────────
 * They sit in a public tree and the detail resolved them to addresses, so
 * `<ImageBox src>` shows them at once and nothing is disclosed that the read did
 * not already give. A photo with no `url` falls back to the audited path, which
 * waits for a click — not expected here, and a blank tile would be worse.
 *
 * Phone-first: one column of label-over-value rows, the photo grid two wide.
 */
export function ListingContentView({
    content,
    changed,
    excerpts = [],
}: {
    content: ListingContent;
    /** Fields that differ from the live copy — only passed for the copy under review. */
    changed?: ReadonlySet<ListingContentField>;
    /** What the automatic check found, to mark in the text. */
    excerpts?: readonly string[];
}) {
    const mark = (field: ListingContentField) => changed?.has(field) ?? false;
    const location = [content.area, content.city, content.country].filter(Boolean).join(', ');

    return (
        <div className="space-y-4">
            <Field label="Title" changed={mark('title')}>
                {content.title ? (
                    <span className="text-base font-medium">
                        <HighlightedText text={content.title} excerpts={excerpts} />
                    </span>
                ) : (
                    <NotSet />
                )}
            </Field>

            <Field label="Company name" changed={mark('companyName')}>
                {content.companyName ? <HighlightedText text={content.companyName} excerpts={excerpts} /> : <NotSet />}
            </Field>

            <Field label="Categories" changed={mark('categories')}>
                {content.categories.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                        {content.categories.map((category) => (
                            <Badge
                                key={category.id}
                                variant="secondary"
                                className={cn(!category.name && 'italic')}
                                title={category.name ? undefined : `Category ${category.id} no longer exists`}
                            >
                                {category.name ?? 'Removed category'}
                            </Badge>
                        ))}
                    </span>
                ) : (
                    <NotSet>None chosen</NotSet>
                )}
            </Field>

            <Field label="Where" changed={mark('location')}>
                {location ? <HighlightedText text={location} excerpts={excerpts} /> : <NotSet />}
            </Field>

            <Field label="Description" changed={mark('description')}>
                {isRichDescription(content.descriptionRich) ? (
                    <RichDescription doc={content.descriptionRich} excerpts={excerpts} />
                ) : content.description ? (
                    <p className="text-sm whitespace-pre-wrap">
                        <HighlightedText text={content.description} excerpts={excerpts} />
                    </p>
                ) : (
                    <NotSet>No description</NotSet>
                )}
            </Field>

            <Field label="Opening hours" changed={mark('openingHours')}>
                {content.openingHours && content.openingHours.length > 0 ? (
                    <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
                        {content.openingHours.map((hours, index) => (
                            <li key={`${hours.day ?? 'day'}-${index}`} className="flex justify-between gap-3">
                                <span className="capitalize">{humaniseEnum(hours.day) ?? 'Day not set'}</span>
                                <span className="text-muted-foreground tabular-nums">
                                    {hours.isClosed
                                        ? 'Closed'
                                        : `${hours.openTime ?? '?'} – ${hours.closeTime ?? '?'}`}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <NotSet>Not given</NotSet>
                )}
            </Field>

            <Field
                label={`Photos (${content.photos.length})`}
                changed={mark('photos')}
                hint="Check each one by eye for a phone number, a sign or a link."
            >
                <ListingPhotos content={content} />
            </Field>
        </div>
    );
}

function Field({
    label,
    changed,
    hint,
    children,
}: {
    label: string;
    changed: boolean;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <section
            className={cn(
                'space-y-1',
                changed && 'border-warning/60 -ml-3 border-l-2 pl-2.5',
            )}
        >
            <h4 className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide uppercase">
                {label}
                {changed ? (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning normal-case">
                        Changed
                    </Badge>
                ) : null}
            </h4>
            {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
            <div className="text-sm break-words">{children}</div>
        </section>
    );
}

function ListingPhotos({ content }: { content: ListingContent }) {
    if (content.photos.length === 0) {
        return (
            <ImageBoxNotice
                ratio={IMAGE_BOX_RATIO}
                className="max-w-[12rem]"
                icon={ImageOff}
                title="No photos"
                body="The provider has not added any."
            />
        );
    }
    const alt = (index: number) => `${content.title ?? 'Listing'} — photo ${index + 1}`;
    const gallery: LightboxImage[] = content.photos
        .filter((photo) => photo.url !== null)
        .map((photo) => ({ src: photo.url!, alt: alt(content.photos.indexOf(photo)), caption: photo.originalName ?? undefined }));

    return (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {content.photos.map((photo, index) => (
                <li key={photo.id}>
                    {photo.url ? (
                        <ImageBox
                            src={photo.url}
                            alt={alt(index)}
                            gallery={{ images: gallery, index: Math.max(0, gallery.findIndex((g) => g.src === photo.url)) }}
                        />
                    ) : (
                        <ImageBox file={photo} alt={alt(index)} />
                    )}
                </li>
            ))}
        </ul>
    );
}
