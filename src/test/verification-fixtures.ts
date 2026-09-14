/**
 * `GET /{vendors,agencies,agents}/:id/verification` fixtures.
 *
 * Wire-shaped, from the worked JSON in
 * [`verification.md`](../../api-doc/admin/api/verification.md) — including the
 * two properties a hand-written fixture would get wrong and a test would then
 * bless: **every document has `url: null` and `access: "authorized"`** (private
 * `kyc/` tree), and **`storeAddresses` is ABSENT on an agent**, not `[]`.
 */

import type { FileDetail } from '@/types/files.types';
import type {
    PartyVerification,
    VerificationAddress,
    VerificationDocuments,
} from '@/types/verification.types';

/**
 * One KYC document.
 *
 * ⚠ `url: null` / `access: 'authorized'` are not decoration — a fixture that
 * carried a URL would let a component render an `<img src>` and pass, which is
 * precisely the bug `verification.md` warns about: *"a client that renders it
 * shows a broken icon on every identity document in the system."*
 */
export function kycFileFixture(overrides: Partial<FileDetail> = {}): FileDetail {
    return {
        id: '66f0000000000000000000a1',
        key: 'kyc/2026/09/cni-recto.jpg',
        url: null,
        access: 'authorized',
        mimeType: 'image/jpeg',
        size: 842113,
        originalName: 'cni-recto.jpg',
        ...overrides,
    };
}

/** Bonapriso, Douala. `coordinates` is GeoJSON `[longitude, latitude]`. */
export function geocodedAddressFixture(
    overrides: Partial<VerificationAddress> = {},
): VerificationAddress {
    return {
        label: 'Home',
        formattedAddress: 'Bonapriso, Douala, Littoral, Cameroon',
        coordinates: [9.7043, 4.0286],
        provider: 'locationiq',
        geocoded: true,
        ...overrides,
    };
}

/** An address the applicant typed and never picked off the search. */
export function typedAddressFixture(
    overrides: Partial<VerificationAddress> = {},
): VerificationAddress {
    return {
        label: 'Warehouse',
        formattedAddress: '12 Rue de la Joie, Douala',
        coordinates: null,
        provider: null,
        geocoded: false,
        ...overrides,
    };
}

export function verificationDocumentsFixture(
    overrides: Partial<VerificationDocuments> = {},
): VerificationDocuments {
    return {
        idCardFront: kycFileFixture({ id: '66f0000000000000000000a1' }),
        idCardBack: kycFileFixture({ id: '66f0000000000000000000a2', originalName: 'cni-verso.jpg' }),
        selfieWithId: kycFileFixture({ id: '66f0000000000000000000a3', originalName: 'selfie.jpg' }),
        vehicleWithAgent: null,
        homeAddressSketches: [
            kycFileFixture({
                id: '66f0000000000000000000b1',
                mimeType: 'application/pdf',
                originalName: 'plan-maison.pdf',
                size: 220144,
            }),
        ],
        storeAddressSketches: [
            kycFileFixture({
                id: '66f0000000000000000000c1',
                mimeType: 'image/png',
                originalName: 'plan-boutique.png',
                size: 640221,
            }),
        ],
        ...overrides,
    };
}

/** A submitted vendor record with premises and everything on file. */
export function vendorVerificationFixture(
    overrides: Partial<PartyVerification> = {},
): PartyVerification {
    return {
        role: 'vendor',
        status: 'pending',
        submittedAt: '2026-09-12T09:14:22.000Z',
        locked: true,
        rejectionReason: null,
        verifiedAt: null,
        idNumber: '1084563219',
        homeAddress: geocodedAddressFixture(),
        storeAddresses: [
            geocodedAddressFixture({
                label: 'Main Shop',
                formattedAddress: 'Rue Njo-Njo, Akwa, Douala, Cameroon',
                coordinates: [9.6982, 4.0511],
            }),
        ],
        documents: verificationDocumentsFixture(),
        review: { reviewedBy: null },
        limits: { multiSlotMaxFiles: 10 },
        ...overrides,
    };
}

/** An agency. Identical in shape; the premises are the magazin's depots. */
export function agencyVerificationFixture(
    overrides: Partial<PartyVerification> = {},
): PartyVerification {
    return vendorVerificationFixture({ role: 'agency', ...overrides });
}

/**
 * An agent.
 *
 * ⚠ **`storeAddresses` is deleted rather than set to `[]`** — the contract says
 * the key is absent for an agent, and the checklist reads the difference.
 */
export function agentVerificationFixture(
    overrides: Partial<PartyVerification> = {},
): PartyVerification {
    const record = vendorVerificationFixture({
        role: 'agent',
        idNumber: '1084563219',
        driversLicenseNumber: 'CM-DL-88213',
        plateNumber: 'LT 4412 AB',
        documents: verificationDocumentsFixture({
            vehicleWithAgent: kycFileFixture({
                id: '66f0000000000000000000d1',
                originalName: 'moto-avec-agent.jpg',
            }),
            storeAddressSketches: [],
        }),
        ...overrides,
    });

    delete record.storeAddresses;
    return record;
}

/**
 * A vendor with no premises, so the home address carries the requirement.
 *
 * `storeAddresses: []` — present and empty, which for a vendor is the real
 * answer *"they have no shop"*, unlike the agent's absent key.
 */
export function noPremisesVerificationFixture(
    overrides: Partial<PartyVerification> = {},
): PartyVerification {
    return vendorVerificationFixture({
        storeAddresses: [],
        documents: verificationDocumentsFixture({ storeAddressSketches: [] }),
        ...overrides,
    });
}

/** A record the applicant has never submitted. Not a queue item. */
export function draftVerificationFixture(
    overrides: Partial<PartyVerification> = {},
): PartyVerification {
    return vendorVerificationFixture({
        status: 'pending',
        submittedAt: null,
        locked: false,
        ...overrides,
    });
}
