#!/usr/bin/env bash
# Restores the database from a backup (DESIGN.md §14.6). Guide: docs/BACKUPS.md
#
#   bash deploy/restore.sh ~/backups/portfolio/portfolio-2026-11-22-1800Z.dump [--yes]
#
#   1. check the file against its .sha256 checksum (when the checksum file is next to it)
#   2. load it into a new database, portfolio_restoring, while the site keeps running
#   3. stop api-1, api-2 and the worker: the only programs that use the database
#   4. swap, in one transaction: the current database becomes <name>_before_restore_<time>,
#      the restored one takes its name. Nothing is deleted: the old one is your way back.
#   5. apply newer migrations (an older backup has an older schema), clear the cached content,
#      start the three services again
#
# Everything written after the backup was taken (visits, contact messages) is then only in the
# renamed old database. The site's pages are down for the few seconds of steps 3–5.
set -Eeuo pipefail

file="${1:?usage: bash deploy/restore.sh <backup.dump> [--yes]}"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
STAGING_DB=portfolio_restoring

compose() { docker compose -f "$DEPLOY_DIR/compose.prod.yml" "$@"; }
# `docker compose exec` reads this script's input unless told otherwise, which would swallow
# whatever the input holds (in restore.sh: your answer to its question). So only
# `in_postgres_reading` passes it on, for pg_restore reading a backup file.
in_postgres() { in_postgres_reading "$1" </dev/null; }
in_postgres_reading() { compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres sh -c "$1"; }
# Logs go to a copy of the script's own output (fd 3): a failure inside a step whose output is
# redirected would otherwise lose them (see backup.sh).
exec 3>&1
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&3; }

stopped=false
on_failure() {
  local status=$?
  log "FAILED (exit code $status)."
  if [ "$stopped" = true ]; then
    log "Starting the services again. Nothing was deleted: list the databases with"
    log "  docker compose -f deploy/compose.prod.yml exec postgres psql -U <POSTGRES_USER> -l"
    log "and see docs/BACKUPS.md §5 (when a restore fails)."
    compose up -d --no-deps api-1 api-2 worker || true
  fi
  in_postgres "dropdb -U \"\$POSTGRES_USER\" --if-exists $STAGING_DB" >/dev/null 2>&1 || true
  exit "$status"
}
trap on_failure ERR

[ -f "$file" ] || {
  echo "No such file: $file" >&2
  exit 1
}
if [ -f "$file.sha256" ]; then
  if ! (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256"); then
    log "The file does not match its checksum: it is damaged. Nothing was changed."
    exit 1
  fi
  log "checksum OK"
else
  log "no $(basename "$file").sha256 next to it: skipping the checksum"
fi

db="$(in_postgres 'printf %s "$POSTGRES_DB"')"
old_db="${db}_before_restore_$(date -u +%Y%m%d_%H%M)"
if [ "${2:-}" != --yes ]; then
  echo "This replaces the database \"$db\" with $(basename "$file")."
  echo "The current one is kept as \"$old_db\"; data written since the backup stays only there."
  read -r -p 'Type "restore" to go ahead: ' answer || answer="" # no input: not a yes
  [ "$answer" = restore ] || {
    echo 'Cancelled: nothing changed.'
    exit 1
  }
fi

log "loading the backup into $STAGING_DB (the site keeps running)"
in_postgres "dropdb -U \"\$POSTGRES_USER\" --if-exists $STAGING_DB && createdb -U \"\$POSTGRES_USER\" $STAGING_DB"
in_postgres_reading "pg_restore -U \"\$POSTGRES_USER\" -d $STAGING_DB --no-owner --exit-on-error" <"$file"

log "stopping api-1, api-2 and the worker"
stopped=true
compose stop api-1 api-2 worker

log "swapping: $db → $old_db, $STAGING_DB → $db"
# -1: one transaction, so either both renames happen or neither does. A database cannot be
# renamed while anything is connected to it; the services are stopped, this ends the rest.
in_postgres "psql -U \"\$POSTGRES_USER\" -d postgres -v ON_ERROR_STOP=1 -q -1 \
  -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid()\" \
  -c 'ALTER DATABASE \"$db\" RENAME TO \"$old_db\"' \
  -c 'ALTER DATABASE $STAGING_DB RENAME TO \"$db\"'" >/dev/null

log "applying newer migrations, if any"
compose run --rm --no-deps migrate
log "clearing the cached content (it may be newer than the backup)"
compose exec -T redis sh -c "redis-cli --scan --pattern 'cache:*' | xargs -r redis-cli del >/dev/null"

log "starting api-1, api-2 and the worker"
compose up -d --no-deps --wait api-1 api-2 worker
stopped=false

counts="$(in_postgres "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' ' -c 'SELECT
    (SELECT count(*) FROM analytics_events), (SELECT count(*) FROM contact_messages)'")"
read -r events messages <<<"$counts"
log "restored: $events events, $messages contact messages."
log "The previous database is kept as \"$old_db\". It holds the visits and messages that"
log "arrived after the backup: docs/BACKUPS.md §4 copies them back. Once you are sure you"
log "don't need it any more:"
log "  docker compose -f deploy/compose.prod.yml exec postgres dropdb -U <POSTGRES_USER> $old_db"
