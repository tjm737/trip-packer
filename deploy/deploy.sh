#!/usr/bin/env bash
#
# deploy.sh — deploy trip-packer to a VPS behind nginx.
#
# Run AS ROOT on the VPS. Mirrors plane-tracker's deploy.sh conventions:
#   - app lives in /opt/<name>, owned by a dedicated system user
#   - nginx terminates HTTP and proxies to the app on localhost only
#   - systemd unit with restart-on-failure
#
# TLS is NOT configured here. certbot --nginx issues the certificate after the
# plain-HTTP site block is live and verified; see the final summary output.
#
# Differences from plane-tracker's script that are deliberate:
#   - the app data is SQLite in WAL mode, so the pre-deploy backup uses
#     `sqlite3 .backup` rather than `cp`. Copying a WAL-mode DB file with cp
#     produces a SILENTLY EMPTY backup: the main .db is a stub and the real
#     data sits in the -wal sidecar. `integrity_check` returns "ok" for the
#     empty file too, so the mistake is invisible until you need the backup.
#   - the backup is verified by QUERYING THE COPY, which is the only honest
#     check that it contains data.

set -euo pipefail

APP_NAME="trip-packer"
APP_DIR="/opt/${APP_NAME}"
REPO_DIR="${APP_DIR}"
# Domain nginx serves this app on. Override without editing this file:
#   DOMAIN=trips.mydomain.com bash deploy/deploy.sh
DOMAIN="${DOMAIN:-trips.example.com}"
PORT=4100
SERVICE_USER="trip-packer"
DB_PATH="${APP_DIR}/data/trip-packer.db"
BACKUP_DIR="/var/backups/${APP_NAME}"
REPO_URL="${REPO_URL:-}"

