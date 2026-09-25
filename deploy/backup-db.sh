#!/usr/bin/env bash
#
# Hourly database backup for trip-packer.
#
# Design notes, because several choices here are deliberate and non-obvious:
#
#   - `sqlite3 .backup` is used rather than `cp`. The database runs in WAL mode,
#     so the live file is not a complete snapshot: recent commits may live only
#     in trip-packer.db-wal. Copying the .db alone silently loses them. This is
#     the same reasoning deploy/deploy.sh already applies before a deploy.
#
#   - The service is NOT stopped. deploy.sh stops it because it is about to
#     replace the binary and wants a frozen target; here the opposite is true --
#     interrupting writes every hour to take a backup would be a self-inflicted
#     outage. The SQLite backup API is safe against a live writer and takes a
#     consistent snapshot without blocking it.
#
#   - The copy is verified by QUERYING it, not by checking that the file exists.
#     A truncated or empty file passes `test -s` in some cases and always passes
#     `integrity_check` is not implied by a nonzero size, so the row counts are
#     the real test. If those queries fail the backup is discarded rather than
#     left in the directory looking like a good one.
#
#   - Retention is by AGE (30 days), not by count. An hourly count-based rule
#     would either be a huge number that outlives its usefulness or a small one
#     that silently keeps only days, which is the failure mode you notice during
#     a restore rather than before it.
#
# Runs as the service user, from cron. Exits non-zero on any failure so cron
# mails the error rather than the failure passing unnoticed.
#
set -euo pipefail

APP_NAME="trip-packer"
APP_DIR="/opt/${APP_NAME}"
DB_PATH="${TRIP_PACKER_DB:-${APP_DIR}/data/trip-packer.db}"
BACKUP_DIR="/var/backups/${APP_NAME}"
RETENTION_DAYS=30

info() { printf '==> %s\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }
die()  { printf '  ✗ %s\n' "$1" >&2; exit 1; }

# ── Preconditions ───────────────────────────────────────────────────────────
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 not installed."
[[ -f "${DB_PATH}" ]] || die "No database at ${DB_PATH} (set TRIP_PACKER_DB to override)."

mkdir -p "${BACKUP_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/${APP_NAME}-${STAMP}.db"
TMP="${DEST}.partial"

# ── Snapshot ────────────────────────────────────────────────────────────────
# Two kinds of debris to clear first:
#
#   - A run killed mid-copy leaves a .partial behind. It is never a valid
#     backup, so remove stragglers rather than letting them accumulate.
#   - `sqlite3 .backup` opens the destination in WAL mode and creates -shm and
#     -wal sidecars beside it. Those are named after the TEMP path, so they
#     survive the rename to the final name and would otherwise pile up in the
#     backup directory forever -- one -shm/-wal pair per run, for 30 days.
find "${BACKUP_DIR}" -maxdepth 1 \( -name '*.partial' -o -name '*.partial-shm' -o -name '*.partial-wal' \) \
  -mmin +60 -delete 2>/dev/null || true
# Sidecars for a backup that already completed are dead weight: the .db it was
# renamed to is self-contained, and a stale -wal beside it is actively
# misleading (it looks like the copy has uncheckpointed state when it does not).
find "${BACKUP_DIR}" -maxdepth 1 \( -name "${APP_NAME}-*.db-shm" -o -name "${APP_NAME}-*.db-wal" \) \
  -delete 2>/dev/null || true

# A second run inside the same second would otherwise overwrite the first
# backup. Hourly cron never does this, but a manual re-run or a double-fired
# timer does, and silently destroying the copy you just took is the worst
# possible failure for a backup tool. Suffix until the name is free.
if [[ -e "${DEST}" ]]; then
  N=2
  while [[ -e "${BACKUP_DIR}/${APP_NAME}-${STAMP}-${N}.db" ]]; do
    N=$((N + 1))
  done
  DEST="${BACKUP_DIR}/${APP_NAME}-${STAMP}-${N}.db"
  TMP="${DEST}.partial"
fi

info "Backing up ${DB_PATH} (WAL-safe, live)"
if ! sqlite3 "${DB_PATH}" ".backup '${TMP}'"; then
  rm -f "${TMP}" "${TMP}-shm" "${TMP}-wal"
  die "sqlite3 .backup failed. Live database left untouched."
fi

# ── Verify by querying the copy ─────────────────────────────────────────────
USERS="$(sqlite3 "${TMP}" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")"
TRIPS="$(sqlite3 "${TMP}" "SELECT COUNT(*) FROM trips;" 2>/dev/null || echo "?")"
ITEMS="$(sqlite3 "${TMP}" "SELECT COUNT(*) FROM items;" 2>/dev/null || echo "?")"

if [[ "${USERS}" == "?" || "${TRIPS}" == "?" || "${ITEMS}" == "?" ]]; then
  rm -f "${TMP}" "${TMP}-shm" "${TMP}-wal"
  die "Backup copy is not a readable database. Discarded; live database untouched."
fi

# An integrity check catches page-level corruption that the row counts above
# would not (a corrupted table can still count if the count page survived).
if ! sqlite3 "${TMP}" "PRAGMA integrity_check;" 2>/dev/null | head -1 | grep -q '^ok$'; then
  rm -f "${TMP}" "${TMP}-shm" "${TMP}-wal"
  die "Backup copy failed integrity_check. Discarded; live database untouched."
fi

# Only now does it earn the real name. The sidecars are removed rather than
# renamed: the .db is a self-contained snapshot, and leaving a -wal beside it
# invites someone to "restore" a pair that does not need to travel together.
mv "${TMP}" "${DEST}"
rm -f "${TMP}-shm" "${TMP}-wal"
chmod 600 "${DEST}"
ok "Verified: ${USERS} user(s), ${TRIPS} trip(s), ${ITEMS} item(s) -> ${DEST}"

# ── Retention: 30 days by mtime ─────────────────────────────────────────────
DELETED="$(find "${BACKUP_DIR}" -maxdepth 1 -name "${APP_NAME}-*.db" -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null | wc -l | tr -d ' ')"
KEPT="$(find "${BACKUP_DIR}" -maxdepth 1 -name "${APP_NAME}-*.db" | wc -l | tr -d ' ')"
TOTAL="$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)"

ok "Retention: removed ${DELETED} older than ${RETENTION_DAYS}d, kept ${KEPT} (${TOTAL})"
