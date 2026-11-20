#!/usr/bin/env bash
# Deploys one release (DESIGN.md §14.3): the API and web images tagged <tag>, a git commit SHA
# on the server. The deploy workflow runs it over SSH; it also works by hand on the server (to
# go back to an earlier release) and on your laptop against the local production stack.
# Guide: docs/CD.md
#
#   1. pull the two images (only those this machine does not have yet), check the Caddyfile
#   2. migrate the database with the new image (backward compatible: the running code keeps
#      working with the new schema, DESIGN.md §14.4)
#   3. publish the new image's content
#   4. roll out: worker → api-1 → api-2 → web, one at a time, each healthy before the next
#   5. smoke test: /health on each replica, the worker still running, the API and the home page
#      through Caddy under the site's real name (while the site is paused: from inside the web
#      container, and the "back soon" page under the real name)
#   6. if 4 or 5 fails: roll out the previous release the same way, publish its content again
#      (no migrate: migrations only go forward), smoke test, and exit 1
#   7. on success: delete older downloaded images (this release and the previous one stay)
#
#   bash ~/portfolio/deploy/deploy.sh <full commit SHA>    on the server
#   npm run stack:deploy -- dev        laptop: the images `npm run image:api` / `image:web` built
#
# The images are $IMAGE_PREFIX-api:<tag> and $IMAGE_PREFIX-web:<tag>. IMAGE_PREFIX comes from
# the environment (the workflow sets ghcr.io/<owner>/portfolio), else from the current release
# in deploy/.env, else it is `portfolio` (the images built on this machine).
# The current release is kept in deploy/.env (API_IMAGE, WEB_IMAGE), so every other command
# (backup.sh, restore.sh, `docker compose … up`) uses it too.
# With REGISTRY_USER set, the first line of input is the registry password (the workflow's
# token, valid for that job only), used for this pull and not stored.
set -Eeuo pipefail
umask 077 # deploy/.env holds secrets: rewritten owner-only

