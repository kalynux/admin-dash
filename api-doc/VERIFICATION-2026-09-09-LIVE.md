# Live verification record — 2026-09-09, against a running `:8033`

**What this is.** The standing open item in `CLAUDE.md` — *"still not verified live against a
running `:8033` beyond the `/auth` surface"* — closed for the eight surfaces carrying the most
doubt. Phase 6 of the 2026-09-08 contract resync.

**How this differs from [VERIFICATION-2026-08-24](VERIFICATION-2026-08-24.md).** That record diffed
documents against backend *source*. This one diffs `src/` against a **running service**: every
figure below came out of an HTTP response, and where a claim could not be reached by reading it was
reached by making the service produce it.

**The governing rule is unchanged.** The implementation is the source of truth. A document —
including this repository's own comments and its own tests — is a claim about it.

---

## 1 · Headline result

| # | Surface | Result |
|---:|---|---|
| 1 | `/content` wire shapes | ✅ **BR-014 and BR-019 confirmed in full.** `id` · `authorId` · `sourceLocale`; list translations carry no `body`, the detail's do; create is `.strict()`; the translation-order hazard reproduced |
| 2 | `GET /system/config` | ✅ **`data.config` IS the array.** 13 × `{key, value}`. `getExposedConfig()` takes the `Array.isArray` branch and logs nothing — **clean console, the pass condition** |
| 3 | `/automation` reads | ✅ **`view` grades exactly as documented** — 12 / 10 / 4 fields at tiers 1 / 2 / 3. `configured: true` present at all three. `channel=unknown` returns rows |
| 4 | `/permissions/me` · `/tiers` | ✅ **118 / 101 / 31**, live. Both new names present, at the right tiers |
| 5 | A forwarded 429 | ✅ **`platformCode` and `scope` both absent, `retryAfterSeconds` survives.** Phase 2c's premise confirmed |
| 6 | A weak password | ✅ **`details.failedRules` arrives**, 1–2 entries, `problems` never |
| 7 | `GET /files/library` | ⚠️ **No `quota_blocked` row exists in this data** — the value was reached by setting the real upstream flag. Phase 3's *labelling* is confirmed; **its stated reason is falsified, and the false claim came from `files.md:157`** — § 7, BR-023, fixed |
| 8 | `/automation/summary` at tier 3 | ✅ **Carries `workflowId` and `workflowName`.** BR-020 now has its behaviour |

**Three findings against the backend's docs**, all filed rather than worked around:
[BR-021](admin/dashboard/backend-requests/BR-021-credential-link-throttle-ordering.md) ·
[BR-022](admin/dashboard/backend-requests/BR-022-list-query-strictness-is-not-uniform.md) ·
[BR-023](admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md).
[BR-020](admin/dashboard/backend-requests/BR-020-automation-summary-tier-projection.md) gained a
`## Confirmed on the wire` section. **No mirror was edited** and no `api-doc/admin/` page was
touched.

🔴 **One finding against `src/` — and it turned out to be downstream of BR-023.** Six surfaces and
nine tests withheld an audited open that works, because `files.md:157` said it would not. **Fixed on
2026-09-09**: the open is restored everywhere and the tests now assert the measured behaviour. § 7.3.

---

## 2 · Method, and the environment

### 2.1 What was running

| | |
|---|---|
| `wi-admin` | `backend/admin` · `npm run dev` · **:8033** · `/api/v1` |
| `admin-dash` | this repo · `npm run dev` · **:5175** (strictPort), Vite 7.3.6, ready in 1426 ms |
| MongoDB | **:27017, and it is a replica set** — `{"setName":"rs0","isWritablePrimary":true}` |
| Redis | :6379 |
| `jovi-mall` | :8022 — already running, and `/health/ready` reports it `up` |

