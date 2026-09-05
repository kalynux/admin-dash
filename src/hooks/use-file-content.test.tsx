import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useFileContent } from '@/hooks/use-file-content';
import { __liveObjectUrls } from '@/test/setup';
import { errorResponse, stubFetch } from '@/test/utils';
import { ApiError } from '@/types/api.types';

const FILE_ID = '6612a4f0c1a2b3d4e5f60719';

function bytes(body = 'JPEGBYTES', headers: Record<string, string> = {}) {
    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', ...headers },
    });
}

describe('useFileContent', () => {
    it('fetches nothing until open() is called', async () => {
        /**
         * ⚠ **The load-bearing assertion in this file**, and the reason the hook
         * exists as its own module rather than as a `useEffect` in each viewer.
         * Every open writes an audit row, and that row is the entire reason
         * Support may hold `files.content.read`. A hook that fetched on mount
         * would file a disclosure against an operator who merely scrolled past a
         * shipment — the trail would then read as forty deliberate reads in an
         * afternoon when nobody looked at anything, which destroys the only
         * signal the row exists to carry.
         *
         * If this goes, every `ImageBox` on a shipment list becomes an audited
         * read, silently.
         */
        const calls = stubFetch(() => bytes());

        const { result } = renderHook(() => useFileContent(FILE_ID));

        expect(calls).toHaveLength(0);
        expect(result.current.content).toBeNull();
        expect(result.current.isLoading).toBe(false);
    });

    it('wraps the bytes in an object url when asked', async () => {
        const calls = stubFetch(() => bytes());

        const { result } = renderHook(() => useFileContent(FILE_ID));
        await act(() => result.current.open());

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain(`/files/${FILE_ID}/content`);
        expect(result.current.content?.objectUrl).toMatch(/^blob:/);
        expect(result.current.content?.mimeType).toBe('image/jpeg');
        expect(__liveObjectUrls()).toHaveLength(1);
    });

    it('revokes the previous handle when it is opened twice', async () => {
        // The double-click guard. Without it the first handle is stranded with
        // nothing left holding a reference to revoke it, and it stays pinned for
        // the lifetime of the document.
        stubFetch(() => bytes());

        const { result } = renderHook(() => useFileContent(FILE_ID));
        await act(() => result.current.open());
        const first = result.current.content?.objectUrl;
        await act(() => result.current.open());

        expect(result.current.content?.objectUrl).not.toBe(first);
        expect(__liveObjectUrls()).toHaveLength(1);
    });

    it('revokes on unmount', async () => {
        // Otherwise the blob is pinned for the lifetime of the document, and on a
        // busy queue that is an operator's whole session holding every proof
        // photo they opened.
        stubFetch(() => bytes());

        const { result, unmount } = renderHook(() => useFileContent(FILE_ID));
        await act(() => result.current.open());

        expect(__liveObjectUrls()).toHaveLength(1);
        unmount();
        await waitFor(() => expect(__liveObjectUrls()).toHaveLength(0));
    });

    it('reports a failure without leaving a handle behind', async () => {
        stubFetch(() =>
            errorResponse(409, 'FILE_CONTENT_NOT_SUPPORTED', { category: 'business_rule' }),
        );

        const { result } = renderHook(() => useFileContent(FILE_ID));
        await act(() => result.current.open());

        expect(result.current.error).toBeInstanceOf(ApiError);
        expect((result.current.error as ApiError).code).toBe('FILE_CONTENT_NOT_SUPPORTED');
        expect(result.current.content).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(__liveObjectUrls()).toHaveLength(0);
    });
});
