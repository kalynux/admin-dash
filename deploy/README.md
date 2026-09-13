# Deploying admin dashboard

Operational doc for **this app only**. The one-time, cross-repo setup — DNS
records, the `production` branches, the plan seed — lives in
**`frontend/DEPLOY-FRONTENDS.md`** and is not repeated here.

| | |
|---|---|
| Serves | **https://admin.wi-mall.com** |
| Talks to | https://admin-api.wi-mall.com/api/v1 (wi-admin) |
| Dokploy project | `Wi-Mall-Frontend` |
| Dokploy stack | `wi-admin-dash` (type: Compose, source: **Raw**) |
| Image | `ghcr.io/kalynux/wimall-admin-dash` |
| Runtime | static bundle behind nginx on port 80 |
| Replicas | 1 |
| Release branch | `production` (cut from `main`) |

## Files in this repo

| File | What it does |
|---|---|
| `Dockerfile` | Two-stage build. Read the comments before changing it — each warning in there is a failure that actually happened. |
| `.dockerignore` | Keeps developer env overrides and the native project out of the image. ⚠ A `*.local` env file reaching the build would silently win over `.env.production`. |
| `deploy/nginx.conf` | SPA fallback, cache policy, and a 404 (not a fallback) for missing assets. |
| `deploy/docker-compose.prod.yml` | The stack. Already loaded into Dokploy; this is the source of truth to re-paste from. |
| `.env.production` | **Committed on purpose.** Every value is inlined into the public bundle at build time, so none of it is secret — and CI has no other way to learn the production hosts. |
| `.github/workflows/release.yml` | Builds and pushes the image on `production`. Deploys nothing. |
| `.github/workflows/ci.yml` | Checks every push and PR. Publishes nothing. |

## Releasing a change

```bash
git checkout production
git merge main          # or commit directly
git push
```

Then: watch **Actions** for a green *Release image*, and press **Deploy** on the
`wi-admin-dash` stack in Dokploy.

> ⚠ **Deploy WITHOUT `--build`.** The service uses `image:`, so there is nothing
> to build — but Dokploy offers to build on the host by default, and a build next
> to a 1.5 GB mongod on an 8 GB box ends with the kernel killing the database.

Nothing deploys automatically. That is deliberate; `release.yml` carries the
wiring for the other choice, skipped unless a `DOKPLOY_DEPLOY_URL` secret exists.

## Configuration lives in two places, and the split matters

**Build time — `.env.production`, in this repo.** The API host and everything else the
app reads. Vite inlines these into the
JavaScript, so **the image IS the configuration**: changing this file does nothing
to a running container, it takes a new image.

**Deploy time — the Dokploy Environment tab.** Three values that only decide which
image is pulled and which hostname routes to it: `GHCR_OWNER`, `ADMIN_DASH_TAG`,
`ADMIN_DASH_HOST`. The app never reads them. ⚠ **Nothing secret belongs in either
place** — one is committed and the other is public configuration.

## Rolling back

`ADMIN_DASH_TAG` is `production`, a **moving** tag — it changes on every release, so on
its own there is nothing to go back to. Every build prints an immutable alternative
in its Actions summary:

```
ADMIN_DASH_TAG=sha-1a2b3c4
```

Paste that over `production` in the Environment tab and press **Deploy**.

## Verifying

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://admin.wi-mall.com/
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://admin.wi-mall.com/   # must redirect
curl -s -o /dev/null -w '%{http_code}\n' https://admin.wi-mall.com/dashboard/vendors        # deep link, hard refresh
```

Then open it and **sign in**. A 200 only proves the server is serving; it says
nothing about whether the bundle can reach its API.

## Shell access

```bash
ssh <user>@100.89.182.51      # tailnet only; the public IP answers on 80/443
cd /etc/dokploy/compose/compose-transmit-back-end-driver-epjt8w/code
docker compose -p compose-transmit-back-end-driver-epjt8w logs -f
```

⚠ The `-p` flag is not optional. Without it compose invents a project name from
the directory and operates on a **second**, empty stack — the error then says
nothing about the cause.

## What this app talks to

**Only `admin-api.wi-mall.com` (wi-admin).** Not `api.wi-mall.com` — that is
jovi-mall, the commerce API, and this dashboard never calls it. There is no second
base URL and no second token: the dashboard authenticates with the cookies wi-admin
sets, and holds no credential of its own.

⚠ **Do not put Cloudflare Access in front of `admin-api.wi-mall.com`.** It would
break this dashboard completely — the browser's requests would be answered with
Cloudflare's login page instead of data, and because that redirect is cross-origin
the browser discards it, so every screen fails with a CORS error and no
explanation. Put Access on **`admin.wi-mall.com`** instead: a person signs in at
Cloudflare to load the page, and the API keeps its own authentication, MFA and rate
limiting behind it. See frontend/DEPLOY-FRONTENDS.md step 5.

## Troubleshooting

### The image will not pull — `manifest unknown`

Three causes, in the order they are likely:

1. **The `production` branch has never been pushed**, so no image exists. Check the
   repo's Actions tab for a green *Release image* run.
2. **The tag in the Environment tab does not exist.** A `sha-` tag is only created
   by the build that produced it; a typo is indistinguishable from a missing image.
3. **Dokploy's registry credential expired.** One credential (`ghcr.io`, user
   `kalynux`) serves every stack on this host — if the backend images also stop
   pulling, it is this. Settings → Registry.

### The page loads but every request fails

Almost always CORS or the baked-in API host, and they are distinguishable:

- Open the browser console. `Access-Control-Allow-Origin` missing → the origin is
  not in the backend's allowlist. **Verified present on 2026-09-13** for all four
  production origins, so suspect a changed hostname rather than the backend.
- Requests going to `localhost` → the image was built without its production env
  file. That should be impossible: the Dockerfile has a guard that fails the build
  if the production host is not in the bundle. If you see it, the guard was removed.

### A deep link 404s or renders blank on a hard refresh

This is the failure the `base` setting exists to prevent. Test it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://admin.wi-mall.com/dashboard/vendors
curl -s -I https://admin.wi-mall.com/assets/ | head -1        # must be 404, never 200
```

A blank page with a console error about MIME types means index.html is asking for
assets at a path relative to the current URL. ⚠ Do not fix that in nginx — the fix
is the base path at build time, and the comment in `vite.config.ts` explains why.

### An Environment change seems to do nothing

Press **Deploy**, not Restart. A container reads its environment when it is
*created*; a restart re-runs the same container with the same values. Dokploy's own
banner says this, and it cost the backend deploy a round trip.