> ### ✅ The replica-set caveat did not apply, and that is the whole reason § 7 exists
>
> Both `CLAUDE.md` and the phase plan warn that **the audited reads need wi-admin on a replica
> set**, and that on a single-node database they fail while everything else works. This machine's
> `mongod` is already a **single-node replica set named `rs0`**, so wi-admin logged
> `wi-admin store is transactional · replicaSet: rs0` at boot and **every audited read worked**.
>
> That is what made `GET /files/:fileId/content` testable, which is what falsified § 7. Had the
> caveat applied, that finding would have been invisible — the fetch would have failed, for the
> wrong reason, and the client's comment would have looked correct.

`/health/ready` and `/health/live` both answered `200`, unversioned, as documented.

### 2.2 Getting three sessions, one per tier

`npm run bootstrap:admin` **refuses once any administrator exists** and two already did (one tier 1,
one tier 3, neither with a known password). The `verify:*` suites delete the accounts they create
and spin up their own server on a random port, so neither leaves a login. Following the procedure a
previous live session recorded, **three throwaway accounts were seeded directly** into
`admin_accounts` with `bcrypt.hash(pw, 12)` — `phase6-verify-t1/t2/t3@wimall.test`, tiers 1 / 2 / 3
— and **removed afterwards** along with their sessions, notifications, watermarks and preferences.
Their audit rows were deliberately left (§ 9).

**Tier 1's full MFA path was walked, not bypassed**, since `ADMIN_MFA_REQUIRED_TIER=1`:

| Step | Response |
|---|---|
| `POST /auth/login` | `200` · `{admin, accessToken, refreshToken, expiresIn, csrfToken, mfaEnrolmentRequired}` — **login shape 3**, a real but scoped session |
| `POST /auth/mfa/enroll` | `200` · `{secret, otpauthUri}` — the plaintext secret, once |
| `POST /auth/mfa/activate` | `200` · `reauthenticationRequired: true` — the scoped session is ended |
| `POST /auth/login` again | `200` · `{mfaRequired, challengeId}` — **login shape 2** |
| `POST /auth/mfa/verify` | `200` · full session |

All three documented login shapes therefore appeared, and each was distinguished by **the presence
of fields in `data`**, never by status code — every one of them is `200`.

⚠️ **`/auth/me` does not echo `mfaEnrolmentRequired`**, confirming the standing finding. Nor does
`/auth/refresh` (§ 10 C).

### 2.3 Why some of this had to be provoked

Three of the eight could not be observed by reading a database that had never produced the state:

| Surface | Why | What was done |
|---|---|---|
| `/automation` (3, 8) | `admin_automation_failures` was **empty** | Five reports posted through the **real** reporter door, `POST /api/internal/automation/failures` with `x-automation-token`. Not inserted into Mongo — so ingestion, the `channel` default and dedupe were exercised too |
| A forwarded 429 (5) | jovi-mall refuses the channel **before** it counts (BR-021), so refusals never reach the limit | The party counter was pre-loaded past its limit in Redis, then one call made on a channel that resolves. The 429 throws at `sendCredential:134`, **before** `issueReset` (137) and `deliver` (142) — so no token was minted and no message sent. Counter restored |
| `quota_blocked` (7) | **No file carries `quotaBlockedAt`** — the field is absent from all 80 documents | The real upstream flag was set on one file, read back, and removed. Not a mock: it is the exact input `toFileDetail` branches on. All three files restored and re-confirmed on the wire |

> ⚠️ **Nothing was sent to anybody.** No user in this database has an email address (0 of 45), so
> `channel: 'email'` cannot deliver. WhatsApp **and** Telegram both hold live credentials in
> jovi-mall's `.env`, so no attempt was made on a channel that resolves except the one guaranteed
> to refuse at the limit check first.

---

## 3 · `/content` — the surface that was wrong for months

Taken first, per the standing instruction. Every claim below is read off a response, because the
last time these were read off a document the whole module was wrong and **the tests agreed with the
misreading**.

### 3.1 The names, and the path param

`GET /content/articles` row, top level — 17 keys:

