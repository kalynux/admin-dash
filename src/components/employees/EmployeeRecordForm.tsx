import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { AddressPicker } from '@/components/employees/AddressPicker';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import { updateMyEmployeeRecord } from '@/services/employees.service';
import type { GeoCandidate } from '@/types/geo.types';
import type {
    EmployeePhone,
    EmployeeRecord,
    UpdateEmployeeRecordBody,
} from '@/types/employees.types';

/**
 * `PATCH /employees/me` — everything the employee says about themselves.
 *
 * ── ⚠ Calendar days, not instants, and the reason is not pedantry ────────────
 * `dateOfBirth` and `idExpiresOn` go as `YYYY-MM-DD` and an ISO instant is
 * **refused**. `employees.md`: *"an instant carries a timezone, and a date of
 * birth shifted by an offset is a person who is a day older in one reading than
 * another — which is exactly the discrepancy that makes an identity document
 * appear not to match."* So these are `<input type="date">`, whose value is
 * already `YYYY-MM-DD`, and nothing here ever constructs a `Date`.
 *
 * ── ⚠ The schema is `.strict()` and an empty body is a `400` ─────────────────
 * Not this service's default, and deliberate here: *"the failure mode of a
 * lenient schema on an identity record is an employee who corrects their date of
 * birth, gets a `200`, and finds the old value still there."* So this sends only
 * keys it means, and refuses to submit nothing.
 *
 * ── ⚠ `phones` is a FULL REPLACE ─────────────────────────────────────────────
 * Not a merge. The complete list goes every time it is touched, and `[]` empties
 * it. Every number must be full E.164 — a leading `+` and a country code.
 *
 * ── ⚠ `fullName` is not `displayName` ────────────────────────────────────────
 * The account's `displayName` is what colleagues call you; this is what the state
 * calls you, and a reviewer compares it against a scanned card. **They differ for
 * ordinary reasons**, so this field is never prefilled from the other one.
 *
 * ── ⚠ `payoutMethods` is not edited here ─────────────────────────────────────
 * It is on the record, it is a required gap, and it is **masked for everybody
 * including the person who typed it** — so there is nothing to show and no
 * partial edit to make. It gets its own deliberate step rather than a text box
 * beside a date of birth.
 */
