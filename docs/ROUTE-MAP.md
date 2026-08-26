# Route map — all 233 wi-admin routes

**Generated from the live router on 2026-08-24**, not transcribed. Every row's permission and
audit declaration comes from `routeManifest()` — the same structure the service asserts against at
boot — and the "documented in" column was reconciled mechanically against the pages in
[`admin/api/`](admin/api/).

> **Every route below appears in exactly one document.** That was checked, not assumed: 230 of 230
> versioned routes matched exactly one page, zero matched two, and zero documented permission
> disagreed with the declared one. The two `/health/*` probes are unversioned and live in
> [`health.md`](admin/api/health.md).

---

## How to read this

| Column | |
|---|---|
| **Path** | relative to `http://localhost:8033/api/v1` — except `/health/*`, which is **outside** the versioned base and must not be reached by appending to it |
| **Permission** | what the route declares. `+` means **all** are required (a composite guard); **or** means any one suffices. *italics* is a non-permission gate — see below |
| **Audited** | ✅ the route declares it **records** an audit action · ◐ it **may** record one · — a read that records nothing |
| **Documented in** | the one page in `admin/api/` that specifies it |

**Non-permission gates.** Four routes are `public` (login, MFA verify, refresh — and they are
public because you cannot authenticate before you have), `self` gates only require a valid session,
and `mfa-enrolment` marks the four routes a scoped enrolment session may still reach.

**A permission is necessary, never sufficient.** Escalation rules, row-level scope and dual control
refuse independently — see [`authorization.md`](admin/api/authorization.md). A `true` from
`can()` means "offer it", not "it will work".

---

## The audit column is a contract, not a note

**Every mutation records its audit row before it answers, in the same transaction.** A `2xx` on a
write means the row committed; there is no "succeeded but unrecorded". The declaration in this
table is enforced at runtime: a route that succeeds and records none of the actions it declares
logs at `fatal`.

Three **reads** are audited, and they are the interesting ones — the output *is* the disclosure:

| Read | Why |
|---|---|
| `GET /money/payouts/:payoutId/destination` | reveals a bank account or mobile-money number |
| `GET /agents/:agentId/live-position` | reveals where a person is **right now** |
| `GET /shipments/:shipmentId/tracking-trail` | reveals where a person **has been** |

All three are **fail-closed**: the row commits *before* the read and its failure is not caught, so
with the audit store down nothing is disclosed. See [`TRACKING-DOORS.md`](TRACKING-DOORS.md).

---

## Reproducing this table

```bash
cd backend/admin
node -r ts-node/register/transpile-only -r dotenv/config \
    ../FRONTEND-SYNC/tools/dump-routes.js "$(pwd)/src/app.ts" | tail -1   # TOTAL 233
npm run authz:matrix                                                      # 113 / 20 / 3
```

If either number moves, this file is stale and so is everything built from it.

---

## The 233 routes, by namespace

