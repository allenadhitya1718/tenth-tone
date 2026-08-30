# Agora Live Streaming Setup (one-time, ~10 minutes)

The Live Stream feature now uses **Agora.io** for real video broadcasting (host's camera/mic → many viewers).

## Free tier
- **10,000 minutes/month free** for the first 6 months (counts both host + viewer minutes)
- After: $0.99 per 1,000 viewer-minutes (audio+video)
- No credit card required to sign up

## Step 1 — Create an Agora project (5 min)

1. Go to **https://www.agora.io/en/sign-up/** → sign up (free, no credit card)
2. Verify your email and log in
3. You land on the Console: **https://console.agora.io/**
4. Top-left → **Project Management** → **Create**
5. Name: `flyp` · Use case: pick **Social** → **Submit**
6. **Important — choose authentication mechanism:**
   - **For testing / demo:** select **"App ID + Token (Recommended)"** then on the project card click the gear icon → **Edit** → switch to **"App ID"** only (no token). This lets you test without a token server.
   - **For production:** keep the token mechanism on; you'll generate tokens from a Supabase Edge Function (see Step 4 below).
7. **Copy the App ID** — looks like `1234567890abcdef1234567890abcdef` (32 hex chars). You'll paste it in Step 2.

## Step 2 — Add the App ID to your app (1 min)

You have two options:

### Option A — Edit `web/index.html` directly

Find this line near the top of the body scripts:
```html
<script>window.AGORA_APP_ID = '';</script>
```

Replace with:
```html
<script>window.AGORA_APP_ID = 'YOUR_APP_ID_HERE';</script>
```

Commit + push to GitHub → Vercel auto-deploys.

### Option B — Set as Vercel environment variable (cleaner)

1. Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add `AGORA_APP_ID` = your App ID
3. Update `web/index.html` to read it (would need a build step — skip this for now, use Option A)

## Step 3 — Test it (2 min)

1. Open https://tiktok-nu-eosin.vercel.app on **2 phones or browsers** (one host, one viewer)
2. **Phone A (host):**
   - Sign in
   - Tap **+** → **بث مباشر** (Live)
   - Allow camera + microphone permission
   - Tap **بدء البث** — your camera preview appears
3. **Phone B (viewer):**
   - Sign in
   - Tap home tab → **مباشر** at the top → see Phone A's stream → tap to watch
   - You should see Phone A's live video within 2-3 seconds

## Step 4 — Production token server (deferred until launch)

For production, generate tokens via a Supabase Edge Function so users can't share App IDs maliciously:

```typescript
// supabase/functions/agora-token/index.ts
import { serve } from 'https://deno.land/std/http/server.ts'
import { RtcTokenBuilder, RtcRole } from 'https://esm.sh/agora-token@2.0.4'

const APP_ID = Deno.env.get('AGORA_APP_ID')!
const APP_CERT = Deno.env.get('AGORA_APP_CERT')!

serve(async (req) => {
  const { channel, uid, role } = await req.json()
  const expireAt = Math.floor(Date.now() / 1000) + 3600
  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID, APP_CERT, channel, uid,
    role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    expireAt, expireAt
  )
  return new Response(JSON.stringify({ token, expireAt }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
```

Deploy:
```bash
supabase functions deploy agora-token
supabase secrets set AGORA_APP_ID=... AGORA_APP_CERT=...
```

Then in `web/js/agora.js`, replace `null` token with a fetch to this Edge Function.

## Cost estimates

| Scenario | Hours/month | Estimated cost |
| --- | --- | --- |
| Demo / dev | <100 | **Free** |
| Soft launch (50 daily users, 20 min avg) | ~500 hrs | ~$30/month |
| Growing app (1,000 daily users) | ~10,000 hrs | ~$600/month |
| Established (10,000 daily users) | ~100,000 hrs | ~$6,000/month — discounts available |

For Saudi Arabia specifically, Agora has good edge presence in the Middle East — latency is typically <200ms.

## Alternatives if Agora doesn't fit

- **MUX Live** — ~$0.080 per minute of input + $0.012 per minute of output. Better for high-quality (1080p+).
- **LiveKit Cloud** — open source, free tier 100GB egress/month.
- **AWS IVS** — $0.20-0.30 per hour of broadcast + viewer-minutes. Heavy enterprise.

For this codebase, switching providers takes ~2 hours — same architecture (web SDK + token server), just different SDK calls in `web/js/agora.js`.

## Troubleshooting

**Error: "AGORA_APP_ID not configured"**
→ You haven't done Step 2 yet, or the App ID is empty/whitespace.

**Camera preview is black**
→ Browser blocked camera permission. Check Settings → Safari → Camera (iOS) or Chrome → Site settings.

**Viewer sees no video, just background image**
→ Check both host and viewer are using the same Agora App ID. Check the browser console for errors.

**"Access denied" / 403 errors**
→ Your project is in token-required mode but the code sends `null`. Either flip to App ID-only mode in console, or implement Step 4 (token server).

**Stream lags / freezes**
→ Network issue on the host side. Agora needs ~1 Mbps upload for smooth video. Test with `/stats` endpoint or check host's WiFi.
