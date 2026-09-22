# Deploying trip-packer to trips.planetracker.app

Target: the existing Plane Tracker VPS, **198.71.49.25**. Same box, different
port (4100) and a second Caddy site block. Nothing here touches the running
Plane Tracker app (port 3000).

---

## Step 1 — DNS (the blocker)

Add one record at whoever hosts DNS for `planetracker.app`:

```
Type   Name    Value             TTL
A      trips   198.71.49.25      300
```

Use `trips` (not the FQDN) if the provider appends the zone automatically. If
the provider wants the full name, use `trips.planetracker.app`.

**Verify before doing anything else.** Caddy requests a TLS certificate on first
request for a hostname, and Let's Encrypt will fail the HTTP-01 challenge if the
name does not resolve. Deploying first means a failed cert and a confusing
debugging session.

```bash
dig +short trips.planetracker.app
# must print 198.71.49.25
```

Do not proceed until that returns the right IP. Propagation is usually minutes
at TTL 300.

---

## Step 2 — Deploy

```bash
scp -r deploy/ root@198.71.49.25:/opt/trip-packer/    # or git pull as in the script
ssh root@198.71.49.25
cd /opt/trip-packer && ./deploy/deploy.sh
```

The script is idempotent and re-runnable. It:

- refuses to continue if port **4100** is held by anything that is not
  `trip-packer` (so it cannot clobber a stray process)
- creates a `trip-packer` system user, separate from `plane-tracker`, so the
  two apps cannot read each other's files
- takes a **WAL-safe** backup via `sqlite3 .backup` before touching the DB, and
  verifies it by *querying the copy* — a `cp` of a WAL-mode database is a
  silently empty file that still passes `integrity_check`
- validates the Caddy config and **skips the reload if invalid**, rather than
  taking down HTTPS for both sites
- smoke-tests `GET /api/state`, expecting **401**

### The 401 smoke test is load-bearing

A 401 is the correct result *and* a security canary. `/api/state` must require a
session. If it returns 200, the per-user scoping has regressed and the endpoint
is handing every user's data to anonymous callers — the script treats 200 as a
hard failure and refuses to call the deploy good.

---

## Step 3 — Create the owner account

Accounts are **not** self-service; registration is closed by design. Create the
first one on the server:

```bash
sudo -u trip-packer npm run create-account -- \
  --email you@example.com --name "Tyler Morgan"
```

It prompts for the password with echo disabled. The **first** account created is
automatically made owner; later ones are not. Pass `--owner` explicitly to
promote a subsequent account.

`data/` must be owned by `trip-packer`, since the CLI and the service open the
same SQLite file. The deploy script sets this.

---

## Notes / gotchas

**`deploy/.env.example` is optional.** The app reads only `NODE_ENV` and
`TRIP_PACKER_DB`, both of which have working defaults. There is deliberately no
secret: sessions are opaque random tokens in the `sessions` table delivered as
HttpOnly cookies, so nothing is signed with a server key and there is no
`SESSION_SECRET` to leak. If one is ever added, put it in `.env` at mode 600 —
not in the systemd unit, where `systemctl show` exposes it to any local user.

**Caddy import is additive.** The script appends `import /etc/caddy/trip-packer.caddy`
to `/etc/caddy/Caddyfile` only if that line is absent, so the existing
plane-tracker block stays untouched. Both sites share one Caddy process and get
independent certificates.

**WAL + `ProtectSystem=full`.** The unit grants `ReadWritePaths` on
`/opt/trip-packer/data` because SQLite in WAL mode writes `-wal` and `-shm`
sidecars next to the database. Without write access the app *starts fine* and
then fails on the first write, which is a misleading way to find a permissions
problem.

**Not verified locally.** There is no Caddy binary on this Mac, so the site
block has not been run through `caddy validate`. It is a copy of the
plane-tracker block with the domain and upstream port changed, and the deploy
script validates before reloading — but the first validation happens on the VPS.

**iOS still points at the LAN IP.** `cap sync` baked the local address into the
app; item 13 covers rebuilding against the live domain.
