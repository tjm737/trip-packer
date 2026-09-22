#!/usr/bin/env bash
#
# update.sh — put an already-pulled revision live, and prove it worked.
#
#   cd /opt/trip-packer && bash deploy/update.sh
#
# WHY THIS EXISTS SEPARATELY FROM deploy.sh
#
# deploy.sh is the provisioning-and-deploy script. It is the right tool for a
# first install, or for a deploy from an unknown state: it creates the system
# user, writes the systemd unit, configures nginx, and takes a verified backup.
#
# It is the WRONG tool for the routine case, because it begins by DISCARDING
# LOCAL WORK:
#
#   deploy.sh:69   git reset --hard HEAD
#   deploy.sh:70   git clean -fd -e data -e .env -e .env.local
#
# That is deliberate there — it makes the deploy reproducible from a known
# revision. But it means anyone who edits a file on the server to debug
# something, then runs deploy.sh, silently loses the edit. This script does not
# reset or clean. It refuses to proceed on a dirty working tree instead, so the
# difference between "deploy" and "lose my debugging" is never a surprise.
#
# What it does do is the part that is easy to get wrong by hand, in the order
# that matters, with a check after each step:
#
#   1. pull --ff-only        (never a merge commit on the server)
#   2. clear .next           (stale prerender; see the note below)
#   3. npm ci                (only when the lockfile changed)
#   4. build
#   5. migrate, verify       (migrations run on boot, so this starts the service)
#   6. restart, verify       (service active, port listening, routes answering)
#   7. re-check the routes   (the security canary)
#
# Step 2 is the fix from commit c65f104. `.next` is gitignored, so `git clean
# -fd` skips it, and a stale artifact survives a build. The one that bites is a
# prerendered server/app/index.html for a route that has since become
# force-dynamic: Next finds the prerender, keeps serving it, and the route
# reports x-nextjs-prerender: 1 with a year-long s-maxage. The build looks
# clean and the page is old. Clearing the directory is the only reliable fix.

set -euo pipefail

APP_NAME="trip-packer"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
PORT="${PORT:-4100}"
DOMAIN="${DOMAIN:-trips.planetracker.app}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
SERVICE_USER="${SERVICE_USER:-${APP_NAME}}"

# Route checks. The status is what matters; the canary is /api/state.
CHECK_PATHS=("/login" "/")
# /api/state must NOT be 200 for an anonymous request. 200 means per-user
# scoping has regressed and every account's data is being handed to anyone who
# asks. 401 is the only acceptable answer.
CANARY_PATH="/api/state"
CANARY_EXPECT=401

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
if [[ ! -t 1 ]]; then c_red=""; c_grn=""; c_ylw=""; c_dim=""; c_off=""; fi

