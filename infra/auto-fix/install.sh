#!/usr/bin/env bash
# Installs the auto-fix worker for the current user (not root).
set -euo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
for c in claude gh jq git curl flock; do
  command -v "$c" >/dev/null || { echo "Missing: $c (see README.md)"; exit 1; }
done
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/flyp-autofix"
mkdir -p "$CONF_DIR" "$HOME/.local/share/flyp-autofix" "$HOME/.config/systemd/user"
if [ ! -f "$CONF_DIR/.env" ]; then
  cp "$HERE/.env.example" "$CONF_DIR/.env"; chmod 600 "$CONF_DIR/.env"
  echo "Fill in $CONF_DIR/.env (OPS_WORKER_SECRET), then run this again."; exit 1
fi
install -m 755 "$HERE/worker.sh" "$HERE/prompt.md" "$HOME/.local/share/flyp-autofix/"
chmod 644 "$HOME/.local/share/flyp-autofix/prompt.md"
install -m 644 "$HERE/flyp-autofix.service" "$HERE/flyp-autofix.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now flyp-autofix.timer
# Run at boot even before you log in.
loginctl enable-linger "$USER" 2>/dev/null || echo "Note: could not enable linger; the worker starts when you log in."
echo "Installed. Status: systemctl --user list-timers flyp-autofix.timer"