```
id · status · categoryKey · authorId · author · featured · cover · publishedAt · updatedAt
archivedAt · availableLocales · sourceLocale · createdBy · updatedBy · createdAt
lastSavedAt · translations
```

| Claim | Result |
|---|---|
| `id`, not `key` | ✅ `hasId: true` · `hasKey: false` |
| `authorId`, not `authorKey` | ✅ `hasAuthorId: true` · `hasAuthorKey: false` |
| the path param is `:articleId` | ✅ the list's `id` (`"vsdvdsv"`) resolved at `GET /content/articles/vsdvdsv` → `200` |

**`ArticleBase` in `content.types.ts` matches field for field.** BR-014's correction is confirmed.

### 3.2 Rows carry no body; the detail does

Translation keys on a **list** row — 9: `locale · slug · title · metaTitle · excerpt · coverAlt ·
wordCount · published · previousSlugs`. On the **detail** — the same 9 **plus `body`**. Exactly the
`ArticleSummary` / `Article` split.

### 3.3 The filters, and the silent drop

| Request | Result |
|---|---|
| `?categoryKey=nonsense` (misspelt key) | `200`, `total: 1` — **the unfiltered list.** Silent drop **confirmed live** |
| `?search=zzzz` (no such filter) | `200`, `total: 1` — unfiltered. `content.md` is right that there is no `search` |
| `?category=selling` | `200`, `total: 1` |
| `?category=__no_such_category__` | **`400`** — a *recognised* key with an out-of-enum value is refused |
| `GET /content/authors?page=2&limit=1` | **`400 VALIDATION_ERROR`** — ❌ **not** a silent drop |

Documentation inconsistency **#5 is confirmed for `/content/articles` and falsified as a
service-wide rule** → [BR-022](admin/dashboard/backend-requests/BR-022-list-query-strictness-is-not-uniform.md).
BR-014's byline-list correction was not merely tidier: that request was answering **400**.

### 3.4 `/preview` — strict, and required

| Request | Result |
|---|---|
| no `?locale=` | `400 VALIDATION_ERROR` · `details.fields[0].path: "locale"`, `"Required"` |
| `?locale=en` | `200` · the **public** shape: `id · locale · slug · title · excerpt · categoryKey · author · publishedAt · updatedAt · featured · cover · wordCount · availableLocales · body`. **No `createdByAdmin` / `updatedByAdmin`** — absent by construction, as documented |
| `?locale=en&stray=1` | `400` · `unrecognized_keys`, `"Unrecognized key(s) in object: 'stray'"` — **`.strict()`, unlike the list endpoints** |
| `?locale=ar` (no such translation) | `404 BLOG_ARTICLE_NOT_FOUND` · `details: { id, locale }` |

All four match `content.md` and `PublicArticleDetail`.

### 3.5 Create is `.strict()`, and `sourceLocale` is the server's to stamp

`POST /content/articles` with the body `CreateArticleBody` declares → **`201`**, and the article
lands `status: "draft"` with `publishedAt: null`. `sourceLocale: "en"` came back **stamped**,
though it was never sent.

Sending it is refused: `{...body, sourceLocale: 'en'}` → `400`, `"Unrecognized key(s) in object:
'sourceLocale'"`. **`CreateArticleBody` is right to omit it** — `id` required, `sourceLocale`
absent, spans carrying an explicit `type` discriminator. (A first attempt that omitted `id` and sent
`sourceLocale` was refused on all three counts. The harness was wrong; the client is not.)

### 3.6 🔴 The BR-019 § 1 hazard, reproduced

The rule is that **`translations[]` order is not a contract** — it is whatever the last write sent —
so `translations[0]` is not "the language it was written in".

| Step | Sent | Returned |
|---|---|---|
| create | `[en]` | order `[en]` · `sourceLocale: "en"` |
| `PATCH` adding French | `[en, fr]` | order `[en, fr]` · `sourceLocale: "en"` |
| `PATCH` with the array **reversed** | `[fr, en]` | order **`[fr, en]`** · `sourceLocale: **"en"**` |
| re-read | — | order **`[fr, en]`** · `sourceLocale: **"en"**` |

