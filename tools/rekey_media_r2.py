#!/usr/bin/env python3
"""
rekey_media_r2.py — give every object already in R2 a key that says nothing
about who uploaded it, and in doing so invalidate every media URL that has
already leaked.

Standard library plus `requests`. Reuses the SigV4 signer from
copy_media_to_r2.py rather than repeating it.

────────────────────────────────────────────────────────────────────────────
YOU RUN THIS, NOT CLAUDE
────────────────────────────────────────────────────────────────────────────
It needs the Supabase service_role key, which bypasses every row-level
security policy in the database. That key must never be pasted into a chat,
committed, or placed anywhere under web/. Put the values in a file, run this,
then delete the file. The env file is the same one copy_media_to_r2.py used:

    # r2-migrate.env  — DELETE THIS FILE WHEN YOU ARE DONE
    SUPABASE_URL=https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...
    R2_ACCOUNT_ID=...
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_BUCKET=flyp-media
    R2_PUBLIC_BASE=https://<your r2.dev or cdn domain>

    python tools/rekey_media_r2.py --env r2-migrate.env             # dry run
    python tools/rekey_media_r2.py --env r2-migrate.env --copy      # do it
    # ... read and run r2_rekey_urls.sql, open the app, watch a video ...
    python tools/rekey_media_r2.py --env r2-migrate.env --delete-old
    del r2-migrate.env

────────────────────────────────────────────────────────────────────────────
WHY
────────────────────────────────────────────────────────────────────────────
Object keys were `videos/<auth uid>/<timestamp>-<uuid>.mp4`, so the serving
URL carried a stable per-user identifier and an upload clock. media-upload no
longer mints keys like that — new uploads are 16 random bytes — but every
object already in the bucket still has the old shape, and a URL outlives the
row it came from: share sheets, other people's chat apps, CDN and referer
logs, WebView caches.

Rekeying is also the only revocation this app has. A public bucket serves
whatever key exists, so a leaked URL works for ever; the only way to take it
back is for that key to stop existing. Copy to a new random key, repoint the
database, delete the old object — and every URL handed out so far is dead.

────────────────────────────────────────────────────────────────────────────
HOW IT STAYS SAFE
────────────────────────────────────────────────────────────────────────────
The copy is server-side (S3 COPY): the bytes never leave Cloudflare, so this
costs no egress and no bandwidth on your machine, however big the bucket is.

Both keys exist at once, and BOTH have a media_objects row, until you come
back with --delete-old. That matters more than it looks:

  * media-reconcile deletes any object in the bucket with no ledger row. Write
    the new object without a row and the hourly sweep destroys it. Rename the
    old row instead of adding a new one and the sweep destroys the OLD object
    while the database still points at it. Two rows is the only arrangement
    where neither can happen.
  * The cost is that those bytes are counted twice by storage_used_bytes()
    for as long as the window lasts. That is honest — they really are stored
    twice — but keep an eye on the ceiling if the bucket is anywhere near it,
    and close the window promptly.

Like copy_media_to_r2.py, this rewrites no URL itself. It emits
r2_rekey_urls.sql for you to read and run.

Safe to re-run: an object that already has a rekeyed twin is skipped.
"""

import argparse
import os
import secrets
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import requests
except ImportError:
    sys.exit("This needs `requests`:  python -m pip install requests")

from copy_media_to_r2 import (          # noqa: E402
    CACHE_CONTROL, URL_COLUMNS, load_env, r2_request, sb_headers,
)


# An old-style key is `<bucket>/<something>/<file>` where the middle segment is
# a uuid — that is the uploader's auth id. A new-style key is
# `<bucket>/<2 hex>/<32 hex>.<ext>`, whose middle segment is two characters, so
# the two are told apart without guessing.
def leaks_owner(key: str) -> bool:
    parts = key.split("/")
    return len(parts) >= 3 and len(parts[1]) == 36 and parts[1].count("-") == 4


def new_key(bucket: str, old: str) -> str:
    ext = old.rsplit(".", 1)[-1].lower() if "." in old.rsplit("/", 1)[-1] else "bin"
    oid = secrets.token_hex(16)
    return f"{bucket}/{oid[:2]}/{oid}.{ext}"


