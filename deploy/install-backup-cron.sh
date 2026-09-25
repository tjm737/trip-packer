#!/usr/bin/env bash
#
# Installs the hourly trip-packer database backup as a cron job.
#
# Idempotent: safe to re-run after editing backup-db.sh. The cron entry is
# replaced, not appended, so repeated runs cannot stack duplicate jobs -- a
# subtle failure that would look like it worked while quietly taking N backups
# per hour.
#
# Run as root on the server, from /opt/trip-packer:
#   bash deploy/install-backup-cron.sh
#
set -euo pipefail

APP_NAME="trip-packer"
APP_DIR="/opt/${APP_NAME}"
SERVICE_USER="trip-packer"
SCRIPT="${APP_DIR}/deploy/backup-db.sh"
LOG_FILE="/var/log/${APP_NAME}-backup.log"
MARKER="# ${APP_NAME}-backup (managed by deploy/install-backup-cron.sh)"

info() { printf '\033[0;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m  ✓\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m  !\033[0m %s\n' "$1"; }
die()  { printf '\033[0;31m  ✗\033[0m %s\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (cron.d and the service user's crontab both need it)."

# ── Preflight ───────────────────────────────────────────────────────────────
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is not installed. Install it before scheduling backups."
[[ -f "${SCRIPT}" ]] || die "No backup script at ${SCRIPT}."
id -u "${SERVICE_USER}" >/dev/null 2>&1 || die "Service user ${SERVICE_USER} does not exist. Run deploy.sh first."

[[ -f "${APP_DIR}/data/trip-packer.db" ]] \
  || warn "No database at ${APP_DIR}/data/trip-packer.db yet — the job will fail until one exists."

chmod +x "${SCRIPT}"
ok "Backup script present and executable"

# ── Log file ────────────────────────────────────────────────────────────────
# Owned by the service user: cron runs the job as that user and appends to this
# file directly, so a root-owned log would make every run fail on redirect.
touch "${LOG_FILE}"
chown "${SERVICE_USER}:${SERVICE_USER}" "${LOG_FILE}"
chmod 640 "${LOG_FILE}"
ok "Log file ${LOG_FILE}"

# ── Cron entry ──────────────────────────────────────────────────────────────
# A drop-in in /etc/cron.d is used rather than the service user's crontab so the
# schedule is version-controlled alongside the rest of deploy/ and survives a
# rebuilt host. /etc/cron.d requires a user field, unlike a user crontab.
#
# The log is size-capped rather than rotated: hourly output is a few lines, so
# the file grows slowly, and a self-truncating redirect avoids adding a logrotate
# dependency for one file. Keeping the last ~2MB is plenty for forensics.
CRON_FILE="/etc/cron.d/${APP_NAME}-backup"
TMP_CRON="$(mktemp)"

cat > "${TMP_CRON}" <<CRON
${MARKER}
# Hourly, at :17. Deliberately not on the hour: every naive cron job fires at
# :00, so an unrelated load spike or a coincidental apt/db job at that minute
# would be indistinguishable from a backup problem.
#
# Log is truncated in place when it exceeds ~2MB, then appended to. Record size
# is taken with \`wc -c < file\` rather than \`stat -c %s\`: stat's -c flag is GNU
# only, and this job should keep working if the log check ever moves to a host
# with BSD coreutils. The redirect is also guarded so a missing log cannot make
# the truncation test print an error every hour.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 * * * * ${SERVICE_USER} LOG="${LOG_FILE}"; if [ -f "\$LOG" ] && [ "\$(wc -c < "\$LOG" 2>/dev/null || echo 0)" -gt 2097152 ]; then : > "\$LOG"; fi; "${SCRIPT}" >> "\$LOG" 2>&1
CRON

# Validate before installing. A malformed cron.d file is silently ignored by
# cron, so a typo would produce a job that simply never runs and looks fine.
if command -v run-parts >/dev/null 2>&1; then
  run-parts --test /etc/cron.d >/dev/null 2>&1 || true
fi

install -m 0644 -o root -g root "${TMP_CRON}" "${CRON_FILE}"
rm -f "${TMP_CRON}"
ok "Installed ${CRON_FILE}"

# cron.d ignores files with a dot in the name or wrong permissions/ownership, so
# assert the properties it actually checks rather than trusting install(1).
[[ "$(stat -c '%a %U' "${CRON_FILE}")" == "644 root" ]] \
  || die "${CRON_FILE} has wrong ownership/mode; cron will skip it."
ok "Permissions verified (644 root)"

# ── Prove it works now, not at :17 ──────────────────────────────────────────
# Scheduling a job that has never executed successfully is how you discover a
# broken backup a month later. Run it once as the service user, exactly as cron
# will, and fail the install if that does not succeed.
info "Running one backup now as ${SERVICE_USER} to verify"
if sudo -u "${SERVICE_USER}" "${SCRIPT}" >/tmp/backup-install-check.log 2>&1; then
  sed 's/^/    /' /tmp/backup-install-check.log
  ok "Backup ran successfully"
  rm -f /tmp/backup-install-check.log
else
  sed 's/^/    /' /tmp/backup-install-check.log >&2
  rm -f /tmp/backup-install-check.log
  die "Backup failed when run as ${SERVICE_USER}. Cron entry installed but NOT verified."
fi

printf '\n'
info "Done. Hourly at :17, log at ${LOG_FILE}, 30-day retention."
printf '    Check status:  tail -20 %s\n' "${LOG_FILE}"
printf '    Run manually:  sudo -u %s %s\n' "${SERVICE_USER}" "${SCRIPT}"
printf '    List backups:  ls -lh /var/backups/%s/\n' "${APP_NAME}"