### `/support` — 19 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/support/tickets/` | `support.tickets.read` | — | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/` | `support.tickets.create` | ✅ support.tickets.create | [`support.md`](admin/api/support.md) |
| GET | `/support/tickets/:ticketId` | `support.tickets.read` | — | [`support.md`](admin/api/support.md) |
| PATCH | `/support/tickets/:ticketId` | `support.tickets.update` | ✅ support.tickets.update | [`support.md`](admin/api/support.md) |
| PATCH | `/support/tickets/:ticketId/assign` | `support.tickets.assign` | ✅ support.tickets.assign | [`support.md`](admin/api/support.md) |
| GET | `/support/tickets/:ticketId/attachments` | `support.tickets.attachments.read` | — | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/:ticketId/attachments` | `support.tickets.attachments.write` | ✅ support.tickets.attachments.attach | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/:ticketId/claim` | `support.tickets.assign` | ✅ support.tickets.claim | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/:ticketId/close` | `support.tickets.lifecycle` | ✅ support.tickets.close | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/:ticketId/followers` | `support.tickets.followers.manage` | ✅ support.tickets.followers.add | [`support.md`](admin/api/support.md) |
| DELETE | `/support/tickets/:ticketId/followers/:userId` | `support.tickets.followers.manage` | ✅ support.tickets.followers.remove | [`support.md`](admin/api/support.md) |
| GET | `/support/tickets/:ticketId/notes` | `support.tickets.notes.read` | — | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/:ticketId/notes` | `support.tickets.notes.write` | ✅ support.tickets.notes.create | [`support.md`](admin/api/support.md) |
| PATCH | `/support/tickets/:ticketId/priority` | `support.tickets.update` | ✅ support.tickets.priority.set | [`support.md`](admin/api/support.md) |
| POST | `/support/tickets/:ticketId/reopen` | `support.tickets.lifecycle` | ✅ support.tickets.reopen | [`support.md`](admin/api/support.md) |
| PATCH | `/support/tickets/:ticketId/status` | `support.tickets.update` | ✅ support.tickets.status.set | [`support.md`](admin/api/support.md) |
| DELETE | `/support/tickets/attachments/:attachmentId` | `support.tickets.attachments.write` | ✅ support.tickets.attachments.delete | [`support.md`](admin/api/support.md) |
| GET | `/support/tickets/reference/orders` | `support.reference.read` | — | [`support.md`](admin/api/support.md) |
| GET | `/support/tickets/reference/products` | `support.reference.read` | — | [`support.md`](admin/api/support.md) |

### `/administrators` — 17 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/administrators/` | `administrators.read` | — | [`administrators.md`](admin/api/administrators.md) |
| POST | `/administrators/` | `administrators.create` | ✅ administrators.create | [`administrators.md`](admin/api/administrators.md) |
| GET | `/administrators/:adminId` | `administrators.read` | — | [`administrators.md`](admin/api/administrators.md) |
| PATCH | `/administrators/:adminId` | `administrators.update` | ✅ administrators.update | [`administrators.md`](admin/api/administrators.md) |
| GET | `/administrators/:adminId/activity` | `audit.read` | — | [`administrators.md`](admin/api/administrators.md) |
| GET | `/administrators/:adminId/history` | `audit.read` | — | [`administrators.md`](admin/api/administrators.md) |
| POST | `/administrators/:adminId/mfa-reset` | `administrators.mfa.reset` | ✅ administrators.mfa.reset | [`administrators.md`](admin/api/administrators.md) |
| POST | `/administrators/:adminId/password-reset` | `administrators.password.reset` | ✅ administrators.password.reset | [`administrators.md`](admin/api/administrators.md) |
| POST | `/administrators/:adminId/reinstate` | `administrators.suspend` | ✅ administrators.reinstate | [`administrators.md`](admin/api/administrators.md) |
| DELETE | `/administrators/:adminId/sessions` | `administrators.sessions.revoke` | ✅ administrators.sessions.revoke | [`administrators.md`](admin/api/administrators.md) |
| GET | `/administrators/:adminId/sessions` | `administrators.sessions.read` | — | [`administrators.md`](admin/api/administrators.md) |
| DELETE | `/administrators/:adminId/sessions/:sessionId` | `administrators.sessions.revoke` | ✅ administrators.sessions.revoke_one | [`administrators.md`](admin/api/administrators.md) |
| POST | `/administrators/:adminId/suspend` | `administrators.suspend` | ✅ administrators.suspend | [`administrators.md`](admin/api/administrators.md) |
| PUT | `/administrators/:adminId/tier` | `administrators.tier.set` | ◐ administrators.tier.set | [`administrators.md`](admin/api/administrators.md) |
| GET | `/administrators/me` | *self* | — | [`administrators.md`](admin/api/administrators.md) |
| PATCH | `/administrators/me` | *self* | ✅ administrators.profile.update_self | [`administrators.md`](admin/api/administrators.md) |
| GET | `/administrators/me/activity` | *self* | — | [`administrators.md`](admin/api/administrators.md) |

