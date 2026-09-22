#!/usr/bin/env bash
#
# diagnose-account.sh — work out why `create-account` fails on the VPS.
#
# Read-only. Touches nothing, creates no account, writes no file. Run as root
# from the repo root:
#
#   cd /opt/trip-packer && bash deploy/diagnose-account.sh
#
# The create-account CLI is a plain Node script that loads TypeScript sources
# directly (via tests/harness.cjs) and opens the SQLite file itself. That means
# it needs three things that `sudo -u trip-packer` can each take away: a
# PATH that includes node, read access to the repo, and write access to data/.

set -uo pipefail

APP_DIR="/opt/trip-packer"
SERVICE_USER="trip-packer"
DB_PATH="${APP_DIR}/data/trip-packer.db"

printf '\n== who am I ==\n'
id

printf '\n== node/npm as root ==\n'
printf '  node: %s\n' "$(command -v node || echo 'NOT FOUND')"
printf '  npm:  %s\n' "$(command -v npm || echo 'NOT FOUND')"
printf '  ver:  %s\n' "$(node -v 2>/dev/null || echo 'n/a')"

printf '\n== node/npm as %s (this is what sudo -u strips) ==\n' "${SERVICE_USER}"
# `sudo -u` resets PATH to a minimal one, so npm installed under a version
# manager or in /usr/local/bin can vanish here while working fine as root.
sudo -u "${SERVICE_USER}" bash -lc 'printf "  node: %s\n  npm:  %s\n  PATH: %s\n  HOME: %s\n" "$(command -v node || echo NOT\ FOUND)" "$(command -v npm || echo NOT\ FOUND)" "$PATH" "$HOME"' 2>&1

printf '\n== can %s read the repo? ==\n' "${SERVICE_USER}"
for p in "${APP_DIR}" "${APP_DIR}/scripts/create-account.cjs" "${APP_DIR}/tests/harness.cjs" "${APP_DIR}/src/lib/db.ts" "${APP_DIR}/node_modules"; do
  if sudo -u "${SERVICE_USER}" test -r "$p" 2>/dev/null; then
    printf '  ok    %s\n' "$p"
  else
    printf '  DENIED %s\n' "$p"
  fi
done

printf '\n== can %s write data/ (the CLI inserts a row) ==\n' "${SERVICE_USER}"
sudo -u "${SERVICE_USER}" test -w "${APP_DIR}/data" 2>/dev/null \
  && printf '  writable: %s\n' "${APP_DIR}/data" \
  || printf '  NOT WRITABLE: %s\n' "${APP_DIR}/data"

printf '\n== ownership ==\n'
stat -c '  %U:%G %a %n' "${APP_DIR}" "${APP_DIR}/data" "${APP_DIR}/scripts" 2>/dev/null
[ -f "${DB_PATH}" ] && stat -c '  %U:%G %a %n' "${DB_PATH}" || printf '  (no database yet at %s)\n' "${DB_PATH}"

printf '\n== the actual failure, reproduced ==\n'
echo '  --- as root ---'
( cd "${APP_DIR}" && node scripts/create-account.cjs --help >/dev/null 2>&1 \
    && echo '  --help works' || echo '  --help FAILED (run without 2>&1 to see why)' )
echo "  --- as ${SERVICE_USER} ---"
sudo -u "${SERVICE_USER}" bash -lc "cd ${APP_DIR} && npm run create-account -- --help" 2>&1 | tail -12

printf '\n== likely fixes ==\n'
cat <<'EOF'
  "npm: command not found"            -> use the absolute node path instead:
      sudo -u trip-packer /usr/bin/node scripts/create-account.cjs --email ... --name ...
      (find it with: command -v node)

  "EACCES" on the repo, or DENIED above -> the checkout is root-owned. Either
      chown -R trip-packer:trip-packer /opt/trip-packer
    or run the CLI as root with TRIP_PACKER_DB pointing at the real DB. Running
    as root is what deploy.sh already does for the service's files, and the DB
    is opened by path, so ownership of the row does not matter for correctness.

  "attempt to write a readonly database" -> the data/ dir is not writable by the
    user you ran as. Same chown as above.

  "no such table: users" -> you are pointed at a different database than the
    service uses. Check TRIP_PACKER_DB and compare with the service:
      systemctl show trip-packer -p Environment
EOF
printf '\n'
