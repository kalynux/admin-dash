import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, Eye, FileQuestion, ImagePlus, Lock, RotateCw } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { InlineLoader } from '@/components/common/Loading';
import { ImageBox, ImageBoxFrame, ImageBoxNotice, IMAGE_BOX_RATIO } from '@/components/files/ImageBox';
import { Button } from '@/components/ui/button';
import { useFileContent } from '@/hooks/use-file-content';
import { resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { getRefundProof, uploadRefundProof } from '@/services/refunds.service';
import { ApiError } from '@/types/api.types';
import { isViewableImage } from '@/types/files.types';
import type { RefundProofState } from '@/types/refunds.types';

/**
 * A refund proof picture — `GET /refunds/proofs/:fileId`, **on click only**.
 *
 * ⚠ **Every open writes an audit row first** (`orders.refund.proof.read`), and
 * the picture is a customer's phone number in their own conversation, or a
 * payment receipt. So it is fetched from a click and never on mount, exactly
 * like `ImageBox` over `/files/:fileId/content` — the same hook, pointed at the
 * refund route. Private tree: there is no public URL and never will be.
 *
 * `key={fileId}` at the call site is what points a box at a different file.
 */
export function RefundProofImage({ fileId, alt }: { fileId: string; alt: string }) {
    const { content, error, isLoading, open } = useFileContent(fileId, getRefundProof);
    const ratio = IMAGE_BOX_RATIO;

    if (error instanceof ApiError && error.isNotFound) {
        return (
            <ImageBoxNotice
                ratio={ratio}
                icon={FileQuestion}
                title="This proof is no longer stored"
                body="The request still names it, but the picture itself is gone."
            />
        );
    }

    if (error) {
        return (
            <ImageBoxNotice
                ratio={ratio}
                tone="destructive"
                icon={AlertTriangle}
                title={resolveErrorMessage(error)}
                body={resolveErrorDetail(error)}
                action={
                    <Button variant="outline" size="sm" onClick={open} disabled={isLoading}>
                        Try again
                    </Button>
                }
            />
        );
    }

    if (content) {
        if (!isViewableImage(content)) {
            return (
                <ImageBoxNotice
                    ratio={ratio}
                    icon={FileQuestion}
                    title={`${content.mimeType || 'This file'} is not an image`}
                    body={`${formatBytes(content.size)} arrived.`}
                />
            );
        }
        return <ImageBox src={content.objectUrl} alt={alt} caption={alt} />;
    }

    return (
        <Can
            permission="orders.refund.read"
            fallback={
                <ImageBoxNotice
                    ratio={ratio}
                    icon={Lock}
                    title="Not available to this account"
                    body="Opening refund proofs needs a permission this account does not hold."
                />
            }
        >
            <ImageBoxFrame ratio={ratio}>
                <button
                    type="button"
                    onClick={open}
                    disabled={isLoading}
                    aria-label={
                        isLoading
                            ? `Opening ${alt}`
                            : `Click to view ${alt}. Opening it is recorded against your account.`
                    }
                    className="text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-progress"
                >
                    {isLoading ? (
                        <InlineLoader label="Opening…" />
                    ) : (
                        <>
                            <Eye className="size-6" aria-hidden />
                            <span className="text-sm font-medium">Click to view</span>
                            <span className="text-xs">Opening this is recorded against your account.</span>
                        </>
                    )}
                </button>
            </ImageBoxFrame>
        </Can>
    );
}

/**
 * Pick ONE picture and upload it to `POST /refunds/proofs` at once — the
 * `fileId` that comes back is what the form sends. Uploaded to the **private**
 * `refund-proofs` tree; never `/files/upload`, whose trees are public.
 *
 * ⚠ The upload is audited (`orders.refund.proof.upload`) and happens on pick,
 * not on submit, so the submit carries a real id and a refusal names the field.
 * Picking again replaces the id; the earlier upload stays orphaned on jovi-mall,
 * which is the same trade the media picker makes.
 */
export function RefundProofPicker({
    label,
    hint,
    state,
    onChange,
    error,
    disabled = false,
}: {
    label: string;
    hint?: React.ReactNode;
    state: RefundProofState;
    onChange: (next: RefundProofState) => void;
    /** A field error from the form or the server, shown under the picker. */
    error?: string;
    disabled?: boolean;
}) {
    const inputId = useId();
    const inputRef = useRef<HTMLInputElement>(null);

    // Revoke a local preview once it is replaced or the picker goes away.
    const previewUrl = state.status === 'ready' ? state.previewUrl : null;
    useEffect(() => {
        if (!previewUrl) return undefined;
        return () => URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    async function pick(file: File) {
        onChange({ status: 'uploading', name: file.name });
        try {
            const fileId = await uploadRefundProof(file);
            // A local preview of what was picked — the bytes are already in the
            // browser, so showing them discloses nothing and writes no audit row.
            const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
            onChange({ status: 'ready', fileId, name: file.name, previewUrl: preview });
        } catch (cause) {
            onChange({ status: 'failed', name: file.name, error: cause });
        }
    }

    const busy = state.status === 'uploading';

    return (
        <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">
                {label}
            </label>
            {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}

            <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={disabled || busy}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Reset so picking the same file again still fires `change`.
                    event.target.value = '';
                    if (file) void pick(file);
                }}
            />

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || busy}
                    onClick={() => inputRef.current?.click()}
                >
                    {busy ? (
                        <InlineLoader label="Uploading…" />
                    ) : state.status === 'ready' ? (
                        <>
                            <RotateCw className="size-4" />
                            Replace picture
                        </>
                    ) : (
                        <>
                            <ImagePlus className="size-4" />
                            Choose a picture
                        </>
                    )}
                </Button>
                {state.status === 'ready' ? (
                    <span className="text-muted-foreground text-xs">Uploaded: {state.name}</span>
                ) : null}
            </div>

            {state.status === 'ready' && state.previewUrl ? (
                <div className="max-w-[14rem]">
                    <ImageBox src={state.previewUrl} alt={`Picked proof: ${state.name}`} />
                </div>
            ) : null}

            {state.status === 'failed' ? (
                <p className="text-destructive text-sm" role="alert">
                    Could not upload {state.name}: {resolveErrorMessage(state.error)}
                </p>
            ) : null}
            {error ? (
                <p className="text-destructive text-sm" role="alert">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