### `/agents` — 17 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/agents/` | `agents.read` | — | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId` | `agents.read` | — | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/activity` | `agents.read` + `audit.read` | — | [`agents.md`](admin/api/agents.md) |
| POST | `/agents/:agentId/ban` | `agents.ban` | ✅ agents.ban | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/cod-allocation` | `agents.read` | — | [`agents.md`](admin/api/agents.md) |
| PUT | `/agents/:agentId/cod-threshold` | `agents.cod_threshold.set` | ✅ agents.cod_threshold.set | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/contract-history` | `agents.read` | — | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/contracts` | `agents.read` + `agencies.read` | — | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/eligibility` | `agents.read` | — | [`agents.md`](admin/api/agents.md) |
| PUT | `/agents/:agentId/kyc` | `agents.kyc.review` | ✅ agents.kyc.review | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/live-position` | `agents.tracking.read` | ✅ agents.tracking.position.read | [`agents.md`](admin/api/agents.md) |
| PUT | `/agents/:agentId/status` | `agents.status.set` | ✅ agents.status.set | [`agents.md`](admin/api/agents.md) |
| PUT | `/agents/:agentId/tracking` | `agents.tracking.set` | ✅ agents.tracking.set | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/tracking-policy` | `agents.read` | — | [`agents.md`](admin/api/agents.md) |
| GET | `/agents/:agentId/tracking-presence` | `agents.tracking.read` | — | [`agents.md`](admin/api/agents.md) |
| POST | `/agents/:agentId/unban` | `agents.ban` | ✅ agents.unban | [`agents.md`](admin/api/agents.md) |
| POST | `/agents/transfer` | `agents.transfer` | ✅ agents.transfer | [`agents.md`](admin/api/agents.md) |

### `/system` — 17 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/system/cache` | `system.health.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/config` | `developer_tools.config.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/dependencies` | `system.health.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/errors` | `developer_tools.logs.read` **or** `system.errors.read` **or** `support.errors.lookup` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/geo-tracker` | `system.health.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/geo-tracker/metrics` | `system.metrics.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/health` | `system.health.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/integrations` | `system.health.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/maintenance` | `system.maintenance.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/metrics` | `system.metrics.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/outbox` | `system.outbox.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/platform/cache/keys` | `developer_tools.cache.inspect` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/platform/config` | `developer_tools.config.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/platform/database` | `developer_tools.database.inspect` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/platform/logs` | `developer_tools.logs.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/queues` | `system.outbox.read` | — | [`system.md`](admin/api/system.md) |
| GET | `/system/workers` | `system.workers.read` | — | [`system.md`](admin/api/system.md) |

### `/cod` — 16 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| POST | `/cod/agents/:agentId/trust-adjustment` | `cod.trust.adjust` | ✅ cod.trust.adjust | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/agents/:agentId/trust-events` | `cod.holders.read` + `agents.read` | — | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/deposits` | `cod.deposits.read` | — | [`cod.md`](admin/api/cod.md) |
| POST | `/cod/deposits` | `cod.deposits.create` | ✅ cod.deposits.create | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/deposits/:depositId` | `cod.deposits.read` | — | [`cod.md`](admin/api/cod.md) |
| POST | `/cod/deposits/:depositId/confirm` | `cod.deposits.confirm` | ✅ cod.deposits.confirm | [`cod.md`](admin/api/cod.md) |
| POST | `/cod/deposits/:depositId/reject` | `cod.deposits.reject` | ✅ cod.deposits.reject | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/discrepancies` | `cod.discrepancies.read` | — | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/discrepancies/:discrepancyId` | `cod.discrepancies.read` | — | [`cod.md`](admin/api/cod.md) |
| POST | `/cod/discrepancies/:discrepancyId/resolve` | `cod.discrepancies.resolve` | ✅ cod.discrepancies.resolve | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/holders` | `cod.holders.read` | — | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/overview` | `cod.overview.read` | — | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/remittances` | `cod.remittances.read` | — | [`cod.md`](admin/api/cod.md) |
| GET | `/cod/remittances/:remittanceId` | `cod.remittances.read` | — | [`cod.md`](admin/api/cod.md) |
| POST | `/cod/remittances/:remittanceId/confirm` | `cod.remittances.confirm` | ✅ cod.remittances.confirm | [`cod.md`](admin/api/cod.md) |
| POST | `/cod/remittances/:remittanceId/reject` | `cod.remittances.reject` | ✅ cod.remittances.reject | [`cod.md`](admin/api/cod.md) |