tag="${1:?usage: bash deploy/deploy.sh <tag>   (a commit SHA, or dev on your laptop)}"
if ! [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "Not an image tag: $tag" >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"
# How long a new container may take to become healthy. A replica is healthy in seconds; one that
# never answers is reported unhealthy by Docker only after ~2.5 minutes, so stop waiting sooner.
WAIT_TIMEOUT="${WAIT_TIMEOUT:-120}"
# A Node one-liner for `docker compose exec` (the images have no curl): exits 0 when GET <url>
# answers 2xx within 10 s.
node_get() {
  printf 'fetch("%s", { signal: AbortSignal.timeout(10000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "$1"
}
HEALTH_CHECK="$(node_get http://127.0.0.1:4000/health)"
# While this file exists the site is paused (docs/CD.md §5): Caddy gives visitors the "back
# soon" page. Deploys still run, and leave it paused.
PAUSE_FLAG="$DEPLOY_DIR/caddy/paused"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
step() { printf '\n%s ▶ %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
compose() { docker compose -f "$DEPLOY_DIR/compose.prod.yml" "$@"; }
# One value from deploy/.env. Read as data, not `source`d: the file is not a script.
setting() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

[ -f "$ENV_FILE" ] || {
  echo "Missing $ENV_FILE: create it from deploy/.env.example first (docs/CD.md §2)." >&2
  exit 1
}

registry_password=""
if [ -n "${REGISTRY_USER:-}" ]; then
  read -r registry_password || true
fi
# Nothing below reads the input: `docker compose run` and `exec` would otherwise consume it.
exec </dev/null

# Two deploys at once (the workflow and one by hand) would replace the same containers.
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

# Downloads the images this machine does not have yet. A tag names one commit and never moves,
# so an image already here is the right one. The password goes to a temporary Docker config
# that is deleted afterwards: nothing that can pull from the registry stays on the server.
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
      # Its output only on failure: on success it warns that the password is stored
      # unencrypted, which is about the temporary folder deleted above.
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

# Writes the release into deploy/.env (replacing the API_IMAGE and WEB_IMAGE lines, keeping the
# rest), so later commands that read the file start the same images.
record_release() {
  local temporary="$ENV_FILE.tmp"
  {
    grep -v -E '^(API_IMAGE|WEB_IMAGE)=' "$ENV_FILE" || true
    printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$1" "$2"
  } >"$temporary"
  mv "$temporary" "$ENV_FILE"
}

# A container's state as "<status>/<health>/<restarts>", e.g. running/healthy/0. Health is
# `none` without a health check; restarts counts Docker restarting it after a crash.
container_state() {
  docker inspect --format \
    '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}/{{.RestartCount}}' \
    "$1"
}

# Restarts each service's container had when this deploy started it (an unchanged container keeps
# its count from before, which says nothing about this release).
declare -A restarts_at_start

# Replaces one service's container if its image or settings changed (otherwise leaves it), then
# waits until Docker calls it healthy; a service without a health check (the worker) must run
# for 5 s without crashing. The old container gets SIGTERM and finishes its work first.
# Not `up --wait`: Compose (v5.0) reports success when its timeout passes while a container is
# still "starting", so a replica that never answers got through (the rollback test in
# docs/CD.md, "What was tested"), and the next step took the other replica down too.
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

# The rolling update (DESIGN.md §14.5). Inside `if`, bash ignores `set -e`, so every command
# that can fail says what to do: stop, and let the caller roll back.
roll_out() {
  export API_IMAGE="$1" WEB_IMAGE="$2"
  step "worker: the old one stops before the new one starts (one worker at a time)"
  replace worker || return 1
  local replica
  for replica in api-1 api-2; do
    step "$replica: Caddy sends every request to the other replica meanwhile"
    replace "$replica" || return 1
    # Caddy checks each replica every 5 s and treats a new one as down until its next check.
    # Taking the other replica down sooner would leave Caddy with none (DESIGN.md §14.5).
    log "$replica is healthy; waiting 6 s for Caddy's next health check to see it"
    sleep 6
  done
  step "web (its pages are unavailable for a few seconds)"
  replace web || return 1
  # Usually nothing to do: Postgres and Redis were started by `run migrate`. Caddy has no
  # health check; the smoke test reaches it (with retries) instead.
  step "the rest: started if not running, replaced if their settings changed"
  compose up --detach --remove-orphans || return 1
  # Applies a changed Caddyfile (checked before anything changed) without a restart.
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || return 1
}

# Runs a command until it succeeds: 12 tries, 5 s apart (as long as the curl checks retry).
retry() {
  for _ in {1..12}; do
    "$@" && return 0
    sleep 5
  done
  return 1
}

# While paused: Caddy answers the site's real name with the back-soon page (status 503).
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
  # The worker has no health check. One that crashes a while after starting (e.g. once it
  # reaches Redis) is restarted by Docker and looks "running" in between: count its restarts.
  state="$(container_state "$(compose ps --quiet worker)")"
  [ "$state" = "running/none/${restarts_at_start[worker]}" ] || {
    log "worker is $state (status/health/restarts): see docker compose logs worker"
    return 1
  }
  log "worker: running, no restarts since it started"
  if [ -e "$PAUSE_FLAG" ]; then
    # Paused: visitors get the back-soon page, so the pages are checked from inside the web
    # container instead, the way Caddy reaches them (the home page calls the API through
    # Caddy's :8080), and the site's real name must answer with that page.
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
  # Through Caddy, under the real name and with the real certificate, but on this machine, so
  # the result does not depend on DNS (the workflow checks from the internet afterwards). On
  # the first deploy Caddy is still getting its certificate: retried for about a minute.
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

# Registry images only: they can be downloaded again, images built on this machine cannot.
# Keeps this release and the one before it, deletes older ones, so the disk does not fill up
# release after release. (Not "the newest N": a build that reuses cached layers can carry an
# older creation time, so build times do not say which release came last.)
remove_old_images() {
  [[ "$IMAGE_PREFIX" == */* ]] || return 0
  # Deploying the running release again: its "previous" is itself, so keep everything.
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
# A release that needs a new value in deploy/.env stops here, naming it (`${VAR:?…}`).
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

# Migrations and content first, while the current release keeps serving (DESIGN.md §14.3).
# A failure here changes nothing the visitors use: the old code runs on a compatible schema.
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
