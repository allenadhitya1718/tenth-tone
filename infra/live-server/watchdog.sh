#!/usr/bin/env bash
# Runs every minute (systemd timer). Restarts a service that stops answering
# twice in a row, frees disk space before it runs out, and pings Better
# Stack while all is well: if the pings stop, you get an alert.
set -uo pipefail
DIR=/opt/flyp-live
STATE=/var/lib/flyp-live
cd "$DIR" || exit 1
set -a; . ./.env; set +a
log() { logger -t flyp-live-watchdog "$*"; }

healthy=1

check_service() {
  local name=$1 cmd=$2 n
  if eval "$cmd" >/dev/null 2>&1; then
    rm -f "$STATE/fail.$name"
    return
  fi
  healthy=0
  n=$(( $(cat "$STATE/fail.$name" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$STATE/fail.$name"
  log "$name is not answering (check $n)"
  if [ "$n" -ge 2 ]; then
    log "restarting $name"
    docker compose restart "$name" >/dev/null 2>&1 || log "restart of $name failed"
    echo 0 > "$STATE/fail.$name"
  fi
}

check_service redis   "docker compose exec -T redis redis-cli ping | grep -q PONG"
check_service livekit "curl -fsS -m 5 http://127.0.0.1:7880"
check_service egress  "curl -fsS -m 5 http://127.0.0.1:8080"
check_service caddy   "curl -fsS -m 8 --resolve ${LIVE_DOMAIN}:443:127.0.0.1 https://${LIVE_DOMAIN}"

# Disk: recordings pass through egress-tmp on their way to the bucket.
used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
if [ "${used:-0}" -ge 85 ]; then
  log "disk ${used}% full: clearing old temp files and unused images"
  find "$STATE/egress-tmp" -type f -mmin +180 -delete 2>/dev/null
  docker image prune -f >/dev/null 2>&1
  used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  [ "${used:-0}" -ge 92 ] && healthy=0
fi

if [ "$healthy" -eq 1 ] && [ -n "${BETTERSTACK_HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 "$BETTERSTACK_HEARTBEAT_URL" >/dev/null 2>&1 || log "heartbeat ping failed"
fi
