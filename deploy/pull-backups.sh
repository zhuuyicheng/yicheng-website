#!/usr/bin/env bash
# Copies new backups from the server to this computer (DESIGN.md §14.6, docs/BACKUPS.md §3.4).
# Run it on the desktop, in WSL.
#
#   bash deploy/pull-backups.sh
#
#   SOURCE  default `portfolio-backups:`, an SSH alias whose key may only read the backups
#   DEST    default ~/portfolio-backups (a link to a Windows folder)
#
# Never overwrites or deletes a copy, so the server can't touch what's already here.
# Exit codes: 0 fine, 1 copy failed, 2 checksum mismatch, 3 newest backup over 8 days old.
set -Eeuo pipefail
umask 077

SOURCE="${SOURCE:-portfolio-backups:}"
DEST="${DEST:-$HOME/portfolio-backups}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-8}"

mkdir -p "$DEST"
# Shown, and appended to pull.log.
exec > >(tee -a "$DEST/pull.log") 2>&1
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
trap 'log "FAILED: the copy did not finish (exit code $?)"' ERR

log "copying new backups from $SOURCE to $DEST"
# --ignore-existing: never overwrite a copy. No --delete: never remove one.
rsync --archive --ignore-existing --itemize-changes \
  --include='portfolio-*.dump' --include='portfolio-*.dump.sha256' --exclude='*' \
  "$SOURCE" "$DEST/"
trap - ERR

if ! (cd "$DEST" && sha256sum --check --quiet portfolio-*.dump.sha256); then
  log "PROBLEM: a backup does not match its checksum (listed above): it is damaged"
  exit 2
fi

# -H: DEST is usually a link (to a Windows folder), and find doesn't look inside a link it's
# given unless told to.
newest="$(find -H "$DEST" -maxdepth 1 -name 'portfolio-*.dump' | sort | tail -n 1)"
if [ -z "$newest" ] || [ -z "$(find "$newest" -mtime -"$MAX_AGE_DAYS")" ]; then
  log "PROBLEM: no backup newer than $MAX_AGE_DAYS days. Is the server's weekly job running?"
  exit 3
fi
log "OK: $(find -H "$DEST" -maxdepth 1 -name 'portfolio-*.dump' | wc -l) backups here, newest $(basename "$newest")"
