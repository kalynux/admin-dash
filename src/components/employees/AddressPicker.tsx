import { useState } from 'react';
import { MapPin, Search } from 'lucide-react';

import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { googleMapsUrlFromGeoJson } from '@/lib/geo';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { searchAddresses } from '@/services/geo.service';
import { geoCandidateLabel, type GeoCandidate } from '@/types/geo.types';

/**
 * Type, pick, store — the platform's standard address-entry pattern.
 *
 * 🔴 **The chosen candidate is handed back VERBATIM.** `geo.md` is emphatic:
 * *"Do not rebuild it, do not drop fields you think are unused, and do not
 * hand-assemble one from a text box and a pair of coordinates. … A hand-built
 * object will pass validation and be worth nothing."* What makes a stored
 * address verifiable rather than merely plausible is that it records **which
 * provider resolved it** and carries a `provider_place_id` that can be looked up
 * later. So `onPick` receives the object the API returned, untouched.
 *
 * ⚠ **Nothing is searched until the operator asks.** Each keystroke would be a
 * third-party geocoder call billed per request, for a field somebody types once.
 * The button is the trigger, and Enter submits it.
 *
 * ⚠ **An empty `results` list is "no match", not an error** — rendered as a
 * sentence, never as a failure.
 *
 * ⚠ **No permission and no audit row**, because these routes touch no platform
 * data and no person. What gets recorded is the address that is *stored*, by the
 * audited write that stores it.
 */
export function AddressPicker({
    value,
    onPick,
    label = 'Home address',
    hint,
    id = 'address-search',
}: {
    value: GeoCandidate | null;
    onPick: (candidate: GeoCandidate) => void;
    label?: string;
    hint?: string;
    id?: string;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<GeoCandidate[] | null>(null);
    const [searching, setSearching] = useState(false);

    async function run() {
        const trimmed = query.trim();
        // 1–300 on the wire; refusing the empty case here saves a round trip to
        // be told off for something the field already knows.
        if (!trimmed) return;

        setSearching(true);
        try {
            const response = await searchAddresses({ q: trimmed, limit: 8, country: 'cm' });
            setResults(response.results);
        } catch (error) {
            notify.apiError(error);
        } finally {
            setSearching(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <Label htmlFor={id}>{label}</Label>
                {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}

                <div className="flex gap-2">
                    <Input
                        id={id}
                        value={query}
                        maxLength={300}
                        placeholder="Bonapriso, Douala"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            // Enter searches. It must not submit the form this sits
                            // in — the record is saved by its own button, and a
                            // half-filled save triggered by a search is a surprise.
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void run();
                            }
                        }}
                    />
                    <Button type="button" variant="outline" onClick={() => void run()} disabled={searching}>
                        {searching ? <InlineLoader label="Searching…" /> : <Search className="size-4" />}
                        Search
                    </Button>
                </div>
            </div>

            {value ? <ChosenAddress candidate={value} /> : null}

            {results ? (
                results.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                        No match. Try a nearby landmark or the neighbourhood on its own — a
                        geocoder rarely knows a house, and the sketch is what carries the last two
                        hundred metres.
                    </p>
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {results.map((candidate, index) => (
                            <li key={`${candidate.provider_place_id ?? 'result'}-${index}`}>
                                <button
                                    type="button"
                                    className={cn(
                                        'hover:bg-accent/50 focus-visible:ring-ring w-full px-3 py-2 text-left text-xs focus-visible:ring-2 focus-visible:outline-none',
                                    )}
                                    onClick={() => {
                                        /* Verbatim. See this component's header. */
                                        onPick(candidate);
                                        setResults(null);
                                        setQuery('');
                                    }}
                                >
                                    <span className="block font-medium">
                                        {geoCandidateLabel(candidate)}
                                    </span>
                                    <span className="text-muted-foreground block">
                                        Resolved by {candidate.provider}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )
            ) : null}
        </div>
    );
}

/**
 * What is stored now.
 *
 * ⚠ The map link goes through `googleMapsUrlFromGeoJson`, because
 * `coordinates.coordinates` is `[longitude, latitude]` and Google's query is
 * `lat,lng` — *"it puts Douala in the Atlantic"* is `geo.md`'s own description
 * of getting it backwards.
 */
function ChosenAddress({ candidate }: { candidate: GeoCandidate }) {
    const mapUrl = googleMapsUrlFromGeoJson(candidate.coordinates?.coordinates);

    return (
        <div className="bg-muted/40 space-y-1 rounded-lg border p-3 text-xs">
            <p className="font-medium">{geoCandidateLabel(candidate)}</p>
            <p className="text-muted-foreground">Resolved by {candidate.provider}</p>
            {mapUrl ? (
                <a
                    href={mapUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                    <MapPin className="size-3" aria-hidden />
                    Check the pin
                </a>
            ) : null}
        </div>
    );
}
