#!/usr/bin/env python3
"""
copy_media_to_r2.py — move what is already in the Supabase `videos` bucket
into Cloudflare R2, and record every object in the media_objects ledger so the
storage ceiling can still see it.

Standard library plus `requests` only. No boto3, no npm install.

────────────────────────────────────────────────────────────────────────────
YOU RUN THIS, NOT CLAUDE
────────────────────────────────────────────────────────────────────────────
It needs the Supabase service_role key, which bypasses every row-level
security policy in the database. That key must never be pasted into a chat,
committed, or placed anywhere under web/. Put the values in a file, run this,
then delete the file.

    # r2-migrate.env  — DELETE THIS FILE WHEN YOU ARE DONE
    SUPABASE_URL=https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...
    R2_ACCOUNT_ID=...
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_BUCKET=flyp-media
    R2_PUBLIC_BASE=https://<your r2.dev or cdn domain>

    python tools/copy_media_to_r2.py --env r2-migrate.env            # dry run
    python tools/copy_media_to_r2.py --env r2-migrate.env --copy     # do it
    del r2-migrate.env

────────────────────────────────────────────────────────────────────────────
WHAT IT DOES, AND DELIBERATELY DOES NOT DO
────────────────────────────────────────────────────────────────────────────
Does:
  1. walks every object in the Supabase `videos` bucket
  2. copies each to R2 under the same path, with the year-long Cache-Control
     that lets Cloudflare's edge hold it
  3. verifies the copy by asking R2 for the object's size
  4. writes a media_objects row so storage_used_bytes() counts it
  5. writes r2_url_rewrite.sql — the statements that repoint the database

Does NOT:
  * rewrite any URL itself. That is emitted as SQL for you to read and run.
    A bad prefix replacement across five columns is not something to discover
    afterwards.
  * delete anything from Supabase. Only after you have run the SQL, opened the
    app, and seen video actually play should you come back with
    --delete-source.

Safe to re-run. Copies are skipped when R2 already holds an object of the same
size, and ledger rows upsert on (bucket, key).
"""

import argparse
import datetime
import functools
import hashlib
import hmac
import os
import sys
import urllib.parse

try:
    import requests
except ImportError:
    sys.exit("This needs `requests`:  python -m pip install requests")

# Python buffers stdout when it is redirected to a file, and this job prints
# roughly 5 KB in total — less than one buffer — so a redirected run showed
# NOTHING at all until it exited. For a job that moves hundreds of megabytes
# over several minutes, "no output" and "hung" look identical.
print = functools.partial(print, flush=True)  # noqa: A001


# ── The five columns that can hold a videos-bucket URL ──
# Found by reading the schema, not by guessing. Missing one leaves media that
# silently stops loading:
#   videos.video_url / .thumbnail   the clip and its poster
#   sounds.audio_url / .cover_url   createOriginalSound() copies the video's
#                                   own URL into the sound row it makes for
#                                   every public post
#   live_streams.thumbnail          uploadLiveThumbnail() files live covers in
#                                   the videos bucket, because its policy was
#                                   already the right shape
#
# avatars, group-photos and chat-media are NOT here on purpose: those buckets
# stay on Supabase for now.
URL_COLUMNS = [
    ("videos", "video_url"),
    ("videos", "thumbnail"),
    ("sounds", "audio_url"),
    ("sounds", "cover_url"),
    ("live_streams", "thumbnail"),
]

CACHE_CONTROL = "public, max-age=31536000, immutable"


# ─────────────────────────── SigV4 ───────────────────────────
# R2 speaks S3, which means AWS Signature Version 4. Written out rather than
# pulled from boto3 so this script has no dependency beyond requests.

def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def r2_request(cfg, method, key, body=b"", extra_headers=None):
    """One signed request to R2. Returns the requests.Response."""
    host = f"{cfg['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    # Each path segment is escaped, but the slashes between them are not —
    # getting this wrong makes every signature mismatch for nested keys only,
    # which is a miserable thing to debug.
    canonical_uri = "/" + cfg["R2_BUCKET"] + "/" + "/".join(
        urllib.parse.quote(seg, safe="") for seg in key.split("/")
    )

    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    for k, v in (extra_headers or {}).items():
        headers[k.lower()] = v

    signed_names = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_request = "\n".join(
        [method, canonical_uri, "", canonical_headers, signed_names, payload_hash]
    )

    scope = f"{date_stamp}/auto/s3/aws4_request"
    to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])

    k_date = _sign(("AWS4" + cfg["R2_SECRET_ACCESS_KEY"]).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, "auto")
    k_service = _sign(k_region, "s3")
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={cfg['R2_ACCESS_KEY_ID']}/{scope}, "
        f"SignedHeaders={signed_names}, Signature={signature}"
    )

    return requests.request(
        method, f"https://{host}{canonical_uri}",
        headers=headers, data=body, timeout=180,
    )


