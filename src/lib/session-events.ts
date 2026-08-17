/**
 * A tiny typed emitter for "the session ended" events.
 *
 * The API client discovers a dead session (a refresh that failed, a revoked
 * session) deep inside a request, where it has no router and no store. It
 * announces it here; the app subscribes once, at the top, and does the
 * redirecting. That keeps the transport layer free of routing concerns and
 * avoids the circular import that calling into a store from `api.ts` would
 * create.
 */

export type SessionEndReason =
    /** A refresh was attempted and failed. The three cookies are already cleared. */
    | 'refresh-failed'
    /** A 401 no refresh can fix — revoked, expired, reused refresh token, suspended. */
    | 'reauthentication-required'
    /** The administrator signed out deliberately. */
    | 'signed-out';

export interface SessionEndedEvent {
    reason: SessionEndReason;
    /** The error code that triggered it, when there was one. */
    code?: string;
    /** The server's message, worth surfacing — a reused refresh token is a security event. */
    message?: string;
}

type Listener = (event: SessionEndedEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe. Returns the unsubscribe function. */
export function onSessionEnded(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function emitSessionEnded(event: SessionEndedEvent): void {
    for (const listener of [...listeners]) {
        try {
            listener(event);
        } catch (error) {
            // One bad subscriber must not stop the others from learning the
            // session is gone.
            console.error('[session] listener threw', error);
        }
    }
}

/**
 * The session is real but still owes MFA enrolment.
 *
 * **A separate event, not a fourth `SessionEndReason`.** Every reason above means
 * the same thing to every subscriber: the session is gone and the three cookies
 * are cleared. This is the opposite — the session is alive, and the app *must*
 * keep its cookies to reach `/auth/mfa/enroll` at all. Folding it into the union
 * would make the existing sign-out watcher bounce a half-authenticated
 * administrator to the login screen, losing the very session they need, and every
 * future subscriber would have to remember the exception. Two events make the
 * wrong handling impossible to write by accident.
 */
export interface MfaEnrolmentRequiredEvent {
    code?: string;
    message?: string;
}

type MfaListener = (event: MfaEnrolmentRequiredEvent) => void;

const mfaListeners = new Set<MfaListener>();

/** Subscribe. Returns the unsubscribe function. */
export function onMfaEnrolmentRequired(listener: MfaListener): () => void {
    mfaListeners.add(listener);
    return () => {
        mfaListeners.delete(listener);
    };
}

export function emitMfaEnrolmentRequired(event: MfaEnrolmentRequiredEvent): void {
    for (const listener of [...mfaListeners]) {
        try {
            listener(event);
        } catch (error) {
            console.error('[session] mfa listener threw', error);
        }
    }
}

/**
 * A permission was refused.
 *
 * **The third event, and the only one that says nothing about the session.**
 * `SessionEndedEvent` means "you are signed out"; `MfaEnrolmentRequiredEvent`
 * means "your session is scoped". This one means the session is entirely fine and
 * the caller asked for something their level does not grant — so it must not be
 * folded into either.
 *
 * It is **notification-only**. `api.ts` still shows no toast and performs no
 * redirect on a `403 AUTHZ_PERMISSION_DENIED`, because "you may not do that" is a
 * thing to hide an affordance over, and the calling screen owns the refusal.
 * The single subscriber is the permission store, which uses it to notice that its
 * cached set has gone stale — `tier` and `status` are re-read from the database on
 * every request, so an administrator can be demoted between one call and the next.
 *
 * The store deliberately does **not** reload on every one of these: most refusals
 * are consistent with the set it already holds (a composite `all`-mode endpoint
 * inside an any-of section), and re-reading would return the identical answer.
 */
export interface PermissionDeniedEvent {
    /** `details.required` + `details.requiredAny`. May be empty when the server sent none. */
    required: readonly string[];
    /** `details.mode`. Absent when the server sent none. */
    mode?: 'all' | 'any';
    code: string;
}

type PermissionListener = (event: PermissionDeniedEvent) => void;

const permissionListeners = new Set<PermissionListener>();

/** Subscribe. Returns the unsubscribe function. */
export function onPermissionDenied(listener: PermissionListener): () => void {
    permissionListeners.add(listener);
    return () => {
        permissionListeners.delete(listener);
    };
}

export function emitPermissionDenied(event: PermissionDeniedEvent): void {
    for (const listener of [...permissionListeners]) {
        try {
            listener(event);
        } catch (error) {
            console.error('[session] permission listener threw', error);
        }
    }
}

/** Test helper — drop every subscriber, on all three events. */
export function resetSessionListeners(): void {
    listeners.clear();
    mfaListeners.clear();
    permissionListeners.clear();
}
