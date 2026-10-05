import { describe, expect, it } from 'vitest';

import {
    createRefundRequest,
    getRefundEligibility,
    getRefundProof,
    settleRefundExternally,
    uploadRefundProof,
} from '@/services/refunds.service';
import { refundRequestFixture } from '@/test/refund-fixtures';
import { stubFetch, successResponse } from '@/test/utils';

/*
 * Every `/refunds` body is `.strict()` upstream: an unknown key is a `400`, and a
 * blank optional string is a `400` where an absent key means "none". These pin
 * that the service builds literals and never forwards a blank.
 */

describe('the refund queue service', () => {
    it('sends the five documented eligibility keys and nothing else', async () => {
        const calls = stubFetch(() => successResponse({ maxRefundable: 1 }));
        await getRefundEligibility({ sourceKind: 'order', sourceId: 'abc', reasonKind: 'return', amount: 5000 });
        const url = new URL(calls[0].url, 'http://localhost');
        expect([...url.searchParams.keys()].sort()).toEqual(['amount', 'reasonKind', 'sourceId', 'sourceKind']);
    });

    it('omits a blank destination name, an unticked override and approve-now', async () => {
        const calls = stubFetch(() =>
            successResponse(refundRequestFixture(), { status: 201, meta: { approveNow: { status: 'not_requested' } } }),
        );
        const result = await createRefundRequest({
            sourceKind: 'order',
            sourceId: 'abc',
            reasonKind: 'return',
            reason: '  broken strap  ',
            overridePolicy: false,
            approveNow: false,
            destination: { phone: '+237 677 00 11 22', name: '   ' },
            destinationProofFileId: 'proof',
        });
        expect(JSON.parse(calls[0].body!)).toEqual({
            sourceKind: 'order',
            sourceId: 'abc',
            reasonKind: 'return',
            reason: 'broken strap',
            destination: { phone: '+237 677 00 11 22' },
            destinationProofFileId: 'proof',
        });
        expect(result.approveNow).toEqual({ status: 'not_requested' });
    });

    it('omits a blank reference on a hand settlement', async () => {
        const calls = stubFetch(() => successResponse(refundRequestFixture({ status: 'completed' })));
        await settleRefundExternally('r1', { method: 'cash', reference: '  ', proofFileId: 'p1' });
        expect(JSON.parse(calls[0].body!)).toEqual({ method: 'cash', proofFileId: 'p1' });
    });

    /** ONE part under `file`, to the private proof route — never `/files/upload`. */
    it('uploads one proof under the field `file` with no hand-written content type', async () => {
        const calls = stubFetch(() => successResponse({ fileId: 'f1' }, { status: 201 }));
        const id = await uploadRefundProof(new File(['x'], 'shot.png', { type: 'image/png' }));
        expect(id).toBe('f1');
        expect(calls[0].url).toMatch(/\/refunds\/proofs$/);
        expect(calls[0].formData?.get('file')).toBeInstanceOf(File);
        expect(calls[0].headers.get('Content-Type')).toBeNull();
    });

    it('reads a proof as bytes from the refund route', async () => {
        const calls = stubFetch(() => new Response('JPEG', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
        const content = await getRefundProof('f1');
        expect(calls[0].url).toMatch(/\/refunds\/proofs\/f1$/);
        expect(content.mimeType).toBe('image/jpeg');
    });
});
