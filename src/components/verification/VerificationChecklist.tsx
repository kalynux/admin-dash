import { Check, CircleSlash, EyeOff, MapPin, Minus, X } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { ImageBox } from '@/components/files/ImageBox';
import { FileViewer } from '@/components/files/FileViewer';
import { Badge } from '@/components/ui/badge';
import { googleMapsUrlFromGeoJson } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { isViewableImage, type FileDetail } from '@/types/files.types';
import type {
    EvidenceState,
    VerdictEstimate,
    VerificationAddress,
    VerificationCheck,
} from '@/types/verification.types';

import { VerdictEstimateBadge } from './VerdictEstimateBadge';

/**
 * The evidence behind a KYC verdict, as rows a reviewer can actually look at.
 *
 * ── ⚠ Every picture waits for a click, and the click is the audit row ────────
 * These are identity documents — an ID card, a photograph of someone holding it,
 * a sketch of where they live. The verification read itself is **not** audited
 * because it hands over handles; `GET /files/:fileId/content` **is**, because
 * *looking at the picture is the disclosure*. So each document renders as an
 * `ImageBox` over the `FileDetail` the payload already carried: no resolve is
 * needed (the metadata is embedded), and no bytes move until somebody asks.
 * Do not add an "open all" affordance here.
 *
 * ── ⚠ `url` is `null` on every one of these, and that is not a fault ─────────
 * They live in jovi-mall's private `kyc/` tree. `ImageBox`'s `file` variant is
 * the one that fetches through the content route; its `src` variant would render
 * a broken icon on **every identity document in the system**, which is the trap
 * `verification.md` spells out. The union makes passing the wrong one a type
 * error, which is why it is a union.
 *
 * ── ⚠ Four states, four renders, and they are not interchangeable ────────────
 * `provided` shows the thing. `missing` says the applicant did not send it.
 * `not_applicable` says nobody asked them to. `unavailable` says **this screen
 * could not read the record** — not loaded, refused, or the request failed —
 * which is neither a fact about the applicant nor a reason to refuse them.
 */
export function VerificationChecklist({
    checks,
    estimate,
    className,
}: {
    checks: VerificationCheck[];
    estimate: VerdictEstimate;
    className?: string;
}) {
    return (
        <section className={cn('space-y-3', className)} aria-label="Verification evidence">
            <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">What the applicant was asked for</h3>
                <VerdictEstimateBadge estimate={estimate} />
            </header>

            <p className="text-muted-foreground text-xs leading-relaxed">{estimate.summary}</p>

            <ol className="divide-y rounded-lg border">
                {checks.map((check) => (
                    <li key={check.key} className="space-y-2 p-3">
                        <ChecklistRow check={check} />
                    </li>
                ))}
            </ol>
        </section>
    );
}

// ─── One row ──────────────────────────────────────────────────────────────────

const STATE_PRESENTATION: Record<
    EvidenceState,
    { icon: typeof Check; label: string; className: string }
> = {
    provided: { icon: Check, label: 'On file', className: 'text-success' },
    missing: { icon: X, label: 'Not supplied', className: 'text-warning' },
    not_applicable: { icon: Minus, label: 'Not asked for', className: 'text-muted-foreground' },
    unavailable: { icon: EyeOff, label: 'Not readable', className: 'text-muted-foreground' },
};

function ChecklistRow({ check }: { check: VerificationCheck }) {
    const presentation = STATE_PRESENTATION[check.state];
    const Icon = presentation.icon;

    return (
        <>
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <Icon className={cn('mt-0.5 size-4 shrink-0', presentation.className)} aria-hidden />
                <span className="min-w-0 flex-1 text-sm font-medium">{check.label}</span>
                {check.state === 'not_applicable' ? null : (
                    <Badge
                        variant="outline"
                        className={cn(
                            'text-[0.65rem]',
                            check.requirement === 'optional' && 'text-muted-foreground',
                        )}
                    >
                        {check.requirement === 'required' ? 'Required' : 'Optional'}
                    </Badge>
                )}
                <span className={cn('text-xs', presentation.className)}>{presentation.label}</span>
            </div>

            {check.condition ? (
                <p className="text-muted-foreground pl-6 text-xs">{check.condition}</p>
            ) : null}

            <div className="pl-6">
                <Evidence check={check} />
            </div>
        </>
    );
}

