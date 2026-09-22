#!/usr/bin/env bash
#
# bootstrap.sh — get trip-packer onto the VPS and deployed, from scratch.
#
# Run AS ROOT on the VPS:
#
#   bash bootstrap.sh
#
# Or with a token instead of a deploy key (simpler, no GitHub UI step):
#
#   GITHUB_TOKEN=ghp_xxx bash bootstrap.sh
#
# Safe to re-run. It is mostly diagnostics: it checks each precondition and
# tells you which one failed, rather than dying with a git error and leaving you
# to guess. Nothing destructive happens before the checks pass.

set -uo pipefail

REPO_OWNER="tjm737"
REPO_NAME="trip-packer"
REPO_SLUG="${REPO_OWNER}/${REPO_NAME}"
APP_DIR="/opt/${REPO_NAME}"
KEY_PATH="/root/.ssh/${REPO_NAME}"

# Hostname Caddy serves this app on. Required: the default is a placeholder that
# will not resolve, and a certificate request for it would fail.
#   DOMAIN=trips.mydomain.com bash bootstrap.sh
DOMAIN="${DOMAIN:-}"

# Colours only if stdout is a terminal, so piping to a file stays readable.
if [[ -t 1 ]]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=""; G=""; Y=""; D=""; N=""
fi

ok()   { printf '%s  ok%s   %s\n'   "${G}" "${N}" "$1"; }
bad()  { printf '%s  FAIL%s %s\n'   "${R}" "${N}" "$1"; }
warn() { printf '%s  warn%s %s\n'   "${Y}" "${N}" "$1"; }
info() { printf '%s  ..%s   %s\n'   "${D}" "${N}" "$1"; }
die()  { printf '\n%sCannot continue:%s %s\n\n' "${R}" "${N}" "$1"; exit 1; }

printf '\n== trip-packer bootstrap ==\n\n'

# ── Preconditions ───────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || die "must run as root (try: sudo bash $0)"

for tool in git node npm sqlite3; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool: $(command -v "$tool")"
  else
    die "$tool is not installed. Install it, then re-run."
  fi
done

# better-sqlite3 is a native addon: `npm ci` compiles it with node-gyp, which
# needs a C++ toolchain. Without these the install dies deep inside node-gyp
# with "not found: make", which names the symptom and not the cause.
printf '\n== build toolchain ==\n'
missing_tools=()
for tool in make g++ cc; do
  command -v "$tool" >/dev/null 2>&1 || missing_tools+=("$tool")