**Both halves confirmed, and it is persisted, not echoed.** After a reordering `PATCH` that could
not fail, `translations[0].locale` is `fr` on an article authored in English — while `sourceLocale`
is untouched. `driverTranslation()` reading `sourceLocale` is the correct and only safe approach.

---

## 4 · `GET /system/config` — the array

```json
{ "config": [ { "key": "NODE_ENV", "value": "development" }, { "key": "PORT", "value": 8033 }, … ] }
```

**13 entries, every one `{key, value}`.** `Array.isArray(config)` is `true`, so
`getExposedConfig()` returns at its first branch and **the `console.warn` is unreachable on this
service** — a clean console, which is the pass condition. `system.md`'s flat-object example is what
is wrong, and `system.service.ts`'s comment saying so is **correct and not obsolete**.

The 13 keys: `NODE_ENV · PORT · LOG_LEVEL · TRUST_PROXY · ADMIN_DASHBOARD_ORIGINS ·
ADMIN_APPROVAL_TTL_S · ADMIN_APPROVAL_SWEEP_MIN_INTERVAL_MS · ADMIN_AUDIT_RETENTION_DAYS ·
ADMIN_AUDIT_MAX_STATE_BYTES · ADMIN_AUDIT_DANGLING_INTENT_S · ADMIN_AUDIT_EXPORT_API_MAX_ROWS ·
ADMIN_AUDIT_EXPORT_DIR · SHUTDOWN_TIMEOUT_MS`. No secret among them.

**Tier 2 is refused**, confirming the permission sits outside its route group:

```json
403 AUTHZ_PERMISSION_DENIED
details: { "required": ["developer_tools.config.read"], "mode": "all" }
```

That also demonstrates the **403 detail allowlist keeping `required` and `mode`** — the other half
of the Phase 2b/2c premise.

---

## 5 · The two exposure scrubs

### 5.1 The forwarded 429 — Phase 2c's premise

```json
429
{
  "code": "PLATFORM_OPERATION_REJECTED",
  "message": "This person has been sent too many links recently",
  "statusCode": 429,
  "category": "rate_limit",
  "details": { "retryAfterSeconds": 3600 }
}
```

| Field | Present? |
|---|---|
| `retryAfterSeconds` | ✅ **survives** — `3600` |
| `platformCode` | ❌ absent |
| `scope` | ❌ absent |
| `limit`, `windowSeconds` | absent (not raised here; the allowlist permits them) |

**`details` contains exactly one key.** The party-versus-administrator distinction survives **only
in the message**, precisely as `users.md` warns. Phase 2c was right to delete the `details.scope`
branch and render the server's message.

For contrast, a **409** on the same route keeps its code — `category: conflict`, not `rate_limit`:

```json
409 { "platformCode": "USER_CHANNEL_UNAVAILABLE", "channel": "email" }
```

So the carve-out is real and it is per-category: `platformCode` survives a `conflict` and is
dropped from a `rate_limit`. `api.types.ts`'s Phase 5 rewrite of that comment is correct.

⚠️ Reaching the 429 exposed **BR-021** — five attempts never incremented the counter.

### 5.2 A weak password — Phase 2d's premise

`POST /auth/password`, all `422 ADMIN_AUTH_PASSWORD_WEAK`, `category: business_rule`:

| New password | `details.failedRules` |
|---|---|
| `Short1!` (7) | `["must be at least 12 characters"]` |
| `aaaaa` (5) | `["must be at least 12 characters", "cannot be a single repeated character"]` |
| `aaaaaaaaaaaaaa` (14) | `["cannot be a single repeated character"]` |
| `qwertyuiop12` (12) | `["is too common"]` |

**`failedRules` arrives, and carries more than one rule when more than one fails.** `problems`
never appeared. Phase 2d's change — `'failedRules'` first in `CANDIDATE_KEYS` — is confirmed, and
the earlier finding that this route *"carries no `details` at all"* is **superseded**: it was true
of the pre-2026-09-08 key name, not of the route.

