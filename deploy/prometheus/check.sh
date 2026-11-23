#!/usr/bin/env bash
# Checks the Prometheus configuration with the image's own promtool (DESIGN.md §15.2), so a
# mistake fails CI instead of the monitoring. Needs Docker.
#
#   npm run monitoring:check
set -Eeuo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

# One version everywhere: the production stack's, which development must match.
prometheus_image() { sed -n 's/^ *image: *\(prom\/prometheus:[^ ]*\) *$/\1/p' "$1"; }
image="$(prometheus_image "$ROOT/deploy/compose.prod.yml")"
dev_image="$(prometheus_image "$ROOT/docker-compose.yml")"
if [ -z "$image" ]; then
  echo "FAILED: no prom/prometheus image in deploy/compose.prod.yml" >&2
  exit 1
fi
if [ "$image" != "$dev_image" ]; then
  echo "FAILED: docker-compose.yml runs ${dev_image:-no Prometheus}, deploy/compose.prod.yml $image: use one version" >&2
  exit 1
fi

# promtool insists that the token file exists. The real one is a Compose secret (compose.prod.yml).
token="$(mktemp)"
trap 'rm -f "$token"' EXIT
echo placeholder-token >"$token"
chmod 644 "$token" # promtool runs as nobody

promtool() {
  docker run --rm -v "$DIR:/etc/prometheus:ro" -v "$token:/run/secrets/metrics_token:ro" \
    --entrypoint promtool "$image" "$@"
}

promtool check config /etc/prometheus/prometheus.yml /etc/prometheus/prometheus.dev.yml
