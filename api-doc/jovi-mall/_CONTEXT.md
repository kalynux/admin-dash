# Context only — this dashboard does not call jovi-mall

**Verified against source on 2026-09-08** — the error-registry size (640), the jovi-mall api-doc page counts (183 / 28 / 155 / 108) and the `error-codes.ts` copy beside it, against `jovi-mall/src/core/error-codes.ts` and `jovi-mall/api-doc/`.

**Read this before opening any other page in this folder.**

Every page here documents **jovi-mall**, the commerce platform on port **8022**. This dashboard
**never calls it**. There is no second base URL and no second token: `VITE_API_BASE_URL` points at
wi-admin (`http://localhost:8033/api/v1`) and that is the only host this application talks to.

Where an operation belongs to jovi-mall, **wi-admin performs it on your behalf** and answers in its
own envelope. A path written on any page in this folder is therefore **not a call target**.

---

## Why keep these pages at all

Four reasons, all of them real:

1. **Decoding a delegated failure.** wi-admin writes to jovi-mall over an internal API. When
   jovi-mall refuses, you get `PLATFORM_OPERATION_REJECTED` at jovi-mall's *original* status with
   jovi-mall's own code in **`details.platformCode`** — and that code is only explained here.
   [`error-codes.ts`](error-codes.ts) is the full **640**-code registry.
2. **Domain vocabulary.** Shipment statuses, order states, COD terms and contract terms are
   jovi-mall's model. wi-admin renames nothing.
3. **Understanding what an administrator is changing.** A suspension here cascades there.
4. **Knowing what is *not* wi-admin's.** Several capabilities an operator might expect on this
   dashboard live only in jovi-mall's own role surfaces and are unreachable from here.

---

## Three traps specific to this folder

**1 · The casing is wrong for your wire.** Every example here is in jovi-mall's **storage** casing,
which is `snake_case`. **wi-admin's wire is `camelCase`**, translated at its boundary and never
leaked. Do not copy a field name from this folder into a TypeScript type.

**2 · Three pages are obsolete and are marked so.** [`admin/articles.md`](admin/articles.md),
[`admin/catalogue-vectorisation.md`](admin/catalogue-vectorisation.md) and
[`admin/profile.md`](admin/profile.md) describe capabilities that **moved into wi-admin** when
Phase 5 deleted jovi-mall's entire public admin surface. Each carries a red banner naming its
replacement. They are kept, not deleted, so the next reader finds the redirect rather than
re-deriving it.

**3 · The whole `/api/admin/*` mount is gone.** Eleven mounts, thirteen guard sites and two
api-doc files were deleted at Phase 5. Surviving mentions of `/api/admin/…` in this folder are the
backend's own **historical narrative and deletion tombstones** — every one was classified on
2026-08-24 and none is a live instruction. A pre-cutover refresh token carrying `role: 'admin'` is
refused **403**.

> ⚠ Note that `admin/profile.md` writes its paths as `/admin/profile`, **without** the `/api`
> prefix, so a grep for `/api/admin/` scores zero on it. Search both forms.

---

## What is here, and what is not

This folder mirrors **28 of jovi-mall's 183 api-doc pages** — the admin-facing subset plus the
cross-cutting ones. The other **155** are surfaces no administrator calls; **108** of those are
the vendor, agency, agent, customer and public role documents, and the rest are internal and
integration notes. All of it would be noise here.

| | |
|---|---|
| `admin/` | jovi-mall's own former admin surface — **historical**, plus the internal API wi-admin actually uses |
| `errors/` · `error-codes.ts` | the registry behind `details.platformCode` |
| `tracking/` | jovi-mall's half of the tracking contract — the **policy**, which it owns |
| `payments/` · `uploads/` · `rate-limits.md` | cross-cutting behaviour a delegated call inherits |
| `notifications/` | the WhatsApp template catalogue |

### Two deliberate differences from the backend's copies

1. **A context banner** at the top of every page, fenced in `<!-- CONTEXT-BANNER -->` comments.
2. **Links were repaired.** A link to one of the 155 pages this folder does not carry would
   otherwise dangle, so it is rendered as **plain text naming the backend path**, never as a
   clickable link that goes nowhere. 239 were degraded this way and 8 were retargeted to a page
   this repository *does* hold.

> ⚠ **Repair was done path-aware, and it has to be.** jovi-mall's api-doc carries `billing.md`,
> `earnings.md`, `payment-methods.md` and `articles.md` under `admin/`, `vendor/`, `agency/`,
> `agent/`, `customer/` **and** `public/`. Matching on filename silently retargets
> `../public/articles.md` to the *admin* articles page — a different document. If you re-run a
> repair, resolve each link the way the backend copy would and require an exact path match.

Because of those two changes this folder is **not** byte-comparable to
`backend/jovi-mall/api-doc/`. See [`../README.md`](../README.md) § Re-verifying.

---

## Where to go instead

| You want | Read |
|---|---|
| What this dashboard can actually call | [`../ROUTE-MAP.md`](../ROUTE-MAP.md) — all 232 routes |
| The contract for a route | [`../admin/api/`](../admin/api/) |
| What changed and what broke | [`../MIGRATION-2026-08.md`](../MIGRATION-2026-08.md) |
| Tracking | [`../TRACKING-DOORS.md`](../TRACKING-DOORS.md) |
