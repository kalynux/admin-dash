import { EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ScrubRuleName } from '@/lib/scrub-secrets';

/**
 * What each rule found, in an operator's words rather than the rule's name.
 *
 * Naming the *shape* that matched — rather than just saying "something was
 * hidden" — is what lets a reader judge whether the omission was right. A line
 * that says "a bearer token" when the operator knows the field held a hostname is
 * a false positive they can report; an unlabelled blank is one they cannot see.
 */
const RULE_LABELS: Record<ScrubRuleName, string> = {
    pem: 'a private key block',
    'auth-scheme': 'a bearer or basic credential',
    jwt: 'a JSON web token',
    'provider-key': 'a provider secret key',
    'uri-userinfo': 'a password inside a connection URI',
    'kv-secret': 'a named secret value',
};

interface MaskedNoticeProps {
    /** The rules that fired, from `scrubText`. Renders nothing when empty. */
    matched: readonly ScrubRuleName[];
    /**
     * What was scrubbed, as a noun phrase — "this log line", "the stack".
     * Defaults to the generic, which reads correctly inline.
     */
    subject?: string;
    className?: string;
}

/**
 * The disclosure that stops a scrub from being a silent omission.
 *
 * ── Why every masked value gets one ───────────────────────────────────────────
 * The same argument `data.view` makes on the error journal: without it a reader
 * cannot tell *"there is nothing more to know"* from *"I am not being shown it"*,
 * and acts on the wrong one. `audit-redaction.ts` already took this position for
 * the audit trail — `redactedKeys` names what it withheld — and
 * `AuditMetadataView` renders it with this same `EyeOff` treatment. This is that
 * component's counterpart for free text, and the wording is deliberately parallel
 * so the two read as one behaviour rather than two.
 *
 * It also says the quiet part: this dashboard is the **second** net. The platform
 * scrubs its own output first (ADR-015 D-1), and if a secret reached this screen
 * then something upstream let it through — which is worth an operator knowing,
 * not just worth hiding.
 */
export function MaskedNotice({ matched, subject = 'this value', className }: MaskedNoticeProps) {
    if (matched.length === 0) return null;

    // Deduplicated on the way in: the same rule firing on three lines of one
    // stack is one fact, not three.
    const labels = [...new Set(matched.map((rule) => RULE_LABELS[rule]))];

    return (
        <p
            className={cn(
                'text-muted-foreground flex items-start gap-1.5 text-xs',
                className,
            )}
        >
            <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
                Part of {subject} was hidden by this dashboard for looking credential-shaped
                {labels.length > 0 ? <> — {labels.join(', ')}</> : null}. The service scrubs its
                own output before sending it, so this is a second check rather than the only one.
            </span>
        </p>
    );
}
