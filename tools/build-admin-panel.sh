#!/usr/bin/env bash
# Builds the admin panel for the NEW backend (web/admin-v2.html, Supabase
# Mumbai) into admin-dist/, for Cloudflare Pages at admin.flyp-sa.com.
#
# Cloudflare Pages project settings:
#   Production branch       feat/rn-phase1-foundation-wzkc56
#   Build command           bash tools/build-admin-panel.sh
#   Build output directory  admin-dist
#
# Only the panel's own files are published, with admin-v2.html as the index.
# The old web app and the old /admin panel (old project) are not part of it.
# The page ships only the publishable key; is_admin() inside the admin_v2_*
# functions (0128) guards every read and write.
set -euo pipefail
cd "$(dirname "$0")/.."

out=admin-dist
rm -rf "$out"
mkdir -p "$out/css" "$out/js/admin-v2" "$out/icons/admin"
cp web/admin-v2.html "$out/index.html"
cp web/css/admin-v2.css "$out/css/"
cp web/js/admin-v2/*.js "$out/js/admin-v2/"
cp web/icons/admin/*.png "$out/icons/admin/"

# Cloudflare Pages headers: never framed, no sniffing, no indexing.
cat > "$out/_headers" <<'EOF'
/*
  X-Frame-Options: DENY
  Content-Security-Policy: frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Robots-Tag: noindex, nofollow
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/index.html
  Cache-Control: no-cache
EOF

# Refuse to publish anything that looks like a server-side key.
if grep -rEl 'service_role|sb_secret_' "$out"; then
  echo 'build-admin-panel: secret-looking key in the bundle, refusing' >&2
  exit 1
fi

echo "build-admin-panel: $(find "$out" -type f | wc -l) files in $out/"