step() { printf '\n%s==>%s %s\n' "$c_dim" "$c_off" "$1"; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '  %s✓%s %s\n' "$c_grn" "$c_off" "$1"; }
warn() { printf '  %s!%s %s\n' "$c_ylw" "$c_off" "$1"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$c_red" "$1" "$c_off" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
step "Preflight"

if [[ "$(id -u)" -ne 0 ]]; then
  die "Run as root: sudo bash deploy/update.sh"
fi
ok "running as root"

[[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} is not a git checkout. Use deploy/deploy.sh for a first install."
cd "${APP_DIR}"
ok "checkout at ${APP_DIR}"

# Refuse on a dirty tree rather than resetting it. This is the whole point of
# having this script instead of calling deploy.sh.
#
# THE ONE EXCEPTION: package-lock.json churn from npm.
#
# `npm ci` / `npm install` rewrites package-lock.json as a side effect — it
# reorders keys and adds platform-specific optional deps (the Tailwind v4 WASM
# entries, for example). The file is tracked, so that rewrite shows up as a
# modification and this guard fired on EVERY deploy, permanently blocking the
# update with a message about "your changes" when the user had made none.
#
# A machine-generated artifact is not the thing this guard exists to protect.
# The guard is here to stop `git reset --hard` from destroying HAND EDITS —
# someone debugging a file on the server. A lockfile npm rewrote is not that:
# discarding it loses nothing, and it must be restored to a committed state
# anyway or the next `npm ci` inherits a doctored dependency tree.
#
# So: if the ONLY dirt is a modified package-lock.json, restore that one file
# and continue. Anything else still refuses. This is deliberately narrow — a
# glob over "generated files" would eventually swallow a real edit.
#
# Note the check is on a MODIFIED lockfile only. An untracked or deleted
# package-lock.json is a different situation (a botched merge, a stray rm) and
# still stops the deploy, because `git checkout --` cannot repair those.
UNTRACKED_OR_DELETED="$(git status --porcelain | grep -vE '^[[:space:]]*M[[:space:]]+package-lock\.json$' || true)"
if [[ -n "${UNTRACKED_OR_DELETED}" ]]; then
  printf '\n' >&2
  git status --short >&2
  die "Working tree is dirty. Commit, stash, or discard those changes first.
     This script will not reset the tree for you — deploy/deploy.sh does that,
     and it is exactly why this script exists.
     (Only a modified package-lock.json is auto-restored; anything else, and
     any untracked/deleted file, stops here.)"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  info "package-lock.json was rewritten by npm — restoring it (not a real edit)"
  git checkout -- package-lock.json ||
    die "Could not restore package-lock.json. Inspect it by hand."
fi
ok "working tree clean"

BEFORE_REV="$(git rev-parse --short HEAD)"
info "current revision ${BEFORE_REV}"

# ── 1. Pull ──────────────────────────────────────────────────────────────────
step "Pulling"

# --ff-only, so a divergent server tree fails loudly instead of creating a merge
# commit that only exists on this machine.
if ! git pull --ff-only; then
  die "git pull --ff-only failed. The server branch has diverged from origin.
     Resolve it deliberately (git log origin/main..HEAD) rather than merging here."
fi
AFTER_REV="$(git rev-parse --short HEAD)"

if [[ "${BEFORE_REV}" == "${AFTER_REV}" ]]; then
  warn "already at ${AFTER_REV} — nothing new to deploy"
  info "Continuing anyway: this rebuilds and re-verifies the running revision,"
  info "which is what you want after a manual edit or a suspected stale build."
else
  ok "updated ${BEFORE_REV} → ${AFTER_REV}"
  git --no-pager log --oneline "${BEFORE_REV}..${AFTER_REV}" | sed 's/^/     /'
fi

# ── 2. Clear the build output ────────────────────────────────────────────────
step "Clearing build output"

# See the header. Not optional, and not something `git clean` did for us.
rm -rf "${APP_DIR}/.next"
ok "removed .next"

# ── 3. Dependencies ──────────────────────────────────────────────────────────
step "Dependencies"

# npm ci replaces node_modules wholesale, so it is slow and it recompiles the
# better-sqlite3 native module. Skip it unless the lockfile actually changed
# between the revisions we just moved across. On a clean install (no change)
# this is the difference between a 20-second update and a 3-minute one.
#
# The "keep node_modules" shortcut is only safe if the tree is actually
# complete. Existence of the directory proves nothing: a partially installed
# tree, a hand-cleared package, or a stray `rm -rf .npm/` leaves node_modules
# present but missing packages, and the skip then hands a broken tree straight
# to the build.
#
# This is not hypothetical. `@tailwindcss/postcss` is loaded by PostCSS during
# `next build`, and when it goes missing the build fails with a Turbopack
# require trace pointing at postcss.config.mjs — an error that names the config
# file and never mentions the missing package, so it reads as a config bug.
# Sentinel-probe the packages that the build itself loads, and reinstall when any
# is absent.
needs_install=false
if git diff --name-only "${BEFORE_REV}".."${AFTER_REV}" 2>/dev/null | grep -qx "package-lock.json"; then
  info "package-lock.json changed — reinstalling"
  needs_install=true
elif [[ ! -d node_modules ]]; then
  info "node_modules is missing — installing"
  needs_install=true
else
  # Resolve the build-critical packages through Node the same way the build
  # does, rather than testing for a directory. `require.resolve` fails if the
  # package is absent, which is exactly the condition that breaks `next build`.
  #
  # Resolve the bare specifier, NOT '<pkg>/package.json'. Packages with an
  # `exports` map (Tailwind v4 among them) do not expose ./package.json, so the
  # subpath form is refused even when the package is installed and the probe
  # then reports a false positive — which would force a full `npm ci` on every
  # deploy and, worse, mask the real missing-package signal.
  missing=""
  for pkg in "@tailwindcss/postcss" "tailwindcss" "next" "better-sqlite3"; do
    if ! node -e "require.resolve('${pkg}')" >/dev/null 2>&1; then
      missing="${missing} ${pkg}"
    fi
  done
  if [[ -n "${missing}" ]]; then
    info "node_modules is incomplete (missing:${missing}) — reinstalling"
    needs_install=true
  else
    ok "lockfile unchanged and node_modules is complete — keeping it"
  fi
fi

if [[ "${needs_install}" == true ]]; then
  npm ci || die "npm ci failed. If this is a native-module error, the box needs a
     C toolchain: apt-get install -y build-essential python3"
  ok "dependencies installed"
fi

# ── 4. Build ─────────────────────────────────────────────────────────────────
step "Building"

# NOT --omit=dev: @tailwindcss/postcss is a devDependency and PostCSS loads it
# during `next build`. Pruning dev deps first makes the build die on
# "Cannot find module '@tailwindcss/postcss'".
npm run build || die "Build failed. The output above is the real error; nothing was restarted."
ok "build complete"

# ── 5. Ownership + restart ───────────────────────────────────────────────────
step "Restarting service"

mkdir -p "${APP_DIR}/data"
# SQLite in WAL mode creates -wal and -shm files beside the database, so the
# directory must be writable by the service user or the first write fails.
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
chmod 750 "${APP_DIR}/data"
ok "ownership set"

systemctl restart "${APP_NAME}"
sleep 2

if systemctl is-active --quiet "${APP_NAME}"; then
  ok "${APP_NAME} is running"
else
  journalctl -u "${APP_NAME}" -n 30 --no-pager || true
  die "${APP_NAME} failed to start (journal above). The previous build is gone;
     fix forward or check out ${BEFORE_REV} and re-run."
fi

# The service binds after reading the DB and running migrations, so a listening
# port is the first honest signal that boot got past the database.
for i in $(seq 1 15); do
  if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then break; fi
  [[ "${i}" -eq 15 ]] && die "Nothing is listening on :${PORT} after 15s."
  sleep 1
done
ok "listening on :${PORT}"

# ── 6. Route checks ──────────────────────────────────────────────────────────
step "Checking routes"

# Hit the app directly, not through nginx: this isolates "the app is broken"
# from "the proxy is broken", which are different fixes.
FAILED=0
for p in "${CHECK_PATHS[@]}"; do
  CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${BASE_URL}${p}" || echo "000")"
  if [[ "${CODE}" == "200" ]]; then
    ok "${p} → ${CODE}"
  else
    warn "${p} → ${CODE}"
    FAILED=1
  fi
done

# ── 7. Security canary ───────────────────────────────────────────────────────
step "Security canary"

CANARY_CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${BASE_URL}${CANARY_PATH}" || echo "000")"
if [[ "${CANARY_CODE}" == "${CANARY_EXPECT}" ]]; then
  ok "${CANARY_PATH} → ${CANARY_CODE} (unauthenticated requests are rejected)"
else
  printf '\n' >&2
  warn "${CANARY_PATH} → ${CANARY_CODE}, expected ${CANARY_EXPECT}"
  die "Per-user scoping may have regressed: ${CANARY_PATH} is answering
     unauthenticated requests with ${CANARY_CODE}. If that is 200, any anonymous
     caller is being served account data. Treat this as an incident, not a
     warning: ${BASE_URL}${CANARY_PATH} should be 401."
fi

# ── Done ─────────────────────────────────────────────────────────────────────
step "Done"
ok "now running ${AFTER_REV}"
if [[ -n "${DOMAIN}" ]]; then
  info "public:  http://${DOMAIN}"
fi
info "logs:    journalctl -u ${APP_NAME} -f"
info "rollback: git checkout ${BEFORE_REV} && bash deploy/update.sh"

if [[ "${FAILED}" -ne 0 ]]; then
  exit 1
fi
