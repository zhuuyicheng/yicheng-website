#!/usr/bin/env bash
# Weekly database backup (DESIGN.md §14.6). Runs on the server from cron; also works on your
# laptop against the local production stack. Guide: docs/BACKUPS.md
#
#   1. pg_dump the database to $BACKUP_DIR/portfolio-<UTC time>.dump, plus a .sha256 checksum
#   2. prove it restores: load it into a scratch database, count the rows, drop the scratch one
#   3. keep the newest $KEEP backups, delete older ones (your desktop keeps its own copies)
#   4. tell you on Discord, success or failure (when deploy/.env has NOTIFIER_DRIVER=discord)
#
#   bash deploy/backup.sh          defaults: BACKUP_DIR=~/backups/portfolio KEEP=4
set -Eeuo pipefail
umask 077 # backups hold personal data (IP addresses, contact messages): owner-only files

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/portfolio}"
KEEP="${KEEP:-4}"
CHECK_DB=portfolio_restore_check

compose() { docker compose -f "$DEPLOY_DIR/compose.prod.yml" "$@"; }
# Runs a shell command inside the Postgres container, where $POSTGRES_USER and $POSTGRES_DB
# are set (single quotes in the callers keep the host's shell from expanding them).
# PGOPTIONS hides Postgres's notices ("does not exist, skipping"); warnings and errors remain.
# `docker compose exec` reads this script's input unless told otherwise, which would swallow
# whatever the input holds (in restore.sh: your answer to its question). So only
# `in_postgres_reading` passes it on, for pg_restore reading a backup file.
in_postgres() { in_postgres_reading "$1" </dev/null; }
in_postgres_reading() { compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres sh -c "$1"; }
# Logs go to file descriptor 3, a copy of the script's own output made below. A failure while
# pg_dump writes to the backup file runs on_failure with its output still going into that
# file; writing to 3 keeps the "FAILED" line visible.
exec 3>&1
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&3; }
# One value from deploy/.env. Read as data, not `source`d: the file is not a script.
setting() { sed -n "s/^$1=//p" "$DEPLOY_DIR/.env" 2>/dev/null | tail -n 1; }

notify() {
  local message="$1" webhook
  webhook="$(setting DISCORD_WEBHOOK_URL)"
  if [ "$(setting NOTIFIER_DRIVER)" != discord ] || [ -z "$webhook" ]; then
    log "(not sent: Discord is not configured in deploy/.env) $message"
    return
  fi
  # The message never contains quotes or backslashes, so it is valid JSON as it is.
  curl --silent --show-error --fail --max-time 10 -H 'content-type: application/json' \
    --data "{\"content\": \"$message\"}" "$webhook" >/dev/null ||
    log "could not send the Discord message: $message"
}

step="starting"
partial=""
on_failure() {
  local status=$?
  [ -n "$partial" ] && rm -f "$partial"
  in_postgres "dropdb -U \"\$POSTGRES_USER\" --if-exists $CHECK_DB" >/dev/null 2>&1 || true
  log "FAILED while $step (exit code $status)"
  notify "Portfolio backup FAILED while $step (exit code $status) on $(hostname). Run deploy/backup.sh by hand to see why."
  exit "$status"
}
trap on_failure ERR

mkdir -p "$BACKUP_DIR"
name="portfolio-$(date -u +%Y-%m-%d-%H%MZ).dump"
partial="$BACKUP_DIR/.$name.partial" # renamed only once complete and test-restored

step="dumping the database"
log "$step to $BACKUP_DIR/$name"
# --format=custom: compressed, and pg_restore can restore all of it or single tables.
in_postgres 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$partial"

step="test-restoring the backup"
log "$step into the scratch database $CHECK_DB"
in_postgres "dropdb -U \"\$POSTGRES_USER\" --if-exists $CHECK_DB && createdb -U \"\$POSTGRES_USER\" $CHECK_DB"
in_postgres_reading "pg_restore -U \"\$POSTGRES_USER\" -d $CHECK_DB --no-owner --exit-on-error" <"$partial"
counts="$(in_postgres "psql -U \"\$POSTGRES_USER\" -d $CHECK_DB -At -F ' ' -c 'SELECT
    (SELECT count(*) FROM analytics_events), (SELECT count(*) FROM contact_messages),
    (SELECT count(*) FROM projects), (SELECT count(*) FROM schema_migrations)'")"
in_postgres "dropdb -U \"\$POSTGRES_USER\" $CHECK_DB"
read -r events messages projects migrations <<<"$counts"
log "restored fine: $events events, $messages contact messages, $projects projects, $migrations migrations"

step="saving the backup"
mv "$partial" "$BACKUP_DIR/$name"
partial=""
(cd "$BACKUP_DIR" && sha256sum "$name" >"$name.sha256")
size="$(du -h "$BACKUP_DIR/$name" | cut -f1)"

step="removing old backups"
# File names sort by date, so all but the newest $KEEP are the oldest.
find "$BACKUP_DIR" -maxdepth 1 -name 'portfolio-*.dump' | sort | head -n -"$KEEP" |
  while read -r old; do
    rm -f "$old" "$old.sha256"
    log "removed $(basename "$old")"
  done

log "done: $name ($size)"
notify "Portfolio backup OK: $name ($size), test restore found $events events and $messages contact messages. Copy it home whenever you like: deploy/pull-backups.sh on your desktop."