### `/content` — 14 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/content/articles` | `content.articles.read` | — | [`content.md`](admin/api/content.md) |
| POST | `/content/articles` | `content.articles.write` | ✅ content.articles.create | [`content.md`](admin/api/content.md) |
| DELETE | `/content/articles/:articleKey` | `content.articles.delete` | ✅ content.articles.delete | [`content.md`](admin/api/content.md) |
| GET | `/content/articles/:articleKey` | `content.articles.read` | — | [`content.md`](admin/api/content.md) |
| PATCH | `/content/articles/:articleKey` | `content.articles.write` | ✅ content.articles.update | [`content.md`](admin/api/content.md) |
| POST | `/content/articles/:articleKey/archive` | `content.articles.publish` | ✅ content.articles.archive | [`content.md`](admin/api/content.md) |
| GET | `/content/articles/:articleKey/preview` | `content.articles.read` | — | [`content.md`](admin/api/content.md) |
| POST | `/content/articles/:articleKey/publish` | `content.articles.publish` | ✅ content.articles.publish | [`content.md`](admin/api/content.md) |
| POST | `/content/articles/:articleKey/unpublish` | `content.articles.publish` | ✅ content.articles.unpublish | [`content.md`](admin/api/content.md) |
| GET | `/content/authors` | `content.authors.read` | — | [`content.md`](admin/api/content.md) |
| POST | `/content/authors` | `content.authors.write` | ✅ content.authors.create | [`content.md`](admin/api/content.md) |
| DELETE | `/content/authors/:authorKey` | `content.authors.delete` | ✅ content.authors.delete | [`content.md`](admin/api/content.md) |
| GET | `/content/authors/:authorKey` | `content.authors.read` | — | [`content.md`](admin/api/content.md) |
| PATCH | `/content/authors/:authorKey` | `content.authors.write` | ✅ content.authors.update | [`content.md`](admin/api/content.md) |

### `/money` — 14 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/money/earnings/accounts` | `money.earnings.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/earnings/allocations` | `money.earnings.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/earnings/allocations/:allocationId` | `money.earnings.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/earnings/platform` | `money.earnings.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/earnings/platform/ledger` | `money.earnings.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/payments` | `money.payments.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/payments/:transactionId` | `money.payments.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/payouts` | `money.payouts.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/payouts/:payoutId` | `money.payouts.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/payouts/:payoutId/activity` | `money.payouts.read` + `audit.read` | — | [`money.md`](admin/api/money.md) |
| GET | `/money/payouts/:payoutId/destination` | `money.payouts.destination.read` | ✅ money.payouts.destination.read | [`money.md`](admin/api/money.md) |
| POST | `/money/payouts/:payoutId/mark-paid` | `money.payouts.mark_paid` | ✅ money.payouts.mark_paid | [`money.md`](admin/api/money.md) |
| POST | `/money/payouts/:payoutId/reject` | `money.payouts.reject` | ✅ money.payouts.reject | [`money.md`](admin/api/money.md) |
| GET | `/money/refunds` | `money.payments.read` | — | [`money.md`](admin/api/money.md) |

