#!/usr/bin/env bash
# Copies new backups from the server to this computer (DESIGN.md §14.6). Run it on your
# desktop, in WSL, whenever you want a fresh copy there. Guide: docs/BACKUPS.md §3.4
#
#   bash deploy/pull-backups.sh
#
#   SOURCE  where to copy from. Default `portfolio-backups:`, an SSH alias whose key the server
#           allows to do one thing only: read the backups folder (docs/BACKUPS.md §3).
#   DEST    where to keep them. Default ~/portfolio-backups (a link to a Windows folder, §3).
#
# Copies are never overwritten or deleted here: a backup the server deletes (it keeps 4) or a
# server that misbehaves cannot touch what this computer already has. Exit codes: 0 fine,
# 1 the copy failed, 2 a checksum did not match, 3 the newest backup is more than 8 days old.
set -Eeuo pipefail
umask 077

SOURCE="${SOURCE:-portfolio-backups:}"
DEST="${DEST:-$HOME/portfolio-backups}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-8}"

mkdir -p "$DEST"
# Everything below is shown and also appended to pull.log, to read later.
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

# -H: DEST is usually a link to a Windows folder (docs/BACKUPS.md §3.2), and find does not look
# inside a link it is given unless told to: it would find no backups at all.
newest="$(find -H "$DEST" -maxdepth 1 -name 'portfolio-*.dump' | sort | tail -n 1)"
if [ -z "$newest" ] || [ -z "$(find "$newest" -mtime -"$MAX_AGE_DAYS")" ]; then
  log "PROBLEM: no backup newer than $MAX_AGE_DAYS days. Is the server's weekly job running?"
  exit 3
fi
log "OK: $(find -H "$DEST" -maxdepth 1 -name 'portfolio-*.dump' | wc -l) backups here, newest $(basename "$newest")"