info() { printf '\033[0;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m  ✓\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m  !\033[0m %s\n' "$1"; }
die()  { printf '\033[0;31m  ✗\033[0m %s\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root."

# ── Preflight: port must not collide with plane-tracker (3000) ──────────────
info "Preflight checks"
if ss -ltnp 2>/dev/null | grep -q ":${PORT} "; then
  if ! systemctl is-active --quiet "${APP_NAME}" 2>/dev/null; then
    die "Port ${PORT} is in use by something other than ${APP_NAME}. Refusing to continue."
  fi
  ok "Port ${PORT} held by the existing ${APP_NAME} service (will be restarted)"
else
  ok "Port ${PORT} is free"
fi

# ── System user ─────────────────────────────────────────────────────────────
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  info "Creating system user ${SERVICE_USER}"
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  ok "Created ${SERVICE_USER}"
else
  ok "User ${SERVICE_USER} exists"
fi

# ── Code ────────────────────────────────────────────────────────────────────
mkdir -p "${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  info "Updating existing checkout"
  # Matches plane-tracker's approach: discard local changes so a pull cannot
  # fail on a conflict from a previous hotfix.
  git -C "${APP_DIR}" reset --hard HEAD
  git -C "${APP_DIR}" clean -fd -e data -e .env -e .env.local
  git -C "${APP_DIR}" pull --ff-only
  ok "Repository updated"
else
  [[ -n "${REPO_URL}" ]] || die "REPO_URL is not set and ${APP_DIR} is not a checkout."
  info "Cloning ${REPO_URL}"
  git clone "${REPO_URL}" "${APP_DIR}"
  ok "Repository cloned"
fi

cd "${APP_DIR}"

# ── Dependencies + build ────────────────────────────────────────────────────
info "Installing dependencies"
# NOT --omit=dev. The build needs packages that live in devDependencies:
# @tailwindcss/postcss is loaded by PostCSS during `next build`, and the
# TypeScript/@types pair is needed to compile. Pruning dev deps first makes the
# build die on "Cannot find module '@tailwindcss/postcss'".
#
# This needs a C toolchain: better-sqlite3 is a native module and compiles on
# install. Building after install is correct because the module is loaded at
# runtime from the built output, not during the build.
#
# Check for the toolchain first. Without it, npm fails deep inside node-gyp with
# "not found: make" after several minutes of work, and the error names the
# symptom rather than the missing package.
missing=""
for tool in make g++ python3; do
  command -v "$tool" >/dev/null 2>&1 || missing="${missing} ${tool}"
done
if [[ -n "${missing}" ]]; then
  info "missing build tools:${missing} (needed to compile better-sqlite3)"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq build-essential python3 >/dev/null \
      || die "could not install build-essential. Run: apt-get update && apt-get install -y build-essential python3"
    ok "build toolchain installed"
  else
    die "install a C++ toolchain and python3, then re-run (missing:${missing})"
  fi
fi

# A previous failed install leaves a half-built better-sqlite3 in node_modules.
# npm ci reuses that directory instead of starting over, so the failure repeats
# even after the toolchain is present. Removing just that package is enough and
# avoids a full re-download.
if [[ -d "${APP_DIR}/node_modules/better-sqlite3/build" && ! -f "${APP_DIR}/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]]; then
  warn "found a broken better-sqlite3 build; removing it so npm rebuilds cleanly"
  rm -rf "${APP_DIR}/node_modules/better-sqlite3"
fi

npm ci || npm install
ok "Dependencies installed"

info "Building"
npm run build
ok "Build complete"

# Prune dev dependencies only AFTER the build, so the running service carries
# less on disk without breaking the build that produced it.
#
# next and react are regular dependencies, so they survive this. If a package
# is ever moved from dependencies to devDependencies and is needed at runtime,
# this line is what will surface it — as a crash on first request, not at boot.
npm prune --omit=dev
ok "Dev dependencies pruned"

# ── Database backup (WAL-safe) ──────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"
chown "${SERVICE_USER}:${SERVICE_USER}" "${BACKUP_DIR}"
if [[ -f "${DB_PATH}" ]]; then
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  DEST="${BACKUP_DIR}/trip-packer-${STAMP}.db"
  info "Backing up database (WAL-safe)"
  # Stop writes for a consistent snapshot. `sqlite3 .backup` is the ONLY safe
  # copy method for a WAL-mode database.
  systemctl stop "${APP_NAME}" 2>/dev/null || true
  if sqlite3 "${DB_PATH}" ".backup '${DEST}'" 2>/dev/null; then
    # Verify by QUERYING the copy. A file that exists and passes integrity_check
    # can still be an empty stub, so the row count is the real test.
    USERS="$(sqlite3 "${DEST}" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")"
    TRIPS="$(sqlite3 "${DEST}" "SELECT COUNT(*) FROM trips;" 2>/dev/null || echo "?")"
    if [[ "${USERS}" == "?" || "${TRIPS}" == "?" ]]; then
      die "Backup at ${DEST} is not a readable database. Aborting before touching the live DB."
    fi
    ok "Backup verified: ${USERS} user(s), ${TRIPS} trip(s) -> ${DEST}"
    # Keep the 10 most recent.
    ls -1t "${BACKUP_DIR}"/trip-packer-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
  else
    warn "sqlite3 not available or backup failed — continuing WITHOUT a fresh backup"
  fi
fi

# ── Ownership ───────────────────────────────────────────────────────────────
# data/ must exist before `systemctl start`, and before the unit is installed.
# The unit declares ReadWritePaths=/opt/trip-packer/data, and systemd resolves
# that path when it builds the mount namespace -- a missing directory fails the
# unit with status=226/NAMESPACE before the app is ever executed. The error
# names the path but not the reason, so it reads like a systemd problem rather
# than a missing mkdir.
#
# It must also be writable by the service user: SQLite in WAL mode creates
# db-wal and db-shm files beside the database, so a read-only directory fails on
# first write rather than at startup.
mkdir -p "${APP_DIR}/data"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
# No 2>/dev/null and no || true here. Silencing this is what let a missing
# directory look like a success in the first place.
chmod 750 "${APP_DIR}/data"
[[ -d "${APP_DIR}/data" ]] || die "${APP_DIR}/data does not exist; systemd would fail with 226/NAMESPACE"
ok "Ownership set"

# ── systemd ─────────────────────────────────────────────────────────────────
info "Installing systemd unit"
install -m 644 "${APP_DIR}/deploy/trip-packer.service" "/etc/systemd/system/${APP_NAME}.service"
systemctl daemon-reload
systemctl enable "${APP_NAME}" >/dev/null 2>&1 || true
systemctl restart "${APP_NAME}"
sleep 2
if systemctl is-active --quiet "${APP_NAME}"; then
  ok "${APP_NAME} is running"
else
  journalctl -u "${APP_NAME}" -n 30 --no-pager || true
  die "${APP_NAME} failed to start (see journal above)"
fi

# ── nginx ───────────────────────────────────────────────────────────────────
# This box runs nginx (it already serves plane-tracker on the same ports), so
# nginx is the web tier here. An earlier revision of this script configured
# Caddy instead: Caddy could never bind 80/443 while nginx held them, and the
# install failed silently while the script still reported success.
if command -v nginx &>/dev/null; then
  info "Configuring nginx for ${DOMAIN}"
  NGINXFILE="/etc/nginx/sites-available/${APP_NAME}"
  # The template carries {{DOMAIN}} rather than a literal hostname, so that no
  # real domain lives in the repository. Substituting here rather than shipping
  # a second pre-filled file keeps one source of truth for the site block.
  sed "s/{{DOMAIN}}/${DOMAIN}/g" "${APP_DIR}/deploy/trip-packer.nginx" > "${NGINXFILE}"
  chmod 644 "${NGINXFILE}"
  # Fail loudly if the placeholder survived: nginx would treat "{{DOMAIN}}" as a
  # literal hostname, so the site would not match and requests would fall through
  # to the default block -- serving the WRONG app on this hostname with a 200,
  # which looks like success from outside.
  if grep -q "{{DOMAIN}}" "${NGINXFILE}"; then
    die "nginx template placeholder {{DOMAIN}} was not substituted (DOMAIN='${DOMAIN}')"
  fi

  if [[ ! -L "/etc/nginx/sites-enabled/${APP_NAME}" ]]; then
    ln -s "${NGINXFILE}" "/etc/nginx/sites-enabled/${APP_NAME}"
    ok "Enabled ${APP_NAME} site"
  fi

  # `nginx -t` validates the WHOLE config, including plane-tracker. A failure
  # here means we must NOT reload, or both sites go down.
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    ok "nginx reloaded"
  else
    nginx -t || true
    die "nginx config test failed; NOT reloading (plane-tracker is still serving). Fix ${NGINXFILE}"
  fi
else
  NGINX_MISSING=1
  warn "nginx not installed — the app is reachable only on localhost:${PORT}."
  warn "Nothing is serving http://${DOMAIN}."
fi

# ── Smoke test ──────────────────────────────────────────────────────────────
info "Smoke test (localhost)"
# /api/state must require a session. A 401 here is the CORRECT result and is
# also a useful canary: a 200 would mean the scoping fix regressed and the
# endpoint is serving all users to anonymous callers.
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/state" || echo "000")"
if [[ "${CODE}" == "401" ]]; then
  ok "GET /api/state -> 401 (session required, as intended)"
elif [[ "${CODE}" == "200" ]]; then
  die "GET /api/state -> 200 without a session. The state endpoint is leaking data; do not expose this."
else
  warn "GET /api/state -> ${CODE} (expected 401; app may still be starting)"
fi

# ── DNS / routing check ─────────────────────────────────────────────────────
# Checks plain HTTP, because this script does not configure TLS (certbot does,
# afterwards). An earlier revision tested https:// here: it could only ever
# report failure before a cert existed, and once one did exist it would return
# 200 for the WRONG app -- nginx falls back to its default server block when no
# server_name matches, so an unmatched host still answers 200. Reported success
# while serving the wrong site.
info "DNS check for ${DOMAIN}"
if getent hosts "${DOMAIN}" >/dev/null 2>&1 || host "${DOMAIN}" >/dev/null 2>&1; then
  ok "${DOMAIN} resolves"
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://${DOMAIN}/" 2>/dev/null)"
  HTTP_CODE="${HTTP_CODE:-000}"

  # Identify which app answered, not merely that something did. The Server
  # header cannot distinguish the two Next.js apps on this box, so match on the
  # rendered page instead. The brand string is "TripPlanner" (no space) as
  # rendered by the app -- an earlier revision checked for "Trip Packer" /
  # "trip-packer", neither of which appears in the HTML, so a perfectly good
  # deploy was reported as "does NOT look like trip-packer".
  if [[ "${HTTP_CODE}" =~ ^(200|302|307)$ ]]; then
    BODY="$(curl -s "http://${DOMAIN}/" 2>/dev/null | head -c 6000)"
    if [[ "${BODY}" == *"TripPlanner"* || "${BODY}" == *"No trips planned"* || "${BODY}" == *"No trips yet"* ]]; then
      ok "http://${DOMAIN} -> ${HTTP_CODE} (serving trip-packer)"
    else
      warn "http://${DOMAIN} -> ${HTTP_CODE}, but the response does NOT look like trip-packer."
      warn "Another server block is answering this hostname. Check:"
      warn "    ls -l /etc/nginx/sites-enabled/"
      warn "    nginx -T | grep -A2 server_name"
    fi
  else
    warn "http://${DOMAIN} -> ${HTTP_CODE}"
    warn "If nginx was just configured, allow a moment and re-check."
  fi
else
  warn "${DOMAIN} does NOT resolve yet. Add the record, then re-run this script:"
  warn "    A  ${DOMAIN%%\.*}  ->  <SERVER_IP>"
fi

echo
if [[ "${NGINX_MISSING:-0}" -eq 1 ]]; then
  cat <<EOF

$(printf '\033[0;33m')Deploy finished WITHOUT a web server.$(printf '\033[0m')

  The app is running on localhost:${PORT}, but nothing serves
  http://${DOMAIN} — nginx is not installed. This is not a complete deploy.

  Install nginx, then re-run this script:

      apt-get update && apt-get install -y nginx

  The re-run is idempotent and will leave the already-built app in place.

EOF
else
  info "Done. Next steps:"

  # TLS is not configured by this script. Say so explicitly, because the smoke
  # test above uses plain HTTP and a reader could reasonably assume a working
  # https:// URL exists once the htttp:// one does.
  if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    echo "   No certificate for ${DOMAIN} yet. Once http://${DOMAIN} serves this"
    echo "   app, run:"
    echo "     certbot --nginx -d ${DOMAIN}"
  fi
fi
echo "   Create the owner account (run as root, from ${APP_DIR}):"
echo "     cd ${APP_DIR}"
echo "     node scripts/create-account.cjs --email you@example.com --name \"Your Name\""
echo "   The first account created becomes the owner."
