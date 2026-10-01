import { useMemo, useState, type ChangeEvent } from 'react';
import { Check, Copy, Download, FileJson } from 'lucide-react';

import { ArticleBodyPreview } from '@/components/content/ArticleBodyPreview';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useClipboard } from '@/hooks/use-clipboard';
import { countWords, type BodyProblem } from '@/lib/article-body';
import { articleBodyToJson, parseArticleBodyJson } from '@/lib/article-body-json';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { saveFile } from '@/lib/save-file';
import type { ArticleBody } from '@/types/content.types';

/**
 * Export the body being edited as JSON, or replace it from a JSON file.
 *
 * ⚠ **An import replaces the DRAFT, never the stored article.** Both dialogs
 * that host this keep the body in local state and write it only on their own
 * Save, so a file that turns out to be wrong costs nothing — Cancel on the host
 * dialog discards it, and the article is what it was. On top of that, a file
 * the editor cannot even display (see `article-body-json.ts`) is refused here
 * and the draft is not touched at all.
 *
 * ⚠ **Export is the draft as it stands, unsaved edits included** — the same body
 * the Save button would send — so a round trip through a text editor starts from
 * what is on screen rather than from what was last stored.
 */
export function ArticleBodyJson({
    body,
    onImport,
    fileName,
    locale,
    layoutNotice,
}: {
    body: ArticleBody;
    /** Called only with a body that passed the shape check. */
    onImport: (next: ArticleBody) => void;
    fileName: string;
    /** The language being edited — named in the import dialog. */
    locale: string;
    /**
     * A sentence about what replacing this body does to the article's other
     * languages, or `null` when it does nothing. Computed by the host, which is
     * the one that knows whether this language leads or follows.
     */
    layoutNotice?: (next: ArticleBody) => string | null;
}) {
    const [open, setOpen] = useState(false);
    const clipboard = useClipboard();

    async function copy() {
        const ok = await clipboard.copy(articleBodyToJson(body));
        if (!ok) notify.error('The clipboard is not available here — use Download instead.');
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
                {clipboard.copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {clipboard.copied ? 'Copied' : 'Copy JSON'}
            </Button>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                    saveFile(
                        new Blob([articleBodyToJson(body)], { type: 'application/json' }),
                        fileName,
                    )
                }
            >
                <Download className="size-4" />
                Download JSON
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                <FileJson className="size-4" />
                Import JSON
            </Button>

            {open ? (
                <ImportDialog
                    open={open}
                    onOpenChange={setOpen}
                    locale={locale}
                    layoutNotice={layoutNotice}
                    onImport={(next) => {
                        onImport(next);
                        setOpen(false);
                        notify.success(
                            `Body replaced from JSON — not saved yet. Save to keep it, or Cancel to discard it.`,
                        );
                    }}
                />
            ) : null}
        </div>
    );
}

function ProblemList({ problems }: { problems: BodyProblem[] }) {
    return (
        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {problems.map((problem, index) => (
                <li key={index}>
                    {problem.blockIndex === null ? null : (
                        <span className="font-medium">Block {problem.blockIndex + 1}: </span>
                    )}
                    {problem.message}
                </li>
            ))}
        </ul>
    );
}

function ImportDialog({
    open,
    onOpenChange,
    locale,
    layoutNotice,
    onImport,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locale: string;
    layoutNotice?: (next: ArticleBody) => string | null;
    onImport: (next: ArticleBody) => void;
}) {
    const [text, setText] = useState('');
    const [readError, setReadError] = useState<string | null>(null);

    // Checked as it is typed or loaded — the verdict is the preview.
    const result = useMemo(
        () => (text.trim().length > 0 ? parseArticleBodyJson(text) : null),
        [text],
    );
    const notice = result?.ok && layoutNotice ? layoutNotice(result.body) : null;

    async function readFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        // Cleared so choosing the same file again, after fixing it on disk, fires again.
        event.target.value = '';
        if (!file) return;
        setReadError(null);
        try {
            setText(await file.text());
        } catch {
            setReadError(`“${file.name}” could not be read.`);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(96vw,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,56rem)]">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>Import the body from JSON</DialogTitle>
                    <DialogDescription>
                        Replaces the {locale} body in the editor. Nothing is saved until you
                        press Save there — the stored article stays as it is until then.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="article-body-json-file">From a file</Label>
                        <input
                            id="article-body-json-file"
                            type="file"
                            accept=".json,application/json"
                            onChange={readFile}
                            className="text-muted-foreground file:border-input file:bg-background file:text-foreground block w-full text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
                        />
                        {readError ? <p className="text-destructive text-xs">{readError}</p> : null}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="article-body-json-text">Or paste it</Label>
                        <Textarea
                            id="article-body-json-text"
                            value={text}
                            rows={10}
                            spellCheck={false}
                            className="font-mono text-xs"
                            placeholder='[ { "type": "paragraph", "text": [ { "type": "text", "text": "…" } ] } ]'
                            onChange={(event) => setText(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">
                            A list of blocks — the same format Download JSON produces.
                        </p>
                    </div>

                    {result && !result.ok ? (
                        <div
                            role="alert"
                            className="border-destructive/30 bg-destructive/10 space-y-2 rounded-lg border px-4 py-3"
                        >
                            <p className="text-sm font-medium">
                                This can&rsquo;t be imported — the body in the editor stays as it
                                is.
                            </p>
                            <ProblemList problems={result.problems} />
                        </div>
                    ) : null}

                    {result?.ok ? (
                        <div className="space-y-3">
                            <p className="text-sm">
                                <span className="font-medium">Readable:</span>{' '}
                                {formatCount(result.body.length)} block
                                {result.body.length === 1 ? '' : 's'},{' '}
                                {formatCount(countWords(result.body))} words.
                            </p>

                            {result.problems.length > 0 ? (
                                <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-4 py-3">
                                    <p className="text-sm font-medium">
                                        {formatCount(result.problems.length)} thing
                                        {result.problems.length === 1 ? '' : 's'} to fix before
                                        it can be saved
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        It will load, and each problem shows on its block in the
                                        editor. Save stays disabled until they are fixed.
                                    </p>
                                    <ProblemList problems={result.problems} />
                                </div>
                            ) : null}

                            {notice ? (
                                <div className="space-y-1 rounded-lg border px-4 py-3">
                                    <p className="text-sm font-medium">The block layout changes</p>
                                    <p className="text-muted-foreground text-xs">{notice}</p>
                                </div>
                            ) : null}

                            <div className="space-y-1.5">
                                <p className="text-sm font-medium">Preview</p>
                                <div className="bg-muted/20 max-h-[50vh] overflow-y-auto rounded-lg border px-4 py-3">
                                    <ArticleBodyPreview body={result.body} />
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="border-t px-6 py-4">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        disabled={!result?.ok}
                        onClick={() => {
                            if (result?.ok) onImport(result.body);
                        }}
                    >
                        Replace the body
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