### `/vendors` — 12 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/vendors/` | `vendors.read` | — | [`vendors.md`](admin/api/vendors.md) |
| GET | `/vendors/:vendorId` | `vendors.read` | — | [`vendors.md`](admin/api/vendors.md) |
| GET | `/vendors/:vendorId/activity` | `vendors.read` + `audit.read` | — | [`vendors.md`](admin/api/vendors.md) |
| POST | `/vendors/:vendorId/kyc/approve` | `vendors.kyc.review` | ✅ vendors.kyc.approve | [`vendors.md`](admin/api/vendors.md) |
| POST | `/vendors/:vendorId/kyc/reject` | `vendors.kyc.review` | ✅ vendors.kyc.reject | [`vendors.md`](admin/api/vendors.md) |
| GET | `/vendors/:vendorId/products` | `vendors.read` | — | [`vendors.md`](admin/api/vendors.md) |
| GET | `/vendors/:vendorId/products/:productId` | `vendors.read` | — | [`vendors.md`](admin/api/vendors.md) |
| POST | `/vendors/:vendorId/products/:productId/restore` | `vendors.products.manage` | ✅ vendors.products.restore | [`vendors.md`](admin/api/vendors.md) |
| POST | `/vendors/:vendorId/products/:productId/suspend` | `vendors.products.manage` | ✅ vendors.products.suspend | [`vendors.md`](admin/api/vendors.md) |
| POST | `/vendors/:vendorId/restore` | `vendors.suspend` | ✅ vendors.reinstate | [`vendors.md`](admin/api/vendors.md) |
| PATCH | `/vendors/:vendorId/settings` | `vendors.settings.manage` | ✅ vendors.settings.update | [`vendors.md`](admin/api/vendors.md) |
| POST | `/vendors/:vendorId/suspend` | `vendors.suspend` | ✅ vendors.suspend | [`vendors.md`](admin/api/vendors.md) |

### `/auth` — 11 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| POST | `/auth/login` | *public* | ✅ administrators.auth.login_succeeded, administrators.auth.login_failed, administrators.auth.lockout_engaged, administrators.auth.mfa_challenged | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/logout` | *mfa-enrolment* | ✅ administrators.auth.logout | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/logout-all` | *self* | ✅ administrators.auth.logout_all | [`auth.md`](admin/api/auth.md) |
| GET | `/auth/me` | *mfa-enrolment* | — | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/mfa/activate` | *mfa-enrolment* | ✅ administrators.auth.mfa_activated | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/mfa/enroll` | *mfa-enrolment* | ✅ administrators.auth.mfa_enrolled | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/mfa/verify` | *public* | ✅ administrators.auth.mfa_failed, administrators.auth.login_succeeded | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/password` | *self* | ✅ administrators.auth.password_changed | [`auth.md`](admin/api/auth.md) |
| POST | `/auth/refresh` | *public* | ◐ administrators.auth.refresh_reuse_detected | [`auth.md`](admin/api/auth.md) |
| GET | `/auth/sessions` | *self* | — | [`auth.md`](admin/api/auth.md) |
| DELETE | `/auth/sessions/:sessionId` | *self* | ✅ administrators.auth.session_revoked | [`auth.md`](admin/api/auth.md) |

### `/billing` — 10 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/billing/plans` | `billing.plans.read` | — | [`billing.md`](admin/api/billing.md) |
| POST | `/billing/plans` | `billing.plans.manage` | ✅ billing.plans.create | [`billing.md`](admin/api/billing.md) |
| DELETE | `/billing/plans/:planId` | `billing.plans.delete` | ✅ billing.plans.delete | [`billing.md`](admin/api/billing.md) |
| GET | `/billing/plans/:planId` | `billing.plans.read` | — | [`billing.md`](admin/api/billing.md) |
| PATCH | `/billing/plans/:planId` | `billing.plans.manage` | ✅ billing.plans.update | [`billing.md`](admin/api/billing.md) |
| GET | `/billing/plans/:planId/subscribers` | `billing.plans.read` | — | [`billing.md`](admin/api/billing.md) |
| GET | `/billing/subscriptions` | `billing.plans.read` | — | [`billing.md`](admin/api/billing.md) |
| GET | `/billing/subscriptions/:ownerType/:ownerId` | `billing.plans.read` | — | [`billing.md`](admin/api/billing.md) |
| POST | `/billing/subscriptions/:ownerType/:ownerId` | `billing.subscriptions.assign` | ✅ billing.subscriptions.assign_vendor, billing.subscriptions.assign_agency, billing.subscriptions.assign_agent | [`billing.md`](admin/api/billing.md) |
| GET | `/billing/subscriptions/:subscriptionId` | `billing.plans.read` | — | [`billing.md`](admin/api/billing.md) |