Two side notes. A password over the 200-character ceiling is caught by the request validator
(`400 VALIDATION_ERROR`) rather than by the policy, so *"at most 200 characters"* never arrives via
`failedRules` — `PASSWORD_POLICY_RULES` is a fallback display list, not a claim about that array, so
nothing needs changing. And `password1234` was **accepted** (`200`): it is 12 characters and is not
on `FORBIDDEN_PASSWORDS`.

---

## 6 · `/permissions` and `/automation`

### 6.1 The counts, live

| Endpoint | Result |
|---|---|
| `GET /permissions/catalog` | **118** permissions across **20** families |
| `GET /permissions/tiers` | **118 · 101 · 31** — Developer · Admin · Support |
| `GET /permissions/me` t1 | **118** held |
| `GET /permissions/me` t2 | **101** held |
| `GET /permissions/me` t3 | **31** held |

The two new names, per tier:

| | t1 | t2 | t3 |
|---|:--:|:--:|:--:|
| `support.automation.lookup` | ✅ | ✅ | ✅ |
| `system.automation.read` | ✅ | ✅ | — |
| `developer_tools.logs.read` | ✅ | — | — |

**Phase 1's vocabulary work is confirmed on the wire**, including that the `any`-mode guard is
reachable by a different name at each tier.

### 6.2 `GET /automation/failures` — the projection

| Tier | `view` | Row fields |
|---:|---|---|
| 1 | `developer` | 12 — the 10 below **plus `errorStack`, `requestId`** |
| 2 | `admin` | 10 — `id · kind · occurredAt · channel · workflowId · workflowName · executionId · nodeName · errorMessage · receivedAt` |
| 3 | `support` | 4 — `id · kind · occurredAt · channel` |

`configured: true` present at every tier. **`externalIdHash` absent at every tier.** Both kinds and
all three channels appeared in the same feed, so nothing collapses them.

### 6.3 The query bounds, and `channel=unknown`

| Request | Result |
|---|---|
| `?channel=unknown` | `200` · **2 rows**, both `execution_failed` |
| `?channel=telegram` | `200` · 2 rows |
| `?channel=whatsapp` | `200` · 1 row |
| `?kind=execution_failed` / `degraded_turn` | `200` · 3 / 2 |
| `?workflowId=wf-tg-adapter-001` | `200` · 3 |
| `?windowHours=721` / `=0` | `400` · `too_big` (720) / `too_small` (1) |
| `?limit=201` | `400` · `too_big` (200) |
| `?channel=carrier-pigeon` | `400` · `"Expected 'telegram' \| 'whatsapp' \| 'unknown'"` |

**Every bound in `automation.types.ts` is confirmed.** And the reason the channel filter must offer
`unknown` is now a measurement rather than an argument: on this sample the **only** rows with no
channel were the `execution_failed` ones — the died-outright half. A Telegram/WhatsApp-only
dropdown would have hidden both.

Two of the three new error codes were produced on the reporter door:
`401 AUTOMATION_REPORT_TOKEN_INVALID` (wrong token **and** no token) and
`400 AUTOMATION_REPORT_MALFORMED` (no `workflowId`, with `details.fields`). Both match
`KNOWN_ERROR_CODES`. The third, `AUTOMATION_DOOR_UNCONFIGURED`, was not reachable — this deployment
**is** configured.

### 6.4 `GET /automation/summary` at tier 3 → BR-020

**Byte-identical at all three tiers, and no `view` field on any.** A tier-3 caller holding only
`support.automation.lookup` receives `workflowId` and `workflowName` — the two fields the feed
withholds from them — plus `distinctCustomers`. Verbatim response and analysis appended to
[BR-020](admin/dashboard/backend-requests/BR-020-automation-summary-tier-projection.md).
`distinctCustomers` behaves exactly as ADR-022 D-5 describes: a null hash contributed `0`, and two
reports sharing one `externalId` gave `1` against a `count` of `2`.

