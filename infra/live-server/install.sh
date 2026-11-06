#!/usr/bin/env bash
# Installs or updates the FLYP live server. Run on the server as:
#   sudo bash /opt/flyp-live/install.sh
# Safe to run again (after editing .env or changing versions).
# Tested target: Ubuntu 24.04 (Oracle Cloud Ampere/ARM or any x86 server).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
[ "$(id -u)" -eq 0 ] || exec sudo bash "$0" "$@"
if [ "$(pwd)" != /opt/flyp-live ]; then
  echo "Copy this folder to /opt/flyp-live first (the watchdog runs from there):"
  echo "  sudo mkdir -p /opt/flyp-live && sudo cp -r ./* ./.env.example ./.gitignore /opt/flyp-live/"
  exit 1
fi

say() { printf '\n== %s\n' "$*"; }

say "Packages (Docker, firewall tools)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 gettext-base curl openssl iptables-persistent
systemctl enable --now docker

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from the template. Fill it in (sudo nano $(pwd)/.env), then run this again."
  exit 1
fi
chmod 600 .env

# LiveKit key and secret: made here if empty, written only to .env.
set -a; . ./.env; set +a
if [ -z "${LIVEKIT_API_KEY:-}" ] || [ -z "${LIVEKIT_API_SECRET:-}" ]; then
  say "Creating the LiveKit API key and secret (saved in .env only)"
  key="API$(openssl rand -hex 6)"
  secret="$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-48)"
  sed -i "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=${key}|; s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=${secret}|" .env
  set -a; . ./.env; set +a
fi

missing=()
for v in LIVE_DOMAIN LIVEKIT_API_KEY LIVEKIT_API_SECRET SUPABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Fill these in .env first: ${missing[*]}"
  exit 1
fi
if [ "$R2_BUCKET" = "flyp-media" ]; then
  echo "R2_BUCKET is the OLD shared bucket. FLYP uses flyp-app-media."
  exit 1
fi

say "Writing the service configs"
mkdir -p rendered
for f in livekit.yaml egress.yaml Caddyfile; do
  envsubst < "$f.template" > "rendered/$f"
done
chmod 600 rendered/*
mkdir -p /var/lib/flyp-live/egress-tmp
chmod 1777 /var/lib/flyp-live/egress-tmp

say "Firewall: opening the live ports (also open them in Oracle's Security List)"
# Oracle's Ubuntu images end the INPUT chain with a REJECT rule: our rules
# go just before it. 7880 (LiveKit's own HTTP) stays closed: Caddy serves it.
open_port() {
  local proto=$1 port=$2
  iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null && return
  local pos
  pos=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
  if [ -n "$pos" ]; then iptables -I INPUT "$pos" -p "$proto" --dport "$port" -j ACCEPT
  else iptables -A INPUT -p "$proto" --dport "$port" -j ACCEPT; fi
}
open_port tcp 80
open_port tcp 443
open_port tcp 7881
open_port udp 7882
open_port udp 3478
netfilter-persistent save >/dev/null

say "Starting the services"
docker compose pull -q
docker compose up -d --remove-orphans

say "Installing the watchdog (checks every minute, restarts what stops answering)"
install -m 755 watchdog.sh /usr/local/bin/flyp-live-watchdog
install -m 644 flyp-live-watchdog.service flyp-live-watchdog.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now flyp-live-watchdog.timer

# The auto-fix login (infra/auto-fix): a user that can only check, read logs
# and restart, never change configs or read .env. Only when you add its
# public key to ops_authorized_keys in this folder.
if [ -s ops_authorized_keys ]; then
  say "Auto-fix login (flypops): status, logs and restarts only"
  id flypops >/dev/null 2>&1 || useradd -m -s /bin/bash flypops
  install -d -m 700 -o flypops -g flypops /home/flypops/.ssh
  install -m 600 -o flypops -g flypops ops_authorized_keys /home/flypops/.ssh/authorized_keys
  DC="/usr/bin/docker compose --project-directory /opt/flyp-live"
  cat > /etc/sudoers.d/flypops <<SUDO
flypops ALL=(root) NOPASSWD: $DC ps, $DC logs *, $DC restart *, $DC up -d, /usr/bin/journalctl --no-pager *, /usr/local/bin/flyp-live-watchdog, /usr/bin/docker stats --no-stream
SUDO
  chmod 440 /etc/sudoers.d/flypops
  visudo -cf /etc/sudoers.d/flypops >/dev/null || { rm -f /etc/sudoers.d/flypops; echo "sudoers check failed: flypops left without sudo"; }
fi

say "Checking"
ok=1
for i in $(seq 1 30); do curl -fsS -m 3 http://127.0.0.1:7880 >/dev/null 2>&1 && break; sleep 2; done
curl -fsS -m 3 http://127.0.0.1:7880 >/dev/null 2>&1 && echo "LiveKit: answering" || { echo "LiveKit: NOT answering (docker compose logs livekit)"; ok=0; }
curl -fsS -m 3 http://127.0.0.1:8080 >/dev/null 2>&1 && echo "Recorder: answering" || { echo "Recorder: not answering yet (docker compose logs egress)"; ok=0; }
if curl -fsS -m 10 "https://${LIVE_DOMAIN}" >/dev/null 2>&1; then echo "HTTPS ${LIVE_DOMAIN}: OK"
else echo "HTTPS ${LIVE_DOMAIN}: not yet. Check the DNS record (grey cloud) and ports 80/443 in Oracle's Security List."; ok=0; fi

say "Next"
echo "1. Supabase secrets: LIVEKIT_URL=wss://${LIVE_DOMAIN}, plus LIVEKIT_API_KEY and LIVEKIT_API_SECRET."
echo "   Read them yourself with: sudo grep ^LIVEKIT_ $(pwd)/.env   (don't paste them in chat)"
echo "2. Better Stack: add BETTERSTACK_HEARTBEAT_URL to .env and run this script again."
[ "$ok" -eq 1 ] && echo "All checks passed." || { echo "Some checks failed: see RUNBOOK.md."; exit 2; }