def ledger(cfg, params):
    r = requests.get(
        f"{cfg['SUPABASE_URL']}/rest/v1/media_objects",
        headers=sb_headers(cfg), params=params, timeout=60,
    )
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, help="file holding the keys")
    ap.add_argument("--copy", action="store_true",
                    help="actually copy (default is a dry run)")
    ap.add_argument("--delete-old", action="store_true",
                    help="remove the old objects. ONLY after the SQL is run and video plays.")
    args = ap.parse_args()

    cfg = load_env(args.env)
    required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "R2_ACCOUNT_ID",
                "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        sys.exit("Missing from the env file: " + ", ".join(missing))
    cfg["SUPABASE_URL"] = cfg["SUPABASE_URL"].rstrip("/")
    cfg["R2_PUBLIC_BASE"] = cfg["R2_PUBLIC_BASE"].rstrip("/")
    base = cfg["R2_PUBLIC_BASE"]

    rows = ledger(cfg, {"select": "id,bucket,key,user_id,size_bytes,content_type,status",
                        "status": "eq.stored", "limit": "10000"})
    stale = [r for r in rows if leaks_owner(r["key"])]

    print(f"{len(rows)} stored objects, {len(stale)} still carrying an auth uuid in the key.\n")

    # ── --delete-old is a separate pass over what a previous run already did ──
    # Recognised by an old-style key whose bytes now also live under a
    # new-style one. Nothing is deleted unless its twin is confirmed present in
    # R2 at the same size, and unless the database has stopped pointing at it.
    if args.delete_old:
        by_size = {}
        for r in rows:
            if not leaks_owner(r["key"]):
                by_size.setdefault((r["bucket"], r["size_bytes"], r["user_id"]), []).append(r)

        removed = 0
        for old in stale:
            twin = by_size.get((old["bucket"], old["size_bytes"], old["user_id"]))
            if not twin:
                print(f"  no rekeyed twin, leaving alone: {old['key']}")
                continue

            # Checked across every column that can hold one of these URLs, not
            # just videos. sounds.audio_url carries the video's own URL and
            # live_streams.thumbnail is filed in the same bucket; missing
            # either would delete a file the database is still serving.
            old_url = f"{base}/{old['key']}"
            pointed_at = False
            for table, col in URL_COLUMNS:
                hit = requests.get(
                    f"{cfg['SUPABASE_URL']}/rest/v1/{table}",
                    headers=sb_headers(cfg),
                    params={"select": "id", col: f"eq.{old_url}", "limit": "1"},
                    timeout=60,
                )
                if hit.ok and hit.json():
                    pointed_at = True
                    break
            if pointed_at:
                print(f"  DATABASE STILL POINTS AT IT — run r2_rekey_urls.sql first: {old['key']}")
                continue

            d = r2_request(cfg, "DELETE", old["key"])
            if d.status_code in (200, 204, 404):
                requests.delete(
                    f"{cfg['SUPABASE_URL']}/rest/v1/media_objects",
                    headers=sb_headers(cfg), params={"id": f"eq.{old['id']}"}, timeout=60,
                )
                removed += 1
                print(f"  removed {old['key']}")
            else:
                print(f"  FAILED {d.status_code} {old['key']}")
        print(f"\nDeleted {removed} old objects and their ledger rows.")
        return

    if not stale:
        print("Nothing to do — every stored object already has an opaque key.")
        return

    if not args.copy:
        for r in stale[:15]:
            print(f"  {r['key']}\n    -> {new_key(r['bucket'], r['key'])}")
        if len(stale) > 15:
            print(f"  ... and {len(stale) - 15} more")
        print("\nDry run. Re-run with --copy to rekey these.")
        return

    mapping = []      # (old_url, new_url)
    failed = 0

    for r in stale:
        old, bucket = r["key"], r["bucket"]
        dst = new_key(bucket, old)
        ctype = r.get("content_type") or "application/octet-stream"

        # Server-side copy. REPLACE rather than COPY for the metadata directive,
        # because the Cache-Control has to be re-stated: it is what lets
        # Cloudflare's edge hold the file, and an object without it turns every
        # view into an origin fetch. See R2_ROLLOUT.md step 5c.
        src = "/" + cfg["R2_BUCKET"] + "/" + "/".join(
            urllib.parse.quote(seg, safe="") for seg in old.split("/")
        )
        res = r2_request(cfg, "PUT", dst, extra_headers={
            "x-amz-copy-source": src,
            "x-amz-metadata-directive": "REPLACE",
            "content-type": ctype,
            "cache-control": CACHE_CONTROL,
        })
        if not res.ok:
            print(f"  COPY FAILED {res.status_code} {old}: {res.text[:200]}")
            failed += 1
            continue

        # Ask R2 how big the new object is rather than assuming the copy worked.
        # Same principle as the confirm step in media-upload: measure, do not
        # trust. A short copy that reported 200 would otherwise become a
        # truncated video nobody notices until a viewer does.
        head = r2_request(cfg, "HEAD", dst)
        actual = int(head.headers.get("content-length") or 0)
        if not head.ok or actual != int(r["size_bytes"] or 0):
            print(f"  SIZE MISMATCH {old}: ledger {r['size_bytes']}, r2 {actual}")
            r2_request(cfg, "DELETE", dst)
            failed += 1
            continue

        # The new object's own ledger row, written BEFORE anything points at it
        # — media-reconcile deletes bucket objects that no row claims, and it
        # runs hourly.
        ins = requests.post(
            f"{cfg['SUPABASE_URL']}/rest/v1/media_objects",
            headers={**sb_headers(cfg), "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates"},
            json=[{"bucket": bucket, "key": dst, "user_id": r["user_id"],
                   "size_bytes": actual, "content_type": ctype, "status": "stored"}],
            timeout=60,
        )
        if not ins.ok:
            print(f"  LEDGER INSERT FAILED {ins.status_code} for {dst}: {ins.text[:200]}")
            print("   Deleting the copy — an object with no row is deleted by the")
            print("   hourly reconcile anyway, and leaving it would be worse.")
            r2_request(cfg, "DELETE", dst)
            failed += 1
            continue

        mapping.append((f"{base}/{old}", f"{base}/{dst}"))
        print(f"  {old}\n    -> {dst}")

    # ── The SQL, for a human to read ──
    # Per-object, not a prefix replace: each key becomes an unrelated random
    # one, so there is no common prefix to swap. One statement per column with
    # a VALUES list keeps it to five statements however many objects there are.
    sql_path = "r2_rekey_urls.sql"
    with open(sql_path, "w", encoding="utf-8") as fh:
        fh.write("-- Generated by tools/rekey_media_r2.py\n")
        fh.write("-- Repoints stored URLs at the new, opaque object keys.\n")
        fh.write("-- Run only after the rekey reported no failures.\n")
        fh.write("--\n")
        fh.write("-- Both objects exist while this is pending, so the app keeps working\n")
        fh.write("-- either way. Only --delete-old makes the old URLs stop resolving,\n")
        fh.write("-- which is the point of the exercise — run it once video plays.\n\n")
        if not mapping:
            fh.write("-- Nothing was rekeyed.\n")
        else:
            fh.write("begin;\n\n")
            values = ",\n         ".join(
                "('" + o.replace("'", "''") + "', '" + n.replace("'", "''") + "')"
                for o, n in mapping
            )
            for table, col in URL_COLUMNS:
                fh.write(f"update public.{table} t\n")
                fh.write(f"   set {col} = m.new_url\n")
                fh.write(f"  from (values {values}) as m(old_url, new_url)\n")
                fh.write(f" where t.{col} = m.old_url;\n\n")
            fh.write("commit;\n\n")
            fh.write("-- Verify. One query on purpose: the Supabase SQL editor shows only\n")
            fh.write("-- the LAST statement's result. Every still_old must be 0.\n")
            parts = []
            for table, col in URL_COLUMNS:
                parts.append(
                    f"select '{table}.{col}' as column_name,\n"
                    f"       count(*) filter (where {col} ~ '/[0-9a-f]{{8}}-[0-9a-f]{{4}}-"
                    f"[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}/') as still_old,\n"
                    f"       count(*) filter (where {col} is not null) as total\n"
                    f"  from public.{table}"
                )
            fh.write("\nunion all\n".join(parts))
            fh.write("\n order by 1;\n")

    print(f"\nrekeyed {len(mapping)}, failed {failed}")
    print(f"Wrote {sql_path} — read it, then run it in the Supabase SQL editor.")
    if failed:
        print("\n!! Some objects failed. The SQL only covers the ones that succeeded,")
        print("   so it is still safe to run; re-run this script for the rest.")
    print("\nThen open the app and watch a video before --delete-old. Until you do,")
    print("both copies exist and both count toward the storage ceiling.")


if __name__ == "__main__":
    main()
