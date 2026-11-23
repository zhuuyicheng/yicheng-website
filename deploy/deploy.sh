#!/usr/bin/env bash
# Deploys one release (DESIGN.md §14.3, docs/CD.md): the API and web images tagged <tag> (a
# commit SHA on the server). Run by the deploy workflow over SSH, by hand to go back to an
# earlier release, or on your laptop against the local production stack.
#
#   1. pull the images this machine lacks, check the Caddyfile
#   2. migrate with the new image (backward compatible, DESIGN.md §14.4), publish its content
#   3. roll out worker → api-1 → api-2 → web, each healthy before the next
#   4. smoke test each replica, the worker, and the API and home page through Caddy
#   5. if 3 or 4 fails: roll back the same way (no migrate: migrations only go forward), exit 1
#   6. on success: delete older downloaded images (this release and the previous stay)
#
#   bash ~/portfolio/deploy/deploy.sh <full commit SHA>    on the server
#   npm run stack:deploy -- dev                           laptop: locally built images
#
# Images are $IMAGE_PREFIX-api:<tag> and -web:<tag>; IMAGE_PREFIX comes from the environment,
# else the current release in deploy/.env, else `portfolio`. The release is recorded in
# deploy/.env so every other command uses it. With REGISTRY_USER set, the first input line is
# the registry password (the job's token), used for this pull only.
set -Eeuo pipefail
umask 077 # deploy/.env holds secrets: rewritten owner-only

tag="${1:?usage: bash deploy/deploy.sh <tag>   (a commit SHA, or dev on your laptop)}"
if ! [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "Not an image tag: $tag" >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"
# A replica is healthy in seconds; Docker calls a dead one unhealthy only after ~2.5 minutes.
WAIT_TIMEOUT="${WAIT_TIMEOUT:-120}"
# For `docker compose exec` (no curl in the images): exits 0 when GET <url> answers 2xx in 10 s.
node_get() {
  printf 'fetch("%s", { signal: AbortSignal.timeout(10000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "$1"
}
HEALTH_CHECK="$(node_get http://127.0.0.1:4000/health)"
# While this exists the site is paused (docs/CD.md §5). Deploys still run and leave it paused.
PAUSE_FLAG="$DEPLOY_DIR/caddy/paused"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
step() { printf '\n%s ▶ %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
compose() { docker compose -f "$DEPLOY_DIR/compose.prod.yml" "$@"; }
# One value from deploy/.env, read as data (not `source`d: it isn't a script).
setting() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

[ -f "$ENV_FILE" ] || {
  echo "Missing $ENV_FILE: create it from deploy/.env.example first (docs/CD.md §2)." >&2
  exit 1
}

registry_password=""
if [ -n "${REGISTRY_USER:-}" ]; then
  read -r registry_password || true
fi
# Nothing reads the input below; `docker compose run` and `exec` would otherwise consume it.
exec </dev/null

# Two deploys at once would replace the same containers.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/portfolio-deploy.lock"
flock --nonblock 9 || {
  echo "Another deploy is running on this machine; try again once it has finished." >&2
  exit 1
}

previous_api="$(setting API_IMAGE)"
previous_web="$(setting WEB_IMAGE)"
IMAGE_PREFIX="${IMAGE_PREFIX:-${previous_api:+${previous_api%-api:*}}}"
IMAGE_PREFIX="${IMAGE_PREFIX:-portfolio}"
new_api="$IMAGE_PREFIX-api:$tag"
new_web="$IMAGE_PREFIX-web:$tag"
SITE_HOST="$(setting SITE_HOST)"
INSECURE=()
[ "$SITE_HOST" = localhost ] && INSECURE=(--insecure) # Caddy's own certificate (laptop)

# Pulls only missing images: a tag names one commit, so one already here is right. The password
# goes to a temporary Docker config, deleted afterwards, so no registry access stays behind.
pull_images() {
  local image missing=()
  for image in "$@"; do
    docker image inspect "$image" >/dev/null 2>&1 || missing+=("$image")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    log "both images are already on this machine"
    return
  fi
  (
    if [ -n "$registry_password" ]; then
      DOCKER_CONFIG="$(mktemp -d)"
      export DOCKER_CONFIG
      trap 'rm -rf "$DOCKER_CONFIG"' EXIT
      # Output only on failure: on success it warns about storing the password, in the folder
      # deleted above.
      if ! output="$(printf '%s\n' "$registry_password" |
        docker login "${missing[0]%%/*}" --username "$REGISTRY_USER" --password-stdin 2>&1)"; then
        printf '%s\n' "$output"
        log "FAILED: could not log in to the registry. Nothing was changed."
        exit 1
      fi
    fi
    for image in "${missing[@]}"; do
      log "pulling $image"
      docker pull --quiet "$image" >/dev/null
    done
  )
}

# Writes API_IMAGE and WEB_IMAGE into deploy/.env (keeping the rest), so later commands start
# the same images.
record_release() {
  local temporary="$ENV_FILE.tmp"
  {
    grep -v -E '^(API_IMAGE|WEB_IMAGE)=' "$ENV_FILE" || true
    printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$1" "$2"
  } >"$temporary"
  mv "$temporary" "$ENV_FILE"
}

# "<status>/<health>/<restarts>", e.g. running/healthy/0. Health is `none` without a check.
container_state() {
  docker inspect --format \
    '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}/{{.RestartCount}}' \
    "$1"
}

# Restart counts when this deploy started each container (an unchanged one keeps old counts).
declare -A restarts_at_start

# Replaces a service's container if its image or settings changed, then waits until it's
# healthy (the worker, with no check: running 5 s without crashing). Not `up --wait`: Compose
# v5.0 reports success on timeout while a container is still "starting" (docs/CD.md).
replace() {
  local service="$1" container state restarts started=$SECONDS
  compose up --detach --no-deps "$service" || return 1
  container="$(compose ps --quiet "$service")"
  [ -n "$container" ] || {
    log "$service has no running container after starting it: see docker compose ps --all"
    return 1
  }
  restarts="$(docker inspect --format '{{.RestartCount}}' "$container")" || return 1
  restarts_at_start[$service]="$restarts"
  while :; do
    state="$(container_state "$container")" || return 1
    case "$state" in
      "running/healthy/$restarts") return 0 ;;
      "running/none/$restarts") [ $((SECONDS - started)) -lt 5 ] || return 0 ;;
      "running/starting/$restarts") ;;
      *) # unhealthy, exited, restarting, or restarted: it crashed
        log "$service is $state (status/health/restarts): see docker compose logs $service"
        return 1
        ;;
    esac
    if [ $((SECONDS - started)) -ge "$WAIT_TIMEOUT" ]; then
      log "$service is still $state after $WAIT_TIMEOUT s: see docker compose logs $service"
      return 1
    fi
    sleep 1
  done
}

