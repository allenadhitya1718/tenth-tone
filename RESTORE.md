# How to restore this backup

This zip contains the **complete FLYP project** as of 2026-05-11. Everything needed to recover, deploy, or hand off.

## What's inside

```
Tiktok-BACKUP/
├── README.md, DEMO.md, BACKEND.md, BUILD_IOS.md, ...   ← all docs
├── .git/                          ← FULL git history (every commit)
├── supabase/migrations/            ← 4 SQL migrations + demo seed
├── web/                            ← live PWA (HTML/CSS/JS)
├── flutter/                        ← native Flutter project
├── .github/workflows/              ← CI configs
├── capacitor.config.json           ← iOS/Android wrap config
├── package.json                    ← Capacitor deps
└── vercel.json, codemagic.yaml     ← deploy configs
```

## Restore path 1 — Continue development on a new machine

```bash
# 1. Unzip anywhere, e.g.:
#    C:\Users\YourName\Desktop\Tiktok-restored
# 2. Open Git Bash / Terminal in that folder
cd C:\Users\YourName\Desktop\Tiktok-restored

# 3. Verify git is intact:
git log --oneline | head -5
git status

# 4. Connect to GitHub (already configured):
git remote -v
# → origin  https://github.com/meeranpmo-svg/Tiktok.git

# 5. Pull latest in case GitHub has newer commits:
git pull origin main
```

You're now exactly where you left off. Make changes, commit, push.

## Restore path 2 — Just deploy the PWA

```bash
# Extract web/ folder from this zip
# Drag-drop to:
#   - Vercel:    https://vercel.com/new (drop the folder)
#   - Netlify:   https://app.netlify.com/drop
#   - Hostinger: hPanel → File Manager → public_html → upload
```

No build step needed.

## Restore path 3 — Fresh Supabase backend (new project)

If you start a new Supabase project:

```bash
# 1. Create project at https://supabase.com/dashboard
# 2. Note the new project URL and anon key
# 3. Open web/js/supabase.js and replace:
#      const SUPABASE_URL = 'https://YOUR-NEW.supabase.co'
#      const SUPABASE_ANON_KEY = 'sb_publishable_YOUR_KEY'
# 4. Run migrations in order in SQL Editor:
#      supabase/migrations/0001_init.sql
#      supabase/migrations/0002_admin.sql
#      supabase/migrations/0003_triggers.sql
#      supabase/migrations/0004_permits_blocks.sql
# 5. Optionally seed demo data:
#      supabase/demo_seed.sql
# 6. In Authentication → Providers → Email:
#      - Enable Email provider
#      - Turn off "Confirm email" for fast testing
# 7. In Authentication → URL Configuration:
#      - Site URL: your deployment URL
#      - Redirect URLs: <deployment-url>/**
# 8. Deploy web/ via path 2 above
```

## Restore path 4 — From GitHub (no zip needed)

```bash
git clone https://github.com/meeranpmo-svg/Tiktok.git
```

This is always the most up-to-date source.

## Current state at time of backup

### Live URLs
- **App:** https://tiktok-nu-eosin.vercel.app
- **Admin:** https://tiktok-nu-eosin.vercel.app/admin
- **Repo:** https://github.com/meeranpmo-svg/Tiktok
- **Supabase:** https://supabase.com/dashboard/project/qnzgxihlrwanywndcmpf

### Demo credentials
- **Admin 1:** `khaled@flyp-sa.com` / `khaled1234`
- **Admin 2:** `mohamed_syed2@icloud.com` / `Mohamed1234`

### What's wired (everything except)
- ✅ Auth, profiles, edit, avatars
- ✅ Home feed, real videos, like/save/comment
- ✅ Camera record (MediaRecorder) + upload from gallery
- ✅ Realtime DM + group chat
- ✅ Push-to-talk in chat (hold mic button)
- ✅ Send video clips in DMs
- ✅ Live location + tracking permits (request/approve/deny/revoke)
- ✅ Wallet + atomic gift transactions + TikTok-style float anims
- ✅ Live stream UI (background-only mode + privacy + design)
- ✅ Admin dashboard fully wired to real DB
- ✅ 7-section Settings page
- ✅ All PWA + iOS Capacitor configs
- ⏳ Real live video broadcast — needs Agora/MUX API key (see AGORA_SETUP.md)
- ⏳ Real push notifications — needs VAPID + Apple Developer enrollment

### Git history
The `.git/` directory inside this zip preserves every commit. Run `git log --oneline` to see the full development history.

## If anything's lost or corrupted

The source of truth is **https://github.com/meeranpmo-svg/Tiktok** — fresh clone always works:

```bash
git clone https://github.com/meeranpmo-svg/Tiktok.git
```
