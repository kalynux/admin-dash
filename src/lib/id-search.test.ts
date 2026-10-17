import { describe, expect, it } from 'vitest';

import {
    accountSearchPath,
    describeIdKinds,
    describeSearchMiss,
    extractPastedId,
    idSearchMiss,
} from '@/lib/id-search';

const ID = '665f1c2a9b3e4a91c7d2e5f0';

describe('extractPastedId', () => {
    it.each([
        ['quotes', `"${ID}"`],
        ['single quotes', `'${ID}'`],
        ['a database shell value', `ObjectId("${ID}")`],
        ['a labelled value', `user id: ${ID}`],
        ['a dashboard link', `https://admin.wi-mall.com/dashboard/users/${ID}`],
        ['a link with a query string', `https://admin.wi-mall.com/dashboard/users/${ID}?tab=activity`],
        ['a trailing comma from a list', `${ID},`],
    ])('takes the id out of %s', (_, text) => {
        expect(extractPastedId(text)).toBe(ID);
    });

    it('leaves a bare id alone, with or without spaces round it', () => {
        // Nothing to strip — and `null` is what tells the input not to rewrite
        // what was typed.
        expect(extractPastedId(ID)).toBeNull();
        expect(extractPastedId(`  ${ID}  `)).toBeNull();
    });

    it('keeps the case it was given', () => {
        // The service accepts either; rewriting it would change what the box
        // shows for no gain.
        expect(extractPastedId(`"${ID.toUpperCase()}"`)).toBe(ID.toUpperCase());
    });

    it('never takes an id out of an email', () => {
        // The email branch is a contains-match and needs the whole address.
        expect(extractPastedId(`${ID}@example.com`)).toBeNull();
    });

    it('does not guess between two ids', () => {
        expect(extractPastedId(`${ID} ${'a'.repeat(24)}`)).toBeNull();
    });

    it('does not cut an id out of a longer run', () => {
        // 25 hexadecimal characters is not an id with a stray character — it is
        // something else, and picking 24 of them would invent one.
        expect(extractPastedId(`${ID}0`)).toBeNull();
        expect(extractPastedId(`x${ID}`)).toBeNull();
    });

    it.each(['amina', '+237670112233', 'ACR-260815-0001', ''])('leaves %j alone', (text) => {
        expect(extractPastedId(text)).toBeNull();
    });
});

describe('idSearchMiss', () => {
    it('names the shortened form a table cell shows', () => {
        expect(idSearchMiss('665f1c…e5f0')).toBe('shortened');
        // Three dots, as it arrives after a round trip through a chat window.
        expect(idSearchMiss('665f1c...e5f0')).toBe('shortened');
    });

    it('names a part of an id', () => {
        expect(idSearchMiss(ID.slice(0, 8))).toBe('partial');
        expect(idSearchMiss(ID.slice(-6))).toBe('partial');
        // One character too many is as unmatched as six too few.
        expect(idSearchMiss(`${ID}0`)).toBe('partial');
    });

    it('names a whole id, which found nothing for a different reason', () => {
        expect(idSearchMiss(ID)).toBe('whole');
        expect(idSearchMiss(` ${ID.toUpperCase()} `)).toBe('whole');
    });

    it('does not mistake a phone fragment for an id', () => {
        // Digits only. A phone number matches on a part, and this is the
        // commonest thing typed into a directory.
        expect(idSearchMiss('670112233')).toBeNull();
        expect(idSearchMiss('237670')).toBeNull();
    });

    it('does not mistake a word for an id', () => {
        expect(idSearchMiss('decade')).toBeNull();
        expect(idSearchMiss('facade')).toBeNull();
    });

    it.each(['amina', 'amina@example.cm', '+237670112233', 'ab12', ''])(
        'has nothing to say about %j',
        (term) => {
            expect(idSearchMiss(term)).toBeNull();
        },
    );
});

describe('describeSearchMiss', () => {
    const fallback = 'A search matches an email or a phone number.';
    const whole = 'No account has that id.';

    it('keeps the list’s own sentence for an ordinary term', () => {
        expect(describeSearchMiss('amina', fallback, whole)).toBe(fallback);
    });

    it('uses the list’s sentence for a real id from elsewhere', () => {
        expect(describeSearchMiss(ID, fallback, whole)).toBe(whole);
    });

    it('explains a shortened id and a partial one in their own words', () => {
        expect(describeSearchMiss('665f1c…e5f0', fallback, whole)).toMatch(/middle is missing/i);
        expect(describeSearchMiss(ID.slice(0, 8), fallback, whole)).toMatch(/all 24 characters/i);
    });
});

describe('accountSearchPath', () => {
    it('is the user directory searched, never the detail route', () => {
        // A customer, vendor, agency or agent id is a 404 at `/users/:id`; the
        // search resolves all four to the account that owns them (BR-028 § 1).
        expect(accountSearchPath(ID)).toBe(`/dashboard/users?search=${ID}`);
    });
});

describe('describeIdKinds', () => {
    it('names each kind the service sends', () => {
        expect(describeIdKinds(['customer'])).toBe('a customer profile’s');
        expect(describeIdKinds(['user'])).toBe('an account’s own');
        expect(describeIdKinds(['user', 'customer'])).toBe('an account’s own and a customer profile’s');
    });

    it('prints a kind it has never heard of raw, rather than dropping it', () => {
        // The vocabulary is open (users.md § meta.idMatch): a sixth profile kind
        // is an additive change and must still produce a true sentence.
        expect(describeIdKinds(['courier'])).toBe('a “courier” record’s');
    });
});