# The rolling update (DESIGN.md §14.5). Inside `if`, bash ignores `set -e`, so each command that
# can fail says so: stop, and let the caller roll back.
roll_out() {
  export API_IMAGE="$1" WEB_IMAGE="$2"
  step "worker: the old one stops before the new one starts (one worker at a time)"
  replace worker || return 1
  local replica
  for replica in api-1 api-2; do
    step "$replica: Caddy sends every request to the other replica meanwhile"
    replace "$replica" || return 1
    # Caddy sees a new replica only at its next 5 s check; replacing the other one sooner would
    # leave it with none (DESIGN.md §14.5).
    log "$replica is healthy; waiting 6 s for Caddy's next health check to see it"
    sleep 6
  done
  step "web (its pages are unavailable for a few seconds)"
  replace web || return 1
  # Usually nothing to do: `run migrate` started Postgres and Redis. Caddy has no health check;
  # the smoke test reaches it (with retries).
  step "the rest: started if not running, replaced if their settings changed"
  compose up --detach --remove-orphans || return 1
  # Applies a changed Caddyfile (checked earlier) without a restart.
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || return 1
}

# 12 tries, 5 s apart.
retry() {
  for _ in {1..12}; do
    "$@" && return 0
    sleep 5
  done
  return 1
}

# While paused, the real name answers with the back-soon page (503).
shows_back_soon_page() {
  [ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "${INSECURE[@]}" \
    --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST/")" = 503 ]
}

