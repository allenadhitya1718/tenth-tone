# FLYP auto-fix: Claude Code on incidents, from your laptop

When something breaks (the live server stops answering, or a crash shows up in Sentry), the alert goes into an **incident queue** in our Supabase. Your phone is alerted at the same time. As soon as your laptop is on, a small service takes each incident and runs **Claude Code** on it.

```
Better Stack / Sentry --webhook--> ops-alert (Supabase) --> ops_incidents queue
                                                                 |
             laptop on: every 2 min, flyp-autofix worker  <------+
               - fresh git worktree, new branch
               - claude -p (prompt.md), limited tools
               - server problem: restricted SSH (status, logs, restart)
               - code problem: commit -> draft pull request for you
               - result back to the queue + desktop notification
```

**What it can do:**
- Read the code, fix it on a new branch, run the type and lint checks.
- Open a **draft** pull request for you to review.
- On the live server: check status, read logs and restart services, through a restricted login (`flypops`) that can't change configs or read secrets.

**What it never does on its own:**
- Publish an app update or store build, deploy server functions, or change the database.
- Read or change secrets, delete data or recordings, or reboot the server.

These are blocked twice: by the instructions (`prompt.md`), and by the tool allow- and block-lists in `worker.sh`. Code fixes always wait for your review.

## Setup (about 15 minutes, after the live server exists)

1. **Claude Code CLI on the laptop.** Install it from the official instructions (npm: `npm install -g @anthropic-ai/claude-code`), then run `claude` once in a terminal and sign in.
2. **GitHub CLI** is already signed in on this laptop (`gh auth status`).
3. **SSH key for the restricted server login:**
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/flyp_ops -N ""
   ```
   - Copy `~/.ssh/flyp_ops.pub` into `/opt/flyp-live/ops_authorized_keys` on the server, then run `sudo bash /opt/flyp-live/install.sh` again.
   - Add this to `~/.ssh/config`:
     ```
     Host flyp-live
       HostName live.flyp-sa.com
       User flypops
       IdentityFile ~/.ssh/flyp_ops
     ```
   - Test it: `ssh flyp-live 'sudo docker compose --project-directory /opt/flyp-live ps'`.
4. **Two secrets in Supabase** (Edge Functions → Secrets). Make each a long random string, e.g. from `openssl rand -hex 32`:
   - `OPS_ALERT_SECRET`: goes in the webhook URLs below.
   - `OPS_WORKER_SECRET`: also goes in the laptop's `.env` (step 6).
5. **Database and function** (Claude does this with your OK): apply migration `0165_ops_incidents.sql`, then
   `npx supabase functions deploy ops-alert --no-verify-jwt`.
6. **Install the worker:** `bash infra/auto-fix/install.sh`. The first run creates `~/.config/flyp-autofix/.env`; put `OPS_WORKER_SECRET` in it, then run the installer again.
7. **Point the alerts at the queue.** Webhook URL: `https://vfkwipvinmnybilcrdzr.supabase.co/functions/v1/ops-alert?key=<OPS_ALERT_SECRET>`.
   - Better Stack: Integrations → Webhook → that URL; attach it to the live server monitors.
   - Sentry: Settings → Integrations → Webhooks (or an Internal Integration) → that URL; use it in an alert rule for new issues.

## Test it

```bash
curl -X POST "https://vfkwipvinmnybilcrdzr.supabase.co/functions/v1/ops-alert?key=<OPS_ALERT_SECRET>" \
  -H 'content-type: application/json' \
  -d '{"source":"manual","title":"Test: check the live server is healthy"}'
```

Within 2 minutes a desktop notification says it's working. When it finishes, the incident row (Supabase → Table editor → `ops_incidents`) shows the status and what was done.

## Day to day

| What | How |
|---|---|
| Is the worker running? | `systemctl --user list-timers flyp-autofix.timer` |
| What did it do? | `ops_incidents` table (status, result), or `~/.cache/flyp-autofix/incident-<id>.log` |
| Pause it | `systemctl --user disable --now flyp-autofix.timer` |
| Resume | `systemctl --user enable --now flyp-autofix.timer` |
| Change what it may do | Edit `prompt.md` / the tool lists in `worker.sh`, then run `install.sh` again |

- **Incidents while the laptop is off** wait in the queue. Each incident gets at most 3 tries.
- **One that was mid-fix when the laptop shut down** goes back in the queue after 2 hours.
- **Repeats of the same open alert** are filed once.
