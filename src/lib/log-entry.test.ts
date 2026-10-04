import { describe, expect, it } from 'vitest';

import {
    detailsWereDropped,
    logActorLabel,
    logEntryHeadline,
    readLogEntry,
    wasCutAtWrite,
} from '@/lib/log-entry';
import { errorHandlerLogLineFixture } from '@/test/system-fixtures';

describe('readLogEntry', () => {
    it('reads the error handler record the service actually sends', () => {
        const entry = readLogEntry(errorHandlerLogLineFixture());

        expect(entry.msg).toBe('internal 500 INTERNAL_SERVER_ERROR');
        expect(entry.httpError?.code).toBe('INTERNAL_SERVER_ERROR');
        expect(entry.httpError?.internalMessage).toMatch(/preferred_language/);
        expect(entry.httpError?.masked).toBe(true);
        expect(entry.err?.type).toBe('TypeError');
        expect(entry.err?.stack).toMatch(/phone-verification\.service\.ts:136/);
        expect(entry.status).toBe(500);
        expect(entry.path).toBe('/api/internal/admin/phone-verification/request');
        expect(entry.extra).toEqual({});
    });

    /**
     * `system.md` names `res.statusCode`; jovi-mall sends a top-level `status`.
     * Both are read, so the page and the service can each be right on a given day.
     */
    it('takes the status from either spelling', () => {
        expect(readLogEntry({ at: 'x', level: 'info', msg: 'm', status: 404 }).status).toBe(404);
        expect(readLogEntry({ at: 'x', level: 'info', msg: 'm', res: { statusCode: 502 } }).status).toBe(
            502,
        );
    });

    /** *"Anything else — the writer's context. Render it raw."* Kept, never dropped. */
    it('keeps every key it does not know', () => {
        const entry = readLogEntry({ at: 'x', level: 'warn', msg: 'm', worker: 'payouts', attempt: 3 });

        expect(entry.extra).toEqual({ worker: 'payouts', attempt: 3 });
    });

    it('tolerates a field of the wrong type rather than rendering it', () => {
        const entry = readLogEntry({ at: 'x', level: 'info', msg: 'm', status: '500', err: 'boom' });

        expect(entry.status).toBeNull();
        expect(entry.err).toBeNull();
    });
});

describe('logEntryHeadline', () => {
    it('prefers what the code threw over the bare code line', () => {
        expect(logEntryHeadline(readLogEntry(errorHandlerLogLineFixture()))).toMatch(
            /Cannot read properties of undefined/,
        );
    });

    it('falls back to the error message, then the cause', () => {
        expect(
            logEntryHeadline(readLogEntry({ at: 'x', level: 'error', msg: 'm', err: { message: 'boom' } })),
        ).toBe('boom');
        expect(
            logEntryHeadline(
                readLogEntry({ at: 'x', level: 'error', msg: 'm', httpError: { causeMessage: 'ECONNRESET' } }),
            ),
        ).toBe('ECONNRESET');
    });

    it('adds nothing when the line says no more than its msg', () => {
        expect(logEntryHeadline(readLogEntry({ at: 'x', level: 'info', msg: 'ready' }))).toBeNull();
        expect(
            logEntryHeadline(readLogEntry({ at: 'x', level: 'error', msg: 'boom', err: { message: 'boom' } })),
        ).toBeNull();
    });
});

describe('what jovi-mall cut when it wrote the line', () => {
    it('recognises its trailing ellipsis', () => {
        expect(wasCutAtWrite('    at frame (server.ts:212:9)')).toBe(false);
        expect(wasCutAtWrite('    at frame (server.ts:2…')).toBe(true);
        expect(wasCutAtWrite(null)).toBe(false);
    });

    it('recognises details replaced by the size marker', () => {
        expect(detailsWereDropped({ truncated: true, bytes: 90210 })).toBe(true);
        expect(detailsWereDropped({ attempt: 2 })).toBe(false);
        expect(detailsWereDropped(null)).toBe(false);
    });
});

describe('who wrote the line', () => {
    const base = { at: '2026-10-04T10:00:00.000Z', level: 'error', msg: 'x' };

    it('reads the actor detail the platform stamps beside actorId', () => {
        const entry = readLogEntry({
            ...base,
            actorId: 'a'.repeat(24),
            actorSource: 'platform',
            actorRole: 'vendor',
            actorName: 'Ama Mensah',
            actorProfileId: 'b'.repeat(24),
        });
        expect(entry.actorProfileId).toBe('b'.repeat(24));
        expect(entry.extra).toEqual({});
        expect(logActorLabel(entry)).toBe('Ama Mensah · Vendor');
    });

    it('takes the role from the error record on a line written before the name was stamped', () => {
        const entry = readLogEntry({
            ...base,
            actorId: 'a'.repeat(24),
            httpError: { code: 'X', actorRole: 'customer' },
        });
        expect(logActorLabel(entry)).toBe('Customer');
    });

    /** 🔴 The dialog called every id "Administrator", platform users included. */
    it('never calls an id of unknown namespace an administrator', () => {
        expect(logActorLabel(readLogEntry({ ...base, actorId: 'a'.repeat(24) }))).toBe(
            'Signed-in caller',
        );
        expect(
            logActorLabel(readLogEntry({ ...base, actorId: 'a'.repeat(24), actorSource: 'admin' })),
        ).toBe('Administrator');
    });

    it('renders an unknown role raw, and names nobody on an anonymous line', () => {
        expect(
            logActorLabel(readLogEntry({ ...base, actorId: 'a'.repeat(24), actorRole: 'courier' })),
        ).toBe('courier');
        expect(logActorLabel(readLogEntry(base))).toBeNull();
    });
});
