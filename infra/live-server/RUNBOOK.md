# FLYP live server: setup and runbook

One server runs FLYP's lives: **LiveKit** (the live rooms), **Egress** (records lives into our Cloudflare bucket `flyp-app-media`, which clips are cut from), **Redis** and **Caddy** (HTTPS). Calls stay on Agora.

- **The address the app connects to:** `wss://live.flyp-sa.com`.
- **What runs it:** everything is in `/opt/flyp-live` on the server.
- **What keeps it up:**
  - Docker restarts any service that stops.
  - A watchdog checks every minute that each one *answers*, and restarts it if not.
  - Better Stack alerts you if the watchdog's heartbeat stops.

## 1. One-time setup

### Oracle Cloud (you)
1. **Sign up** at cloud.oracle.com with **home region Jeddah** (you can't change it later), then upgrade the account to **Pay As You Go**, so the server is never reclaimed as "idle".
2. **Create the server:** Compute → Instances → Create.
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere VM.Standard.A1.Flex, 4 OCPU, 24 GB**. If Oracle says "out of capacity", try again later or choose 2 OCPU / 12 GB.
   - Boot volume: 100 GB.
   - Add your SSH public key, and keep the private key safe.
3. **Fix the public IP:** Networking → Reserved public IPs → reserve one and attach it to the server, so the address never changes.
4. **Open the ports:** Networking → your VCN → Security List → Ingress rules, source `0.0.0.0/0`:

   | Protocol | Port | For |
   |---|---|---|
   | TCP | 80, 443 | HTTPS, certificate renewal |
   | TCP | 7881 | Live video over TCP (fallback) |
   | UDP | 7882 | Live video (main path) |
   | UDP | 3478 | TURN, for phones on strict networks |

### Cloudflare (you)
5. **DNS:** add `A  live  <server IP>`, **DNS only (grey cloud)**. Live video cannot go through Cloudflare's proxy.
6. **R2 → Manage API tokens:** create a token with **Object Read & Write on `flyp-app-media` only**, for the recorder. Keep the Access Key ID, Secret and Account ID for step 8.

### On the server (you, or Claude over SSH; the secrets stay in `.env`)
7. Copy this folder to the server and into place:
   ```bash
   scp -r infra/live-server ubuntu@<server IP>:~/
   ssh ubuntu@<server IP> 'sudo mkdir -p /opt/flyp-live && sudo cp -r ~/live-server/. /opt/flyp-live/'
   ```
8. Run `sudo bash /opt/flyp-live/install.sh`. The first run creates `.env` and stops.
   - Fill in `.env` yourself: `sudo nano /opt/flyp-live/.env`, with the R2 values from step 6. Leave the LiveKit key and secret empty; the script makes them.
   - Run `install.sh` again. It installs Docker, opens the firewall, starts everything and checks it.
9. **Supabase secrets** (Dashboard → Edge Functions → Secrets):
   - `LIVEKIT_URL` = `wss://live.flyp-sa.com`;
   - `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`: read them on the server with `sudo grep ^LIVEKIT_ /opt/flyp-live/.env`. Never paste them in chat.

### Better Stack (you)
10. Create these monitors:
    - **Heartbeat** monitor, every 1 min, grace 3 min: copy its URL into `.env` as `BETTERSTACK_HEARTBEAT_URL` and run `install.sh` again.
    - **HTTP** monitor on `https://live.flyp-sa.com`, every 1 min.
    - Turn on push alerts in the Better Stack phone app.
    - Add a **webhook** integration pointing at the `ops-alert` function (see `infra/auto-fix/README.md`), so incidents reach the auto-fix queue.

## 2. Everyday checks

| What | Command (on the server) |
|---|---|
| Is everything running? | `cd /opt/flyp-live && sudo docker compose ps` |
| Recent problems | `journalctl -t flyp-live-watchdog --since "1 hour ago"` |
| LiveKit logs | `sudo docker compose logs --tail 200 livekit` |
| Recorder logs | `sudo docker compose logs --tail 200 egress` |
| Disk | `df -h /` |
| CPU / memory | `top`, or `sudo docker stats --no-stream` |

## 3. When something is wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Better Stack: heartbeat missing | A service stopped answering and the watchdog couldn't bring it back, or the whole server is down | SSH in. If SSH fails: reboot the instance in the Oracle console. Then `docker compose ps` and logs |
| HTTPS monitor down, heartbeat fine | Certificate or DNS | `docker compose logs caddy`; check the DNS record is still grey-cloud and points at the reserved IP |
| App: "Couldn't join the live" for everyone | LiveKit down, or the Supabase secrets are wrong | `curl -s http://127.0.0.1:7880` should say OK; check `LIVEKIT_*` secrets match `.env` |
| Joins work on Wi-Fi but not on some mobile networks | UDP blocked | Check 3478/udp and 7881/tcp are open (Oracle Security List and `sudo iptables -L INPUT -n`) |
| Lives work but no recordings or clips | Recorder down, or R2 token wrong or expired | `docker compose logs egress`; look for S3 or 403 errors; make a new R2 token and run `install.sh` |
| Disk over 85% | Recordings stuck in temp | The watchdog already clears files over 3 h old. Check `ls -la /var/lib/flyp-live/egress-tmp` |
| CPU above 70% for long periods | Too many lives at once | Time to add a second server (section 5) |

**Restart everything:** `cd /opt/flyp-live && sudo docker compose restart`.

**Roll back an update:** put the previous image tags back in `docker-compose.yml`, then `sudo docker compose up -d`.

## 4. Updating

1. Check the release notes for the new LiveKit / Egress versions.
2. Change the tags in `docker-compose.yml` (in git first), copy to the server, then `sudo docker compose pull && sudo docker compose up -d`.
3. **After an update:** `docker compose ps`; start a test live from the app; check that a recording appears in `flyp-app-media/lives/`.
4. Do it when no one is live: active rooms end on restart.

Ubuntu security updates install by themselves (unattended-upgrades is on by default on Ubuntu). Reboot once a month in a quiet hour: `sudo reboot`. Everything starts again on its own.

## 5. Growing

- **One 4-CPU server** should serve a few hundred people watching at once (lives are forwarded, not re-encoded). Watch CPU and bandwidth in Better Stack.
- **To add a server:** create a second one the same way, then point both at a shared Redis. LiveKit spreads rooms across nodes that share Redis. Move Redis to its own small server with a password first.
- **Bandwidth:** Oracle includes about 10 TB a month free; past that it's under 1 cent per GB.