---

## 7 · 🔴 `/files` — the labelling is right, the reason is not

### 7.1 What the library returned

`GET /files/library?limit=100` → `200`, `meta: { total: 74, page: 1, limit: 100, pages: 1,
referenceSampleCap: 5, publicUrlsConfigured: true }`.

| `access` | Rows | `url` |
|---|---:|---|
| `public` | 48 | set |
| `authorized` | 26 | `null` on all 26 |
| `quota_blocked` | **0** | — |

**No `quota_blocked` row exists in this data**, and none ever has: `quotaBlockedAt` is absent from
all 80 documents, because jovi-mall's plan-quota sweep has never run here. So the third value was
reached by setting that flag (§ 2.3) and removing it again.

**PNG → WebP is visible on the wire**, confirming the upload warning: a row with
`originalName: "vendor_page.png"` and `mimeType: "image/webp"`.

### 7.2 `quota_blocked`, once provoked — the labelling holds

```json
{
  "id": "6a9d3ef4…", "key": "images/2026/09/…_vendor_page.png",
  "url": null, "access": "quota_blocked",
  "mimeType": "image/webp", "size": 174490, "originalName": "vendor_page.png",
  "owner": { "type": "admin", … }, "usage": { "referenceCount": 0, "references": [] }
}
```

A **public-tree** key (`images/`) reporting `quota_blocked` with `url: null`. That is exactly the
case Phase 3 exists for, and **Phase 3's labelling decision is correct**: this is a billing state,
not private storage and not a missing file. The open `access` union held; nothing broke.

### 7.3 🔴 But the audited content route serves it anyway — and the contract said it would not

**Corrected after the initial write-up.** This section first read as a defect of ours. It is a
defect of ours *downstream of a wrong sentence in the contract*, which changes what to do about it:
the client was fixed **and** [BR-023](admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md)
was filed.

[`files.md:157`](admin/api/files.md) says, of a quota-blocked file:

> `url` is `null`, **and the content route will not help you either.**

Six surfaces and nine tests were built on that clause — for example
[`LineItemImage.tsx`](../src/components/common/LineItemImage.tsx), which justified skipping the
audited fetch as *"an open that cannot succeed"* spending a disclosure on *"a request that was never
going to return an image"*.

**The clause is false.** `GET /files/:fileId/content` on a quota-blocked file returns **`200` with
the bytes**, in every tree:

| File | Tree | Before the flag | With `access: quota_blocked` |
|---|---|---|---|
| `6a9d3ef4…` `vendor_page.png` | `images/` (public) | `200` | **`200`, binary** |
| `6a7360c8…` `image/jpeg` | `shipments/` (private) | `200` | **`200`, binary** |
| `6a8fb001…` `application/zip` | `digital/` (private) | `200` | **`200`, binary** |

The content route does not consult `quotaBlockedAt` at all — jovi-mall's handler
([`admin-file.routes.ts:247-292`](../../backend/jovi-mall/src/modules/catalog/routes/admin-file.routes.ts))
has no quota branch to fail. The quota block withholds the **public URL**; it does not withhold the
bytes from the audited route, which streams from storage.

⚠️ **And it could not withhold them from a public tree even by design.** Those trees are served by
`express.static` off disk ([`api/index.ts:628-630`](../../backend/jovi-mall/src/api/index.ts)), which
has no database access — so a blocked public file stays fetchable by anyone holding its stale URL,
permanently. **`quota_blocked` is a *publishing* state, not an access-revocation state.**

⚠️ **And a passing test asserts the false claim in its own name** —
`TicketAttachmentsPanel.test.tsx`: *"offers no audited open on a blocked file, **because none can
succeed**"*. It passes, because it tests the client against a stub. This is the pattern `CLAUDE.md`
already records about `/content`: **a wrong premise, and tests written from the same premise
agreeing with it.** The stub is not evidence about the service.