done
if [[ ${#missing_tools[@]} -gt 0 ]]; then
  warn "missing: ${missing_tools[*]} (needed to compile better-sqlite3)"
  if command -v apt-get >/dev/null 2>&1; then
    info "installing build-essential + python3 via apt-get"
    if apt-get update -qq && apt-get install -y -qq build-essential python3 >/dev/null; then
      ok "build toolchain installed"
    else
      die "could not install build-essential. Install it manually, then re-run:
       apt-get update && apt-get install -y build-essential python3"
    fi
  else
    die "no apt-get available; install a C++ toolchain and python3, then re-run"
  fi
else
  ok "make, g++, cc present"
fi

NODE_MAJOR="$(node -v | sed 's/^v//; s/\..*//')"
if [[ "${NODE_MAJOR}" -ge 20 ]]; then
  ok "node $(node -v) is new enough"
else
  # better-sqlite3 and Next 16 need a modern runtime; on an old Node the build
  # fails in ways that look unrelated to the real cause.
  die "node $(node -v) is too old - need v20+ (v24 recommended)"
fi

# The plane-tracker app shares this box. Refuse to collide with it.
printf '\n== port check ==\n'
for p in 3000 4100; do
  if ss -ltnp 2>/dev/null | grep -q ":${p} "; then
    if [[ "$p" == "4100" ]]; then
      warn "port 4100 is already in use (is trip-packer already running?)"
    else
      info "port ${p} in use (expected: plane-tracker)"
    fi
  else
    info "port ${p} free"
  fi
done

# ── Get the code ────────────────────────────────────────────────────────────
printf '\n== source code ==\n'

if [[ -d "${APP_DIR}/.git" ]]; then
  ok "already a checkout at ${APP_DIR} - will update it"
  USE_EXISTING=1
else
  USE_EXISTING=0
  info "${APP_DIR} is not a checkout yet"
fi

fetch_repo() {
  # The repo is public, so an anonymous HTTPS clone normally just works.
  # A token is still honoured if supplied, for forks or if it goes private again.
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    info "cloning with GITHUB_TOKEN"
    git clone --quiet \
      "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git" \
      "${APP_DIR}" || return 1
    # Do not leave the token in .git/config.
    git -C "${APP_DIR}" remote set-url origin "https://github.com/${REPO_SLUG}.git"
    return 0
  fi

  info "cloning ${REPO_SLUG} anonymously (public repo)"
  if git clone --quiet "https://github.com/${REPO_SLUG}.git" "${APP_DIR}"; then
    return 0
  fi

  # Anonymous failed. Most likely the repo went private again. Try a deploy key
  # before giving up, since one may already be on disk.
  if [[ -f "${KEY_PATH}" ]]; then
    info "anonymous clone failed; retrying with deploy key ${KEY_PATH}"
    GIT_SSH_COMMAND="ssh -i ${KEY_PATH} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
      git clone --quiet "git@github.com:${REPO_SLUG}.git" "${APP_DIR}" || return 1
    return 0
  fi

  return 3  # clone failed and there is no fallback credential
}

if [[ "${USE_EXISTING}" -eq 1 ]]; then
  git -C "${APP_DIR}" pull --ff-only --quiet && ok "updated" || warn "could not update; continuing with what is on disk"
else
  mkdir -p "$(dirname "${APP_DIR}")"
  set +e
  fetch_repo
  rc=$?
  set -e
  case "${rc}" in
  0) ok "cloned ${REPO_SLUG} to ${APP_DIR}" ;;
  *)
    cat <<EOF

  Could not clone ${REPO_SLUG}.

  If the anonymous clone was refused, the repo is probably private again. Two
  ways to get a credential, then re-run bootstrap.sh:

  A) personal access token (no GitHub UI step)
       GITHUB_TOKEN=<token> bash $0

     The token needs read access to this repo. It is used only for the clone and
     is stripped from .git/config immediately afterwards.

  B) deploy key
       ssh-keygen -t ed25519 -f ${KEY_PATH} -N "" -C "trip-packer-deploy"
       cat ${KEY_PATH}.pub
     Add that key at:
       https://github.com/${REPO_SLUG}/settings/keys
     (read-only access is enough; do NOT enable write access)

  If the repo IS public, check network egress: can this host reach github.com?
       curl -sI https://github.com | head -1

EOF
    die "git clone failed (see the error above)"
    ;;
esac
fi

# Prove we can actually read from origin before spending minutes on a build.
if git -C "${APP_DIR}" ls-remote --exit-code origin HEAD >/dev/null 2>&1; then
  ok "origin is reachable"
else
  warn "origin not reachable - 'git pull' later will fail, but the current checkout can still deploy"
fi

# ── Deploy ──────────────────────────────────────────────────────────────────
printf '\n== deploy ==\n'
[[ -f "${APP_DIR}/deploy/deploy.sh" ]] || die "deploy/deploy.sh missing from the checkout"
if [[ -z "${DOMAIN}" ]]; then
  die "DOMAIN is not set. Pass the hostname Caddy should serve, e.g.
       DOMAIN=trips.mydomain.com bash $0
     Without it the Caddy template's 'trips.example.com' placeholder is used,
     which will not resolve and the Let's Encrypt challenge will fail."
fi
cd "${APP_DIR}"
# Export so deploy.sh sees it and substitutes it into the Caddy template.
export DOMAIN
bash deploy/deploy.sh

# ── Next step ───────────────────────────────────────────────────────────────
cat <<EOF

${G}Deploy script finished.${N}

Check it is alive:
  systemctl status trip-packer --no-pager
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4100/api/state   # expect 401
  curl -s -o /dev/null -w '%{http_code}\n' https://trips.example.com/api/state

Create your login (run as root, from ${APP_DIR}):
  cd ${APP_DIR}
  EMAIL="you@example.com"
  node scripts/create-account.cjs --email "\$EMAIL" --name "You"

That prompts for a password with echo off. The first account becomes owner.

EOF
