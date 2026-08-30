# Deploy to Vercel — FLYP PWA

This is the static PWA version (HTML/CSS/JS). Two paths — pick one.

## Path 1 — Drag & drop (no CLI, ~2 minutes)

1. Go to **https://vercel.com/new** (sign up free with GitHub/Google/email).
2. Click **"Import Third-Party Git Repository"** is too much — instead scroll down or click **"Deploy"** at top right and choose **"Browse"** to upload a folder.
   - Easiest: zip the `social-app/` folder, then drop the zip on https://vercel.com/new
3. Project name: `flyp` (or whatever)
4. Framework Preset: **Other** (Vercel will detect the static site)
5. Click **Deploy**.
6. Done. Vercel gives you a URL like `https://flyp-xxxx.vercel.app`.

That URL is HTTPS — you can install it as a PWA on your iPhone via Safari → Share → Add to Home Screen.

## Path 2 — CLI (recommended for repeated deploys)

```powershell
# In PowerShell or Git Bash, from the social-app folder:
cd C:\Users\Syed\Desktop\social-app
npx vercel
```

First run prompts:
1. **Set up and deploy?** → **Y**
2. **Which scope?** → pick your account
3. **Link to existing project?** → **N**
4. **What's your project name?** → `flyp` (or anything)
5. **In which directory is your code located?** → `./`
6. **Want to modify settings?** → **N**

It builds and gives you a preview URL. Then for production:

```bash
npx vercel --prod
```

That gives you the production URL (e.g. `https://flyp.vercel.app`).

## Path 3 — GitHub auto-deploy (best long-term)

1. Push the repo to GitHub (say "push to github" and I'll do it).
2. On Vercel: **Add New** → **Project** → **Import Git Repository** → pick the repo.
3. Every push to `main` auto-deploys. Every PR gets its own preview URL.

## What's already configured

The `vercel.json` in the project root sets:
- ✅ Cache-Control: `no-cache` for `sw.js` (so updates work)
- ✅ Cache-Control: `immutable, max-age=1y` for icons/CSS/JS
- ✅ Manifest served with proper `Content-Type`
- ✅ Security headers (CSP-lite, no clickjacking)
- ✅ Permissions-Policy for camera/mic/geolocation (PWA needs)
- ✅ Pretty URLs: `/admin` rewrites to `/admin.html`

## URLs after deployment

Assuming your Vercel URL is `https://flyp.vercel.app`:

| Path | What |
| --- | --- |
| `/` | Mobile app (PWA) |
| `/admin` | Admin dashboard |
| `/manifest.json` | PWA manifest |
| `/sw.js` | Service worker |

## Custom domain

If you have a domain (or buy one — Vercel sells `.com` for ~$10/yr or you can use Cloudflare Registrar for cheaper):

1. Vercel project → **Settings** → **Domains**
2. Enter your domain (e.g. `flyp-sa.com`)
3. Vercel shows DNS records to add at your registrar (A or CNAME)
4. Wait 5–60 min for DNS propagation; HTTPS auto-issued via Let's Encrypt

## Updating after first deploy

```bash
# Edit files locally, then:
cd C:\Users\Syed\Desktop\social-app
npx vercel --prod
```

Or if connected via GitHub: just `git push`.