### `/notifications` — 10 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/notifications/` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| POST | `/notifications/:notificationId/archive` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| PATCH | `/notifications/:notificationId/read` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| POST | `/notifications/:notificationId/unarchive` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| PATCH | `/notifications/:notificationId/unread` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| GET | `/notifications/preferences` | *self* | — | [`notifications.md`](admin/api/notifications.md) |
| PATCH | `/notifications/preferences` | *self* | ✅ notifications.preferences.update_self | [`notifications.md`](admin/api/notifications.md) |
| POST | `/notifications/read-all` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| GET | `/notifications/sources` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |
| GET | `/notifications/unread-count` | `notifications.read` | — | [`notifications.md`](admin/api/notifications.md) |

### `/orders` — 10 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/orders/` | `orders.read` | — | [`orders.md`](admin/api/orders.md) |
| GET | `/orders/:orderId` | `orders.read` | — | [`orders.md`](admin/api/orders.md) |
| GET | `/orders/:orderId/activity` | `orders.read` + `audit.read` | — | [`orders.md`](admin/api/orders.md) |
| POST | `/orders/:orderId/cancel` | `orders.intervene` | ✅ orders.cancel | [`orders.md`](admin/api/orders.md) |
| POST | `/orders/:orderId/dispatch` | `orders.intervene` | ✅ orders.dispatch | [`orders.md`](admin/api/orders.md) |
| POST | `/orders/:orderId/dispute/resolve` | `orders.disputes.resolve` | ✅ orders.disputes.resolve | [`orders.md`](admin/api/orders.md) |
| POST | `/orders/:orderId/refund` | `orders.refund` | ✅ orders.refund | [`orders.md`](admin/api/orders.md) |
| GET | `/orders/:orderId/refund-eligibility` | `orders.refund` | — | [`orders.md`](admin/api/orders.md) |
| GET | `/orders/:orderId/timeline` | `orders.read` | — | [`orders.md`](admin/api/orders.md) |
| GET | `/orders/disputes` | `orders.disputes.read` | — | [`orders.md`](admin/api/orders.md) |

### `/agencies` — 9 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/agencies/` | `agencies.read` | — | [`agencies.md`](admin/api/agencies.md) |
| GET | `/agencies/:agencyId` | `agencies.read` | — | [`agencies.md`](admin/api/agencies.md) |
| GET | `/agencies/:agencyId/activity` | `agencies.read` + `audit.read` | — | [`agencies.md`](admin/api/agencies.md) |
| GET | `/agencies/:agencyId/agents` | `agencies.read` + `agents.read` | — | [`agencies.md`](admin/api/agencies.md) |
| GET | `/agencies/:agencyId/contract-history` | `agencies.read` | — | [`agencies.md`](admin/api/agencies.md) |
| POST | `/agencies/:agencyId/deactivate` | `agencies.deactivate` | ✅ agencies.deactivate | [`agencies.md`](admin/api/agencies.md) |
| POST | `/agencies/:agencyId/reactivate` | `agencies.reactivate` | ✅ agencies.reactivate | [`agencies.md`](admin/api/agencies.md) |
| POST | `/agencies/:agencyId/reject` | `agencies.verify` | ✅ agencies.reject | [`agencies.md`](admin/api/agencies.md) |
| POST | `/agencies/:agencyId/verify` | `agencies.verify` | ✅ agencies.verify | [`agencies.md`](admin/api/agencies.md) |