### ✅ Resolved 2026-09-09 — the audited open was restored

Put to the user as a decision rather than inferred here, and the choice was **client-only: restore
the open, change no contract.** The reasoning against a backend fix is the more interesting half and
is recorded in [BR-023](admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md):

- Refusing the bytes would defeat **BR-011's own stated purpose** — the route exists because the
  delivery-proof photograph was *"the single most useful image on the platform for settling a
  dispute"* and an administrator could not look at it. A vendor's billing state would then block a
  dispute investigation.
- It is **unenforceable for public trees** anyway (the `express.static` note above), so it would
  refuse the audited, permissioned caller while leaving the anonymous holder of a stale link served.
- And it contradicts restoring the open: an open that always fails is the state Phase 3 wrongly
  assumed, made real.

All six surfaces now offer the open and draw the billing state **beside** the affordance rather than
in place of it: `ImageBox` (a note in the idle box, inherited by everything that routes through it),
`FileViewer` (a notice above the button, kept even after the bytes arrive), `LineItemImage`,
`TicketAttachmentsPanel`, `VendorProductPanels`, and the `MediaLibrary` tile — a button again rather
than inert.

`QUOTA_BLOCKED_COPY.body` was the load-bearing fix. It ended *"so this file cannot be shown"* and was
drawn at six sites from **one** constant, so the false claim was stated seven times from a single
place — and corrected in one. The nine tests were rewritten against the measured behaviour, including
a new one that clicks through and asserts the bytes arrive: the assertion the old block could not
have written, because it contradicted the sentence the old block was written from.

### 7.4 The fourth audited read files its row

`GET /files/:fileId/content` → the audit trail gained:

```json
{ "action": "files.content.read", "actionSummary": "Opened an uploaded file’s contents",
  "actionFamily": "files", "status": "succeeded", "sensitive": false, "delegated": true,
  "actor": { "kind": "administrator", "id": "…", "tier": 1, "sessionId": "…" },
  "target": { "type": "file", "id": "6a9d3ef4…", "label": "vendor_page.png",
              "subjectClass": "platform_record" },
  "request": { "method": "GET", "path": "/api/v1/files/6a9d3ef4…/content", … } }
```

**`file` is a live, discriminating `targetType`** — Phase 5c's 22 → 23 confirmed twice over:
`?targetType=file` returned 11 rows against 1358 unfiltered, and `?targetType=not_a_real_target`
answered `400` **enumerating all 23 permitted values**, which match `AUDIT_TARGET_TYPES` exactly,
`file` included.

`sensitive: false` is **correct**, not a mismatch — `audit.md:195` defines `sensitive` as money,
escalation, destructive or four-eyes, and an audited read is none of those. Recorded so it is not
mistaken for a defect later. Note the row nests it as **`target.type`** while the query parameter is
`targetType`.

---

## 8 · The transport premises

Not on the eight-item list, but every item above travels over them, and `services/api.ts` is the
one file written from scratch for wi-admin **because** these differ from the sibling dashboards.

**CORS is an exact-match allowlist, and the dev origin is on it.** Preflight from
`http://localhost:5175`: `204`, `Access-Control-Allow-Origin: http://localhost:5175`,
`Allow-Credentials: true`, `Allow-Headers: Content-Type,Authorization,X-Request-Id,X-CSRF-Token`.
From `http://localhost:9999`: **no `Access-Control-Allow-Origin` header at all** — a reflector would
have echoed it.

**Three cookies, and exactly one readable.**

| Cookie | `httpOnly` | `SameSite` |
|---|:--:|---|
| `admin_access_token` | ✅ | `Lax` |
| `admin_refresh_token` | ✅ | `Lax` |
| `admin_csrf_token` | **false** | `Lax` |

**CSRF is required on an unsafe cookie write and on nothing else.** A cookie-authenticated `GET`
with no `X-CSRF-Token` → `200` (`session.authMethod: "cookie"`). A cookie-authenticated `POST` with
none → **`403 ADMIN_AUTH_CSRF_INVALID`**, `category: authentication`.