# ─────────────────────── Supabase helpers ───────────────────────

def sb_headers(cfg):
    return {
        "apikey": cfg["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": "Bearer " + cfg["SUPABASE_SERVICE_ROLE_KEY"],
    }


def list_bucket(cfg, bucket, prefix=""):
    """Every object under `prefix`, recursing into folders.

    Supabase's list endpoint is one level at a time and marks folders by
    returning them with a null id, so this has to walk the tree itself.
    """
    out = []
    offset = 0
    while True:
        r = requests.post(
            f"{cfg['SUPABASE_URL']}/storage/v1/object/list/{bucket}",
            headers={**sb_headers(cfg), "Content-Type": "application/json"},
            json={"prefix": prefix, "limit": 100, "offset": offset,
                  "sortBy": {"column": "name", "order": "asc"}},
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break

        for row in rows:
            name = row.get("name")
            if not name:
                continue
            path = f"{prefix}{name}" if prefix else name
            if row.get("id") is None:
                out.extend(list_bucket(cfg, bucket, path + "/"))
            else:
                size = ((row.get("metadata") or {}).get("size")) or 0
                mime = ((row.get("metadata") or {}).get("mimetype")) or "application/octet-stream"
                out.append({"path": path, "size": int(size), "mime": mime})

        if len(rows) < 100:
            break
        offset += len(rows)
    return out


def owner_of(path):
    """videos/<user_id>/<file> — the owner is the first folder, the same rule
    the Supabase storage policies used."""
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else None


# ───────────────────────────── main ─────────────────────────────

def load_env(path):
    cfg = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, help="file holding the keys")
    ap.add_argument("--copy", action="store_true", help="actually copy (default is a dry run)")
    ap.add_argument("--delete-source", action="store_true",
                    help="remove the Supabase copies. ONLY after the SQL is run and video plays.")
    ap.add_argument("--bucket", default="videos")
    args = ap.parse_args()

    cfg = load_env(args.env)
    required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "R2_ACCOUNT_ID",
                "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        sys.exit("Missing from the env file: " + ", ".join(missing))

    cfg["SUPABASE_URL"] = cfg["SUPABASE_URL"].rstrip("/")
    cfg["R2_PUBLIC_BASE"] = cfg["R2_PUBLIC_BASE"].rstrip("/")

    old_prefix = f"{cfg['SUPABASE_URL']}/storage/v1/object/public/{args.bucket}/"
    new_prefix = f"{cfg['R2_PUBLIC_BASE']}/{args.bucket}/"

    print(f"Listing the `{args.bucket}` bucket ...")
    objects = list_bucket(cfg, args.bucket)
    total = sum(o["size"] for o in objects)
    print(f"  {len(objects)} objects, {total / 1048576:.1f} MB\n")

    if not args.copy:
        for o in objects[:15]:
            print(f"  {o['size'] / 1048576:7.2f} MB  {o['path']}")
        if len(objects) > 15:
            print(f"  ... and {len(objects) - 15} more")
        print("\nDry run. Re-run with --copy to move these.")
        print(f"URLs would change:\n  from {old_prefix}...\n  to   {new_prefix}...")
        return

    copied = skipped = failed = 0
    ledger = []

    for i, obj in enumerate(objects, 1):
        path, key = obj["path"], f"{args.bucket}/{obj['path']}"
        label = f"[{i}/{len(objects)}] {path}"

        # Idempotent: an object already in R2 at the right size is left alone,
        # so re-running after an interruption resumes rather than restarts.
        head = r2_request(cfg, "HEAD", key)
        if head.status_code == 200 and int(head.headers.get("content-length", 0)) == obj["size"]:
            print(f"{label} — already there, skipping")
            skipped += 1
            ledger.append((key, obj, int(head.headers["content-length"])))
            continue

        dl = requests.get(
            f"{cfg['SUPABASE_URL']}/storage/v1/object/{args.bucket}/{urllib.parse.quote(path)}",
            headers=sb_headers(cfg), timeout=300,
        )
        if not dl.ok:
            print(f"{label} — DOWNLOAD FAILED {dl.status_code}")
            failed += 1
            continue

        put = r2_request(cfg, "PUT", key, dl.content, {
            "content-type": obj["mime"],
            "cache-control": CACHE_CONTROL,
        })
        if not put.ok:
            print(f"{label} — UPLOAD FAILED {put.status_code} {put.text[:160]}")
            failed += 1
            continue

        # Verified by asking R2, not by trusting the 200. A truncated upload
        # that still answers OK would otherwise be recorded at the wrong size
        # and quietly corrupt the ceiling this whole exercise protects.
        check = r2_request(cfg, "HEAD", key)
        actual = int(check.headers.get("content-length", 0)) if check.ok else 0
        if actual != obj["size"]:
            print(f"{label} — SIZE MISMATCH: expected {obj['size']}, R2 has {actual}")
            failed += 1
            continue

        print(f"{label} — copied {actual / 1048576:.2f} MB")
        copied += 1
        ledger.append((key, obj, actual))

    # ── The ledger ──
    # Without these rows the bytes are invisible to storage_used_bytes(), which
    # is the exact blindness this migration exists to avoid.
    rows = []
    for key, obj, size in ledger:
        owner = owner_of(obj["path"])
        if not owner:
            print(f"  ! {key} is not under a user folder — no ledger row, it will not be counted")
            continue
        rows.append({
            "bucket": args.bucket, "key": key, "user_id": owner,
            "size_bytes": size, "content_type": obj["mime"], "status": "stored",
        })

    if rows:
        r = requests.post(
            f"{cfg['SUPABASE_URL']}/rest/v1/media_objects",
            headers={**sb_headers(cfg), "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows, timeout=120,
        )
        if r.ok:
            print(f"\nLedger: {len(rows)} rows recorded.")
        else:
            print(f"\n!! LEDGER WRITE FAILED {r.status_code}: {r.text[:300]}")
            print("   The files are in R2 but the quota cannot see them. Fix this before")
            print("   running the SQL below — an uncounted bucket is the failure mode")
            print("   0062 was written to prevent.")

    # ── The SQL, for a human to read ──
    sql_path = "r2_url_rewrite.sql"
    with open(sql_path, "w", encoding="utf-8") as fh:
        fh.write("-- Generated by tools/copy_media_to_r2.py\n")
        fh.write("-- Repoints stored URLs from Supabase Storage to R2.\n")
        fh.write("-- Run only after the copy reported no failures.\n")
        fh.write("--\n-- Reversible: swap the two strings in each replace() and run again.\n\n")
        fh.write("begin;\n\n")
        for table, col in URL_COLUMNS:
            fh.write(f"update public.{table}\n")
            fh.write(f"   set {col} = replace({col}, '{old_prefix}', '{new_prefix}')\n")
            fh.write(f" where {col} like '{old_prefix}%';\n\n")
        fh.write("commit;\n\n")

        # ONE query, not five. The Supabase SQL editor displays only the LAST
        # statement's result, so five separate selects would show a single
        # count and silently hide the other four — the same trap 0058 hit.
        #
        # The verification also comes AFTER the commit rather than before it.
        # The editor runs the whole file as one batch, so a check placed inside
        # the transaction cannot prevent anything: it commits either way. What
        # makes that acceptable is that the update is reversible — swap the two
        # strings and run it again — so the honest design is "apply, then
        # prove", not a check that only looks like a gate.
        fh.write("-- Verify. One query on purpose: the Supabase SQL editor shows\n")
        fh.write("-- only the LAST statement's result, so separate selects would\n")
        fh.write("-- report one column and hide the rest.\n")
        fh.write("-- Every still_on_supabase must be 0, and now_on_r2 should\n")
        fh.write("-- account for every row that had a URL.\n")
        parts = []
        for table, col in URL_COLUMNS:
            parts.append(
                f"select '{table}.{col}' as column_name,\n"
                f"       count(*) filter (where {col} like '{old_prefix}%') as still_on_supabase,\n"
                f"       count(*) filter (where {col} like '{new_prefix}%') as now_on_r2\n"
                f"  from public.{table}"
            )
        fh.write("\nunion all\n".join(parts))
        fh.write("\n order by 1;\n")

    print(f"\ncopied {copied}, skipped {skipped}, failed {failed}")
    print(f"Wrote {sql_path} — read it, then run it in the Supabase SQL editor.")

    if failed:
        print("\n!! Some objects failed. Do NOT run the SQL yet: it would repoint")
        print("   rows at files that are not in R2. Re-run this script first;")
        print("   it resumes and skips what already copied.")

    if args.delete_source:
        if failed:
            sys.exit("\nRefusing to delete the source while anything has failed.")
        print("\nDeleting the Supabase copies ...")
        for obj in objects:
            d = requests.delete(
                f"{cfg['SUPABASE_URL']}/storage/v1/object/{args.bucket}/{urllib.parse.quote(obj['path'])}",
                headers=sb_headers(cfg), timeout=60,
            )
            print(("  removed " if d.ok else f"  FAILED {d.status_code} ") + obj["path"])


if __name__ == "__main__":
    main()
