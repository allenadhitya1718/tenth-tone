#!/usr/bin/env bash
# FLYP auto-fix worker. Runs every 2 minutes while the laptop is on (systemd
# user timer), and once right after start-up. Takes incidents from the queue
# one at a time and runs Claude Code on each in a fresh git worktree.
set -uo pipefail
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/flyp-autofix/.env"
[ -f "$CONF" ] || { echo "missing $CONF"; exit 1; }
set -a; . "$CONF"; set +a
: "${OPS_URL:?}" "${OPS_WORKER_SECRET:?}" "${REPO_DIR:?}" "${BASE_BRANCH:=main}"
WORK="${XDG_CACHE_HOME:-$HOME/.cache}/flyp-autofix"
HERE="$(dirname "$(readlink -f "$0")")"
mkdir -p "$WORK"

# One worker at a time.
exec 9>"$WORK/lock"
flock -n 9 || exit 0

notify() { command -v notify-send >/dev/null && notify-send -a "FLYP auto-fix" "$1" "$2" || true; }
api() { curl -fsS -m 30 -X POST -H "x-ops-worker: $OPS_WORKER_SECRET" -H 'content-type: application/json' "$OPS_URL/$1" ${2:+-d "$2"}; }

# Offline (laptop just woke): try again next run.
curl -fsS -m 10 -o /dev/null https://api.github.com || exit 0

# The incident and result files live in each worktree but must never be
# committed: keep them out of git for every worktree of this repository.
EXCLUDE="$(git -C "$REPO_DIR" rev-parse --path-format=absolute --git-common-dir)/info/exclude"
mkdir -p "$(dirname "$EXCLUDE")"
grep -qx 'INCIDENT.json' "$EXCLUDE" 2>/dev/null || printf 'INCIDENT.json\nRESULT.md\n' >> "$EXCLUDE"

for _ in 1 2 3; do
  incident="$(api claim)" || exit 0
  id="$(printf '%s' "$incident" | jq -r '.incident.id // empty')"
  [ -n "$id" ] || exit 0
  title="$(printf '%s' "$incident" | jq -r '.incident.title')"
  notify "Working on an incident" "$title"

  wt="$WORK/incident-$id"
  branch="autofix/incident-$id-$(date +%Y%m%d%H%M)"
  git -C "$REPO_DIR" fetch -q origin "$BASE_BRANCH"
  rm -rf "$wt"
  git -C "$REPO_DIR" worktree add -q -b "$branch" "$wt" "origin/$BASE_BRANCH"
  printf '%s' "$incident" | jq '.incident' > "$wt/INCIDENT.json"
  base="$(git -C "$wt" rev-parse HEAD)"

  # Claude Code, headless, with only the tools the job needs. The prompt
  # (prompt.md) lists what it may and may not do; the tool lists enforce it.
  ( cd "$wt" && timeout 45m claude -p "$(cat "$HERE/prompt.md")" \
      --permission-mode acceptEdits \
      --max-turns 80 \
      --allowedTools "Read" "Edit" "Write" "Glob" "Grep" \
        "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git add:*)" "Bash(git commit:*)" \
        "Bash(npx tsc:*)" "Bash(npx eslint:*)" "Bash(npx expo lint:*)" "Bash(ssh flyp-live:*)" \
      --disallowedTools "Bash(git push:*)" "Bash(gh:*)" "Bash(npx supabase:*)" "Bash(npx eas-cli:*)" "Bash(eas:*)" "Bash(curl:*)" "WebFetch" \
      > "$WORK/incident-$id.log" 2>&1 )

  if [ -f "$wt/RESULT.md" ]; then
    status="$(head -1 "$wt/RESULT.md" | sed -n 's/^STATUS: *\(fixed\|needs_human\|failed\)$/\1/p')"
    summary="$(tail -n +2 "$wt/RESULT.md")"
  fi
  status="${status:-failed}"
  summary="${summary:-Claude Code did not finish. Log: $WORK/incident-$id.log}"

  # A code fix: push the branch and open a DRAFT pull request for review.
  if [ "$(git -C "$wt" rev-parse HEAD)" != "$base" ]; then
    if git -C "$wt" push -q origin "$branch" 2>/dev/null; then
      pr="$(cd "$wt" && gh pr create --draft --base "$BASE_BRANCH" --head "$branch" \
            --title "Auto-fix: $title" --body "$summary" 2>/dev/null)"
      [ -n "$pr" ] && summary="$summary

Pull request (draft, needs your review): $pr"
      [ "$status" = fixed ] && status=needs_human   # code waits for the owner's review
    fi
  fi

  api finish "$(jq -n --argjson id "$id" --arg s "$status" --arg r "$summary" '{id:$id,status:$s,result:$r}')" >/dev/null
  notify "Incident: $status" "$title"
  git -C "$REPO_DIR" worktree remove --force "$wt" 2>/dev/null
  # Keep the branch only if it was pushed.
  git -C "$REPO_DIR" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 || git -C "$REPO_DIR" branch -q -D "$branch" 2>/dev/null
  unset status summary
done