**Refresh rotates, and replaying a superseded token destroys the session.**

| Call | Result |
|---|---|
| `POST /auth/refresh` | `200`, a **different** `refreshToken`. Does **not** echo `mfaEnrolmentRequired` |
| the same token again | **`401 ADMIN_AUTH_REFRESH_REUSED`** — and all three cookies cleared in the response |
| the **rotated** token, after that | **`401 ADMIN_AUTH_SESSION_REVOKED`** |

So the whole session dies, not just the replayed token, and the two 401s are the two the client must
treat differently — `ADMIN_AUTH_REFRESH_REUSED` and `ADMIN_AUTH_SESSION_REVOKED` both mean *sign in
again*, never *refresh*. `api.ts`'s three-code discrimination is confirmed as necessary.

---

## 9 · What was left behind, deliberately

The three throwaway accounts and their sessions, notifications, watermarks and preferences were
removed. **Their audit rows were not**, and must not be: every mutation this exercise performed —
the article create and two patches, the `files.content.read` opens, the credential-link attempts —
committed an audit row in the same transaction as the act. Deleting those would be falsifying the
trail to tidy up after a test, which is the one thing an append-only audit log exists to prevent.
They are attributable to `phase6-verify-*` and are recognisable as this exercise.

Also left: **five automation failure reports** in `admin_automation_failures`, carrying workflow ids
`wf-tg-adapter-001` / `wf-wa-adapter-002` / `wf-product-cards-003`. They are telemetry with an
unconditional 30-day TTL (`ADMIN_AUTOMATION_RETENTION_DAYS`) and will expire on their own. They are
recognisable by those ids, which no real n8n workflow uses. **One article** was created,
`phase6-verify-1788983582058`, and left as a `draft` — the `/content` delete path is a separate
route and was not part of this exercise.

Everything provoked was restored: the Redis party counter (back to absent), and `quotaBlockedAt` on
all three files (re-confirmed absent, and the library re-read to confirm `access: "public"` and a
live `url` had returned).

---

## 10 · The gates, and one thing worth recording about them

Run at the close of Phase 6, with both dev servers up:

| Gate | Result |
|---|---|
| typecheck (`tsc -b`) | ✅ |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ 3283 modules, 20.06 s |
| `npm test` | **2377 / 2381 passed in 157 files** · 4 failed in 2 files |

✅ **Re-run at the close of the BR-023 fix (§ 7.3), with both dev servers stopped: 2385 / 2385 in
157 files, every file green in one run.** The count rose by four because that fix added tests. So the
suite is clean, and the two runs below are the same code measured under different load.

⚠️ **The 4 failures are the documented contention flake, and this is the third occurrence.** They
were `App.test.tsx` and `CreateTicketDialog.test.tsx` — the same two `CLAUDE.md` says have now been
declared broken by two separate sessions on the strength of a full run. Re-run **alone**:

| File | Alone |
|---|---|
| `src/App.test.tsx` | ✅ **23 / 23** |
| `src/components/support/CreateTicketDialog.test.tsx` | ✅ **10 / 10** |

This run had *two* Vite dev servers and a backend on the machine alongside 30-odd node processes,
which is the contention condition stated outright. **A full run that shares the machine measures the
machine.** Recorded because the instruction to re-run alone before believing a failure has now paid
for itself three times.

⚠️ **And the control arrived by accident, which is the most useful part of this entry.** The same
suite, same code, re-run hours later with the dev servers **stopped**, was **157 / 157 green in one
run**. Two full runs, one day, one tree: the only variable was what else held the CPU. If a future
session sees these two files red, the first question is not *what broke* but **what else is
running**.

`git status api-doc/` was re-checked at close: the six files another writer touched during Phase 1
are unchanged by this exercise. **Nothing under `api-doc/admin/` was edited** — the two new BRs and
this record are authored files, and BR-020 is this dashboard's own request.