### `/dev-tools` — 9 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| POST | `/dev-tools/cache/flush` | `developer_tools.cache.flush` | ✅ developer_tools.cache.flush | [`dev-tools.md`](admin/api/dev-tools.md) |
| POST | `/dev-tools/catalogue/vectorise` | `developer_tools.catalogue.vectorise` | ✅ developer_tools.catalogue.vectorise | [`dev-tools.md`](admin/api/dev-tools.md) |
| GET | `/dev-tools/feature-flags` | `developer_tools.feature_flags.read` | — | [`dev-tools.md`](admin/api/dev-tools.md) |
| PUT | `/dev-tools/feature-flags/:flag` | `developer_tools.feature_flags.set` | ✅ developer_tools.feature_flags.set | [`dev-tools.md`](admin/api/dev-tools.md) |
| PUT | `/dev-tools/maintenance` | `developer_tools.maintenance.set` | ✅ developer_tools.maintenance.set | [`dev-tools.md`](admin/api/dev-tools.md) |
| POST | `/dev-tools/outbox/prune` | `developer_tools.outbox.prune` | ✅ developer_tools.outbox.prune | [`dev-tools.md`](admin/api/dev-tools.md) |
| POST | `/dev-tools/outbox/replay` | `developer_tools.outbox.replay` | ✅ developer_tools.outbox.replay | [`dev-tools.md`](admin/api/dev-tools.md) |
| GET | `/dev-tools/workers` | `system.workers.read` | — | [`dev-tools.md`](admin/api/dev-tools.md) |
| POST | `/dev-tools/workers/:workerKey/run` | `developer_tools.workers.trigger` | ✅ developer_tools.workers.trigger | [`dev-tools.md`](admin/api/dev-tools.md) |

### `/shipments` — 8 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/shipments/` | `shipments.read` | — | [`shipments.md`](admin/api/shipments.md) |
| GET | `/shipments/:shipmentId` | `shipments.read` | — | [`shipments.md`](admin/api/shipments.md) |
| GET | `/shipments/:shipmentId/activity` | `shipments.read` + `audit.read` | — | [`shipments.md`](admin/api/shipments.md) |
| POST | `/shipments/:shipmentId/cancel` | `shipments.cancel` | ✅ shipments.cancel | [`shipments.md`](admin/api/shipments.md) |
| GET | `/shipments/:shipmentId/offers` | `shipments.read` + `agents.read` | — | [`shipments.md`](admin/api/shipments.md) |
| POST | `/shipments/:shipmentId/reassign` | `shipments.reassign` | ✅ shipments.reassign | [`shipments.md`](admin/api/shipments.md) |
| GET | `/shipments/:shipmentId/tracking-events` | `shipments.tracking.read` | — | [`shipments.md`](admin/api/shipments.md) |
| GET | `/shipments/:shipmentId/tracking-trail` | `shipments.tracking.read` | ✅ shipments.tracking.trail.read | [`shipments.md`](admin/api/shipments.md) |

### `/users` — 8 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/users/` | `users.read` | — | [`users.md`](admin/api/users.md) |
| GET | `/users/:userId` | `users.read` | — | [`users.md`](admin/api/users.md) |
| PATCH | `/users/:userId` | `users.update` | ✅ users.update | [`users.md`](admin/api/users.md) |
| GET | `/users/:userId/activity` | `users.read` + `audit.read` | — | [`users.md`](admin/api/users.md) |
| POST | `/users/:userId/login-link` | `users.login_link.send` | ✅ users.login_link.send | [`users.md`](admin/api/users.md) |
| POST | `/users/:userId/password-reset-link` | `users.password.reset` | ✅ users.password_reset_link.send | [`users.md`](admin/api/users.md) |
| POST | `/users/:userId/restore` | `users.suspend` | ✅ users.reinstate | [`users.md`](admin/api/users.md) |
| POST | `/users/:userId/suspend` | `users.suspend` | ✅ users.suspend | [`users.md`](admin/api/users.md) |

### `/audit` — 7 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/audit/` | `audit.read` | — | [`audit.md`](admin/api/audit.md) |
| GET | `/audit/:auditId` | `audit.read` | — | [`audit.md`](admin/api/audit.md) |
| GET | `/audit/actions` | `audit.read` | — | [`audit.md`](admin/api/audit.md) |
| GET | `/audit/exports` | `audit.export` | — | [`audit.md`](admin/api/audit.md) |
| POST | `/audit/exports` | `audit.export` | ✅ audit.export | [`audit.md`](admin/api/audit.md) |
| GET | `/audit/exports/:exportId` | `audit.export` | — | [`audit.md`](admin/api/audit.md) |
| GET | `/audit/exports/:exportId/download` | `audit.export` | — | [`audit.md`](admin/api/audit.md) |

