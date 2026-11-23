#!/usr/bin/env bash
# Checks the monitoring configuration with the images' own tools (DESIGN.md §15.2–15.4), so a
# mistake fails CI instead of the monitoring: both Prometheus files, the alert rules' unit tests
# (alerts.test.yml), both Alertmanager files and Grafana's dashboards. Needs Docker and Node.
#
#   npm run monitoring:check
set -Eeuo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

# One version everywhere: the production stack's, which development must match.
image_of() { sed -n "s/^ *image: *\(prom\/$1:[^ ]*\) *$/\1/p" "$2" | head -n 1; }
image="$(image_of prometheus "$ROOT/deploy/compose.prod.yml")"
dev_image="$(image_of prometheus "$ROOT/docker-compose.yml")"
alertmanager_image="$(image_of alertmanager "$ROOT/deploy/compose.prod.yml")"
if [ -z "$image" ] || [ -z "$alertmanager_image" ]; then
  echo "FAILED: no prom/prometheus or prom/alertmanager image in deploy/compose.prod.yml" >&2
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
promtool test rules /etc/prometheus/alerts.test.yml

docker run --rm -v "$ROOT/deploy/alertmanager:/etc/alertmanager:ro" --entrypoint amtool \
  "$alertmanager_image" check-config /etc/alertmanager/discord.yml /etc/alertmanager/log.yml

# Grafana's dashboards: valid JSON (an edit by hand easily breaks it), each with a uid, and every
# query aimed at the provisioned data source (grafana/provisioning/datasources/prometheus.yml).
node -e '
const fs = require("fs");
for (const file of process.argv.slice(1)) {
  const dashboard = JSON.parse(fs.readFileSync(file, "utf8"));
  const panels = dashboard.panels.flatMap((panel) => [panel, ...(panel.panels ?? [])]);
  // The panel itself, and each query in it.
  const wrong = panels
    .filter((panel) => panel.targets)
    .flatMap((panel) => [panel, ...panel.targets].map((item) => [panel.title, item]))
    .filter(([, item]) => item.datasource?.uid !== "prometheus");
  if (!dashboard.uid || wrong.length > 0) {
    console.error(`FAILED: ${file}: ${dashboard.uid ? "" : "no uid; "}` +
      wrong.map(([title]) => `"${title}" queries another data source`).join("; "));
    process.exit(1);
  }
  console.log(`Checking ${file}  SUCCESS (${panels.length} panels)`);
}' "$ROOT"/deploy/grafana/dashboards/*.json
