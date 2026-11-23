#!/usr/bin/env bash
# Proves the load balancing (DESIGN.md §14.5, docs/PRODUCTION-STACK.md §6): requests through
# Caddy keep succeeding while api-1 is stopped and started, and while each replica is replaced
# in turn. Exits 1 if a single request failed.
#
#   npm run stack:failover                                             (laptop, stack running)
#   URL=https://<host>/api/v1/projects bash deploy/failover-test.sh    (on the server)
set -euo pipefail

URL="${URL:-https://localhost/api/v1/projects}"
INSECURE=()
case "$URL" in https://localhost*) INSECURE=(--insecure) ;; esac # Caddy's local certificate

compose() { docker compose -f "$(dirname "$0")/compose.prod.yml" "$@"; }
step() { printf '\n▶ %s\n' "$1"; }

# Start (or replace) a replica and wait until Caddy uses it: Caddy sees it only at its next
# 5 s check, and taking the other down before that would leave none.
start_replica() {
  compose up -d --no-deps --wait "$@"
  echo "  healthy; waiting 6 s for Caddy's next health check to see it"
  sleep 6
}

results="$(mktemp)"
stop_file="$(mktemp -u)"
trap 'touch "$stop_file"; rm -f "$results"' EXIT

# In the background: a request every 50 ms, logging its status (000 = no answer) and time.
(
  while [ ! -e "$stop_file" ]; do
    curl --silent "${INSECURE[@]}" --output /dev/null --max-time 10 \
      --write-out '%{http_code} %{time_total}\n' "$URL" >>"$results" || true
    sleep 0.05
  done
) &
loop=$!

step "Sending requests to $URL"
sleep 3

step "Stopping api-1 (SIGTERM: it finishes its requests, then exits)"
compose stop api-1
step "api-2 alone for 10 s (Caddy's health check notices api-1 within 5 s)"
sleep 10
step "Starting api-1 again"
start_replica api-1

step "Rolling update: replacing api-1 with a new container"
start_replica --force-recreate api-1
step "Rolling update: replacing api-2 with a new container"
start_replica --force-recreate api-2

touch "$stop_file"
wait "$loop"

total=$(wc -l <"$results")
ok=$(grep -c '^200 ' "$results" || true)
failed=$((total - ok))
slowest=$(sort -k2 -n "$results" | tail -1 | cut -d' ' -f2)
printf '\nRequests: %d, succeeded: %d, failed: %d, slowest: %s s\n' "$total" "$ok" "$failed" "$slowest"
if [ "$failed" -gt 0 ]; then
  echo 'Status codes seen (count, code):'
  cut -d' ' -f1 "$results" | sort | uniq -c
  exit 1
fi
echo 'No request failed.'