### `/accounts` — 5 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/accounts/:ownerType/:ownerId` | `money.earnings.read` + `billing.plans.read` + `cod.overview.read` | — | [`accounts.md`](admin/api/accounts.md) |
| GET | `/accounts/:ownerType/:ownerId/activity` | `money.earnings.read` + `billing.plans.read` | — | [`accounts.md`](admin/api/accounts.md) |
| GET | `/accounts/:ownerType/:ownerId/cash-ledger` | `cod.overview.read` | — | [`accounts.md`](admin/api/accounts.md) |
| GET | `/accounts/:ownerType/:ownerId/credits` | `billing.plans.read` | — | [`accounts.md`](admin/api/accounts.md) |
| GET | `/accounts/:ownerType/:ownerId/payouts` | `money.payouts.read` | — | [`accounts.md`](admin/api/accounts.md) |

### `/approvals` — 5 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/approvals/` | `approvals.read` | — | [`authorization.md`](admin/api/authorization.md) |
| DELETE | `/approvals/:approvalId` | *self* | ✅ approvals.withdrawn | [`authorization.md`](admin/api/authorization.md) |
| GET | `/approvals/:approvalId` | `approvals.read` | — | [`authorization.md`](admin/api/authorization.md) |
| POST | `/approvals/:approvalId/approve` | *self* | ◐ dynamic | [`authorization.md`](admin/api/authorization.md) |
| POST | `/approvals/:approvalId/reject` | *self* | ✅ approvals.rejected | [`authorization.md`](admin/api/authorization.md) |

### `/contracts` — 4 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/contracts/:contractId` | `agencies.read` + `agents.read` | — | [`contracts.md`](admin/api/contracts.md) |
| POST | `/contracts/:contractId/reinstate` | `agents.contracts.manage` | ✅ agents.contracts.reinstate | [`contracts.md`](admin/api/contracts.md) |
| POST | `/contracts/:contractId/suspend` | `agents.contracts.manage` | ✅ agents.contracts.suspend | [`contracts.md`](admin/api/contracts.md) |
| POST | `/contracts/:contractId/terminate` | `agents.contracts.manage` | ✅ agents.contracts.terminate | [`contracts.md`](admin/api/contracts.md) |

### `/files` — 5 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/files/` | `files.resolve` | — | [`files.md`](admin/api/files.md) |
| GET | `/files/:fileId` | `files.resolve` | — | [`files.md`](admin/api/files.md) |
| GET | `/files/:fileId/content` | `files.content.read` | ✅ files.content.read | [`files.md`](admin/api/files.md) |
| DELETE | `/files/:fileId/permanent` | `files.delete` | ✅ files.delete | [`files.md`](admin/api/files.md) |
| GET | `/files/orphans` | `files.orphans.read` | — | [`files.md`](admin/api/files.md) |

### `/permissions` — 3 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/permissions/catalog` | *self* | — | [`authorization.md`](admin/api/authorization.md) |
| GET | `/permissions/me` | *self* | — | [`authorization.md`](admin/api/authorization.md) |
| GET | `/permissions/tiers` | `permissions.read` | — | [`authorization.md`](admin/api/authorization.md) |

### `/health` — 2 routes

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| GET | `/health/live` | *unversioned* | — | [`health.md`](admin/api/health.md) |
| GET | `/health/ready` | *unversioned* | — | [`health.md`](admin/api/health.md) |

### `/messaging` — 1 route

| Method | Path | Permission | Audited | Documented in |
|---|---|---|---|---|
| POST | `/messaging/telegram` | `messaging.telegram.send` | ✅ messaging.telegram.send | [`messaging.md`](admin/api/messaging.md) |
