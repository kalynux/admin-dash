/**
 * Hand the browser a file to save.
 *
 * Lifted out of `AccountStatementDialog` when the article body's JSON export
 * became the second caller.
 */
export function saveFile(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    } finally {
        // Safe synchronously — the download is queued by the time `click()`
        // returns — and in a `finally` so a throw cannot leak the object URL.
        URL.revokeObjectURL(url);
    }
}