export function EmployeeRecordForm({
    record,
    onSaved,
}: {
    record: EmployeeRecord;
    onSaved: (next: EmployeeRecord) => void;
}) {
    const [fullName, setFullName] = useState(record.fullName ?? '');
    const [dateOfBirth, setDateOfBirth] = useState(toCalendarDay(record.dateOfBirth));
    const [placeOfBirth, setPlaceOfBirth] = useState(record.placeOfBirth ?? '');
    const [gender, setGender] = useState(record.gender ?? '');
    const [nationality, setNationality] = useState(record.nationality ?? '');
    const [motherFullName, setMotherFullName] = useState(record.motherFullName ?? '');
    const [fatherFullName, setFatherFullName] = useState(record.fatherFullName ?? '');

    const [idNumber, setIdNumber] = useState(record.idNumber ?? '');
    const [idType, setIdType] = useState(record.idType ?? 'national_id');
    const [idExpiresOn, setIdExpiresOn] = useState(toCalendarDay(record.idExpiresOn));

    const [phones, setPhones] = useState<EmployeePhone[]>(
        record.phones.length > 0 ? record.phones : [{ label: 'personal', number: '' }],
    );
    const [homeAddress, setHomeAddress] = useState<GeoCandidate | null>(record.homeAddress);

    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [phoneError, setPhoneError] = useState<string | null>(null);

    async function save(event: React.FormEvent) {
        event.preventDefault();
        setFormError(null);
        setPhoneError(null);

        const cleanedPhones = phones
            .map((phone) => ({ label: blankToNull(phone.label), number: phone.number.trim() }))
            .filter((phone) => phone.number.length > 0);

        /*
          ⚠ Checked here because the server's message names a field path in an
          array, which is a poor thing to render against a row somebody is
          looking at. E.164 is a leading `+` and digits — `670001122` is refused.
        */
        if (cleanedPhones.some((phone) => !/^\+[1-9]\d{6,14}$/.test(phone.number))) {
            setPhoneError('Every number needs its country code, starting with +237.');
            return;
        }

        const body: UpdateEmployeeRecordBody = {
            fullName: blankToNull(fullName),
            dateOfBirth: blankToNull(dateOfBirth),
            placeOfBirth: blankToNull(placeOfBirth),
            gender: blankToNull(gender),
            nationality: blankToNull(nationality),
            motherFullName: blankToNull(motherFullName),
            fatherFullName: blankToNull(fatherFullName),
            idNumber: blankToNull(idNumber),
            idType: blankToNull(idType),
            idExpiresOn: blankToNull(idExpiresOn),
            phones: cleanedPhones,
        };

        /*
          ⚠ Sent only when the operator picked one. `homeAddress` is a full
          replace and `null` clears it, so including the unchanged value would
          re-store an address nobody touched — and omitting the key is how the
          contract says to leave a field alone.
        */
        if (homeAddress && homeAddress !== record.homeAddress) body.homeAddress = homeAddress;

        setSaving(true);
        try {
            onSaved(await updateMyEmployeeRecord(body));
            notify.success('Saved');
        } catch (error) {
            setFormError(error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={save} noValidate className="space-y-6">
            <section className="space-y-4" aria-label="About you">
                <h3 className="text-sm font-medium">About you</h3>

                <FormField
                    id="employee-full-name"
                    label="Full legal name"
                    hint="As it appears on your identity document — not your display name. They differ for ordinary reasons, and a reviewer compares this one against the card."
                >
                    {(field) => (
                        <Input
                            value={fullName}
                            onChange={(event) => setFullName(event.target.value)}
                            {...field}
                        />
                    )}
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField id="employee-dob" label="Date of birth">
                        {(field) => (
                            <Input
                                type="date"
                                value={dateOfBirth}
                                onChange={(event) => setDateOfBirth(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-pob" label="Place of birth">
                        {(field) => (
                            <Input
                                value={placeOfBirth}
                                onChange={(event) => setPlaceOfBirth(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-gender" label="Gender">
                        {(field) => (
                            <Input
                                value={gender}
                                onChange={(event) => setGender(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-nationality" label="Nationality">
                        {(field) => (
                            <Input
                                value={nationality}
                                onChange={(event) => setNationality(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-mother" label="Mother's full name">
                        {(field) => (
                            <Input
                                value={motherFullName}
                                onChange={(event) => setMotherFullName(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-father" label="Father's full name">
                        {(field) => (
                            <Input
                                value={fatherFullName}
                                onChange={(event) => setFatherFullName(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                </div>
            </section>

            <section className="space-y-4" aria-label="Identity document">
                <h3 className="text-sm font-medium">Identity document</h3>

                <div className="grid gap-4 sm:grid-cols-3">
                    <FormField id="employee-id-number" label="Number">
                        {(field) => (
                            <Input
                                value={idNumber}
                                onChange={(event) => setIdNumber(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-id-type" label="Type">
                        {(field) => (
                            <Input
                                value={idType}
                                placeholder="national_id"
                                onChange={(event) => setIdType(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                    <FormField id="employee-id-expiry" label="Expires on">
                        {(field) => (
                            <Input
                                type="date"
                                value={idExpiresOn}
                                onChange={(event) => setIdExpiresOn(event.target.value)}
                                {...field}
                            />
                        )}
                    </FormField>
                </div>
            </section>

            <section className="space-y-3" aria-label="How to reach you">
                <div className="flex items-center justify-between">
                    <Label>Phone numbers</Label>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPhones([...phones, { label: null, number: '' }])}
                    >
                        <Plus className="size-4" />
                        Add
                    </Button>
                </div>

                <p className="text-muted-foreground text-xs">
                    Include the country code, like <code>+237670001122</code>. At least one is
                    needed before the account can be activated.
                </p>

                <ul className="space-y-2">
                    {phones.map((phone, index) => (
                        <li key={index} className="flex gap-2">
                            <Input
                                aria-label={`Label for phone ${index + 1}`}
                                className="max-w-[10rem]"
                                placeholder="personal"
                                value={phone.label ?? ''}
                                onChange={(event) =>
                                    setPhones(
                                        phones.map((entry, position) =>
                                            position === index
                                                ? { ...entry, label: event.target.value }
                                                : entry,
                                        ),
                                    )
                                }
                            />
                            <Input
                                aria-label={`Phone number ${index + 1}`}
                                placeholder="+237670001122"
                                value={phone.number}
                                onChange={(event) =>
                                    setPhones(
                                        phones.map((entry, position) =>
                                            position === index
                                                ? { ...entry, number: event.target.value }
                                                : entry,
                                        ),
                                    )
                                }
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove phone ${index + 1}`}
                                onClick={() =>
                                    setPhones(phones.filter((_, position) => position !== index))
                                }
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </li>
                    ))}
                </ul>

                {phoneError ? <p className="text-destructive text-xs">{phoneError}</p> : null}
            </section>

            <section aria-label="Where you live">
                <AddressPicker
                    id="employee-home-address"
                    value={homeAddress}
                    onPick={setHomeAddress}
                    label="Home address"
                    hint="Search for it and pick the closest match — a typed-in address cannot be checked against a map, and the activation gate asks for a geocoded one."
                />
            </section>

            <AuthFormError error={formError} />

            <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                    {saving ? <InlineLoader label="Saving…" /> : 'Save'}
                </Button>
            </div>
        </form>
    );
}

/** `''` means "clear this field" on the wire, and the contract accepts it as `null`. */
function blankToNull(value: string | null): string | null {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * An ISO instant from the read → the `YYYY-MM-DD` the write wants.
 *
 * ⚠ **Sliced, never parsed through `Date`.** The read returns midnight UTC; a
 * browser west of Greenwich turns `new Date(...)` into the previous day, and the
 * value that comes back is a date of birth off by one — the exact discrepancy
 * the calendar-day rule exists to prevent.
 */
function toCalendarDay(iso: string | null): string {
    return iso ? iso.slice(0, 10) : '';
}