function Evidence({ check }: { check: VerificationCheck }) {
    if (check.state === 'unavailable') {
        return (
            <p className="text-muted-foreground text-xs leading-relaxed">
                <CircleSlash className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                The verification record could not be read here. Nothing on this row says whether
                the applicant supplied it.
            </p>
        );
    }

    if (check.state === 'not_applicable') {
        return check.detail ? (
            <p className="text-muted-foreground text-xs italic">{check.detail}</p>
        ) : null;
    }

    if (check.state === 'missing') {
        return (
            <p className="text-muted-foreground text-xs leading-relaxed">
                {check.detail ?? 'Nothing is on file for this.'}
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <ProvidedEvidence check={check} />
            {check.detail ? (
                <p className="text-muted-foreground text-xs leading-relaxed">{check.detail}</p>
            ) : null}
        </div>
    );
}

function ProvidedEvidence({ check }: { check: VerificationCheck }) {
    if (check.kind === 'file' && check.file) {
        return <KycDocument file={check.file} alt={check.label} />;
    }

    /*
      A multi-file slot. The applicant may legitimately send several photographs
      of one hand-drawn map — `limits.multiSlotMaxFiles` is the ceiling — so this
      is a row of boxes rather than one, and each still waits for its own click.
    */
    if (check.kind === 'files' && check.files && check.files.length > 0) {
        return (
            <div className="flex flex-wrap gap-2">
                {check.files.map((file, index) => (
                    <KycDocument
                        key={file.id}
                        file={file}
                        alt={
                            check.files!.length > 1
                                ? `${check.label} (${index + 1} of ${check.files!.length})`
                                : check.label
                        }
                    />
                ))}
            </div>
        );
    }

    if (check.kind === 'address' && check.addresses && check.addresses.length > 0) {
        return (
            <ul className="space-y-2">
                {check.addresses.map((address, index) => (
                    <li key={`${address.label ?? 'address'}-${index}`}>
                        <AddressValue address={address} />
                    </li>
                ))}
            </ul>
        );
    }

    if (check.kind === 'text' && check.text) {
        return <CopyableValue value={check.text} variant="plain" label={check.label} />;
    }

    return null;
}

/**
 * One identity document.
 *
 * ⚠ **`ImageBox` with `file`, never `src`.** The `file` variant fetches through
 * the audited content route on click; `src` renders a URL directly, and every
 * file here has `url: null`. Passing `src={file.url}` would not compile, which
 * is the union doing its job.
 *
 * ⚠ **A sketch is as likely to be a PDF as a photograph** — the contract's own
 * example shows `application/pdf` in `homeAddressSketches`. `ImageBox` is for
 * images; anything else goes to `FileViewer`, which offers the same audited open
 * without pretending it can be drawn.
 */
function KycDocument({ file, alt }: { file: FileDetail; alt: string }) {
    if (!isViewableImage(file)) {
        return <FileViewer key={file.id} file={file} />;
    }

    return <ImageBox file={file} alt={alt} className="max-w-[16rem]" caption={alt} />;
}

/**
 * One address, and whether it resolves to a place.
 *
 * ⚠ **The link is built by `googleMapsUrlFromGeoJson` and never by hand.**
 * GeoJSON is `[longitude, latitude]` and Google's query is `lat,lng`; the
 * inversion lives in one tested place because getting it wrong drops the pin in
 * the wrong hemisphere and fails completely silently.
 *
 * ⚠ **Opening it is a disclosure** — the coordinates travel to Google in the
 * address bar — so it is a link the operator chooses to follow, and nothing here
 * fetches a map tile.
 */
function AddressValue({ address }: { address: VerificationAddress }) {
    const mapUrl = address.geocoded ? googleMapsUrlFromGeoJson(address.coordinates) : null;

    return (
        <div className="space-y-1 text-xs">
            <p>
                {address.label ? (
                    <span className="text-muted-foreground">{address.label}: </span>
                ) : null}
                <span className="font-medium">{address.formattedAddress ?? 'No address text'}</span>
            </p>

            {address.geocoded ? (
                <>
                    <p className="text-muted-foreground">
                        Resolved by {address.provider ?? 'an unnamed provider'}
                    </p>
                    {mapUrl ? (
                        <a
                            href={mapUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-primary inline-flex items-center gap-1 hover:underline"
                        >
                            <MapPin className="size-3" aria-hidden />
                            Open the pin on Google Maps
                        </a>
                    ) : (
                        /*
                          `geocoded: true` with an unusable pair. The flag is the
                          service's answer and is not re-derived here — so this
                          reports the disagreement rather than silently
                          downgrading the row to "not geocoded".
                        */
                        <p className="text-warning">
                            Marked geocoded, but the stored coordinates are not a place — the pair
                            is missing or out of range. Worth raising.
                        </p>
                    )}
                </>
            ) : (
                <p className="text-muted-foreground italic">
                    Typed in, never geocoded — it does not resolve to a point on a map.
                </p>
            )}
        </div>
    );
}
