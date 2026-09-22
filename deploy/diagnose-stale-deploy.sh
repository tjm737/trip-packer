#!/usr/bin/env bash
# Read-only diagnostic: why is production still serving the old build?
#
# Run on the VPS as root. Changes nothing.
#
#   bash diagnose-stale-deploy.sh
#
# The symptom this explains: after `git pull && deploy.sh`, https://<domain>/
# still serves the old build. /  returns x-nextjs-prerender: 1 with a year-long
# s-maxage, and /login 404s -- but a local build shows both as dynamic (ƒ), not
# static (○). Serving a prerender for a route that is no longer prerenderable
# means the running process is backed by a .next directory from BEFORE the pull,
# or by a process that was never restarted.

set -uo pipefail

APP_DIR=/opt/trip-packer
PORT=4100
DOMAIN="${DOMAIN:-trips.planetracker.app}"

hdr() { printf '\n=== %s ===\n' "$1"; }
info() { printf '  %s\n' "$1"; }

hdr "1. Checkout: what commit is actually on disk?"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" log --oneline -3
  info "HEAD: $(git -C "${APP_DIR}" rev-parse HEAD)"
  info "Want: 6e7a35c (feat: profile page, sign-out, landing hero photo, ...)"
else
  info "NOT A GIT CHECKOUT: ${APP_DIR}/.git is missing."
  info "deploy.sh builds from the checkout, so without .git the pull cannot land."
fi

hdr "2. Does the build on disk contain the new work?"
# The new build has these; the old build has none of them.
for f in "src/components/AppShell.tsx" "src/app/(app)/profile/page.tsx" "public/hero/hero-desktop.jpg"; do
  if [[ -e "${APP_DIR}/${f}" ]]; then info "present : ${f}"; else info "MISSING : ${f}"; fi
done
if grep -q "webkit-autofill" "${APP_DIR}/src/app/globals.css" 2>/dev/null; then
  info "present : autofill override in globals.css"
else
  info "MISSING : autofill override in globals.css"
fi

hdr "3. Build artifacts: how old is .next/ ?"
if [[ -d "${APP_DIR}/.next" ]]; then
  # BUILD_ID is written fresh by each successful `next build`.
  if [[ -f "${APP_DIR}/.next/BUILD_ID" ]]; then
    info "BUILD_ID:   $(cat "${APP_DIR}/.next/BUILD_ID")"
  else
    info "no .next/BUILD_ID -- build never completed"
  fi
  info "mtime:      $(date -r "${APP_DIR}/.next" '+%Y-%m-%d %H:%M:%S')  (now: $(date '+%Y-%m-%d %H:%M:%S'))"
  info "server dir: $( [[ -d ${APP_DIR}/.next/server ]] && echo yes || echo NO )"
  # A prerendered / is the fingerprint of the OLD build.
  if [[ -f "${APP_DIR}/.next/server/app/index.html" ]]; then
    info "FOUND .next/server/app/index.html -- '/' is prerendered: OLD build."
  else
    info "no prerendered index.html for '/' -- consistent with a NEW build."
  fi
else
  info ".next MISSING -- nothing has been built here."
fi

hdr "4. Service: is the running process older than the build?"
systemctl status trip-packer --no-pager 2>/dev/null | head -12
info ""
info "ActiveEnterTimestamp (when the process last started):"
systemctl show trip-packer -p ActiveEnterTimestamp 2>/dev/null
info "ExecMainPID:"
systemctl show trip-packer -p ExecMainPID 2>/dev/null

hdr "5. Which process holds :${PORT}, and how old is it?"
# A stale next-server outliving a shell wrapper is the classic cause: the
# wrapper dies on restart but the child keeps the port, so the new code never
# serves. Compare this start time against the .next mtime above.
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null | sed 's/^/  /'
else
  info "lsof not installed; trying ss"
  ss -ltnp 2>/dev/null | grep ":${PORT}" | sed 's/^/  /'
fi
for p in $(pgrep -f "next-server|next start" 2>/dev/null); do
  info "pid ${p} started: $(ps -o lstart= -p "${p}" 2>/dev/null)"
  info "  cmd: $(ps -o args= -p "${p}" 2>/dev/null | cut -c1-110)"
done

hdr "6. What is the app answering on localhost (bypasses nginx)?"
# If localhost shows the OLD build too, nginx is innocent and the process is stale.
for path in "/" "/login" "/api/state"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${PORT}${path}" 2>/dev/null)
  info "127.0.0.1:${PORT}${path} -> ${code}"
done
info ""
info "Does localhost '/' contain the new landing hero?"
if curl -s --max-time 10 "http://127.0.0.1:${PORT}/" 2>/dev/null | grep -q "actually going to take"; then
  info "  YES -- new build is serving on localhost. nginx or its cache is the problem."
else
  info "  NO  -- localhost serves the old build too. The process/.next is stale."
fi

hdr "7. What is nginx actually proxying to?"
NGINXFILE="/etc/nginx/sites-available/trip-packer"
if [[ -f "${NGINXFILE}" ]]; then
  grep -nE "proxy_pass|server_name|root|alias" "${NGINXFILE}" | sed 's/^/  /'
else
  info "${NGINXFILE} not found"
fi

hdr "8. nginx error log (last 20 lines)"
if [[ -f /var/log/nginx/error.log ]]; then
  tail -20 /var/log/nginx/error.log | sed 's/^/  /'
else
  info "/var/log/nginx/error.log not found"
fi

hdr "SUMMARY -- read top to bottom"
cat <<'EOS'
  If (1) HEAD is 6e7a35c and (2) files are present but (3) shows a prerendered
  index.html or an old BUILD_ID, the build did not re-run or did not complete.

  If (3) looks right but (4)/(5) show a start time older than the build, the
  service was not restarted -- or a stale next-server kept the port so the
  restart silently did nothing. That is the case the deploy script's own
  port-ownership check is meant to catch.

  If (6) shows the NEW build on localhost but the public domain serves the old
  one, the problem is in nginx or its cache, not in the app.
EOS