smoke_test() {
  step "smoke test"
  local replica path state url
  for replica in api-1 api-2; do
    compose exec -T "$replica" node -e "$HEALTH_CHECK" || {
      log "$replica: GET /health did not answer 200 (Postgres or Redis unreachable?)"
      return 1
    }
    log "$replica: GET /health → 200"
  done
  # No health check: a worker that crashes after starting is restarted and looks "running"
  # in between, so count its restarts.
  state="$(container_state "$(compose ps --quiet worker)")"
  [ "$state" = "running/none/${restarts_at_start[worker]}" ] || {
    log "worker is $state (status/health/restarts): see docker compose logs worker"
    return 1
  }
  log "worker: running, no restarts since it started"
  if [ -e "$PAUSE_FLAG" ]; then
    # Paused: check the pages from inside the web container (as Caddy reaches them), and the real
    # name must show the back-soon page.
    for url in http://caddy:8080/api/v1/projects http://127.0.0.1:3000/; do
      retry compose exec -T web node -e "$(node_get "$url")" || {
        log "GET $url inside the web container failed"
        return 1
      }
      log "GET $url (inside the web container) → 200"
    done
    retry shows_back_soon_page || {
      log "GET https://$SITE_HOST/ through Caddy did not answer with the back-soon page (503)"
      return 1
    }
    log "GET https://$SITE_HOST/ → 503, the back-soon page (the site is paused)"
    return 0
  fi
  # Through Caddy with the real name and certificate, but locally, so DNS doesn't matter (the
  # workflow checks from the internet after). A first deploy's certificate takes ~a minute.
  for path in /api/v1/projects /; do
    curl --silent --show-error --fail --output /dev/null --max-time 10 \
      --retry 12 --retry-delay 5 --retry-all-errors "${INSECURE[@]}" \
      --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST$path" || {
      log "GET https://$SITE_HOST$path through Caddy failed"
      return 1
    }
    log "GET https://$SITE_HOST$path → 200"
  done
}

# Registry images only (they can be pulled again). Keeps this release and the previous one, so
# the disk doesn't fill up. Not "newest N": cached builds can carry older creation times.
remove_old_images() {
  [[ "$IMAGE_PREFIX" == */* ]] || return 0
  # Redeploying the running release: its "previous" is itself, so keep everything.
  [ "$previous_api" != "$new_api" ] || return 0
  local old
  old="$({
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$IMAGE_PREFIX-api"
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$IMAGE_PREFIX-web"
  } | grep -v -x -F -e "$new_api" -e "$new_web" -e "${previous_api:-none}" -e "${previous_web:-none}" |
    grep -v ':<none>$' || true)"
  [ -n "$old" ] || return 0
  log "removing older images: $(echo "$old" | tr '\n' ' ')"
  # shellcheck disable=SC2086 # one image name per word
  docker image rm $old >/dev/null || log "some older images could not be removed (still used by a container?)"
}

step "deploying $tag"
log "new release:      $new_api, $new_web"
log "current release:  ${previous_api:-none (first deploy)}${previous_web:+, $previous_web}"
[ ! -e "$PAUSE_FLAG" ] || log "the site is paused: visitors keep getting the back-soon page"

step "pulling the images"
pull_images "$new_api" "$new_web"

step "checking the settings and the Caddyfile (before anything changes)"
# A release needing a new deploy/.env value stops here, naming it (`${VAR:?…}`).
compose config --quiet || {
  log "FAILED: compose.prod.yml or deploy/.env has a problem (above). Nothing was changed."
  exit 1
}
if ! output="$(compose run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1)"; then
  printf '%s\n' "$output"
  log "FAILED: deploy/caddy/Caddyfile is invalid. Nothing was changed."
  exit 1
fi
log "valid"

# Migrations and content first, while the current release keeps serving on a compatible
# schema (DESIGN.md §14.3): a failure here changes nothing visitors use.
step "migrating the database"
API_IMAGE="$new_api" compose run --rm migrate
step "publishing the content"
API_IMAGE="$new_api" compose run --rm seed

record_release "$new_api" "$new_web"
if roll_out "$new_api" "$new_web" && smoke_test; then
  remove_old_images
  step "deployed $tag in ${SECONDS} s"
  exit 0
fi

step "the new release failed"
if [ -z "$previous_api" ] || [ "$previous_api" = "$new_api" ]; then
  log "There is no earlier release to go back to. See: docker compose -f deploy/compose.prod.yml ps"
  exit 1
fi
log "rolling back to $previous_api, $previous_web"
record_release "$previous_api" "$previous_web"
if roll_out "$previous_api" "$previous_web" &&
  API_IMAGE="$previous_api" compose run --rm seed && smoke_test; then
  step "ROLLED BACK: the previous release serves again. The new one failed: see the log above."
else
  step "ROLLBACK FAILED: see docker compose -f deploy/compose.prod.yml ps, and logs <service>"
fi
exit 1
