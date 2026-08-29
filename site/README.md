# Tenth Tone marketing site

Plain HTML, one stylesheet, one script. No build step needed to deploy. Upload the
folder as-is to any static host (Cloudflare Pages, Netlify, Hostinger, GitHub Pages).

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home. Hero, platform cards, three feature rows, safety, FAQ, final call |
| `download.html` | The download page. Platform cards, what happens after install, requirements |
| `safety.html` | Safety centre. Every control, where it lives, guidance for parents |
| `help.html` | Help centre. Grouped questions and answers |
| `about.html` | About, what we believe, how the app makes money |
| `contact.html` | Which address to write to for what |
| `guidelines.html` | Community guidelines. Referenced by the terms |
| `privacy.html` | Privacy policy. Required by both app stores |
| `terms.html` | Terms of use |
| `copyright.html` | Copyright and trademark complaints, and disputes |
| `law-enforcement.html` | For authorities. Not linked from the main navigation |
| `404.html` | Not found |

## Before you publish

Everything still to be filled in is **highlighted in yellow** on the page, so open
each page once and look for the highlights. There are two groups.

**1. Company details** in `_build/p_privacy.py`, `_build/p_terms.py`, `_build/p_rules.py`,
or directly in the generated HTML:

- `[COMPANY LEGAL NAME]` / `[الاسم القانوني للشركة]`
- `[REGISTERED ADDRESS]` / `[العنوان المسجل]`
- `[COUNTRY AND COURTS]` / `[الدولة والمحكمة المختصة]` — the governing law in the terms
- The email addresses: `support@`, `privacy@`, `legal@`, `copyright@`, `press@`, `business@`

App store review checks that the privacy policy names a real controller and a
working contact address, so these cannot stay as placeholders.

**2. Store links** at the top of `site.js`:

```js
var STORE = {
  ios: '',      // paste the App Store URL here
  android: '',  // paste the Google Play URL here
  web: ''       // paste the web app address here
};
```

While a value is empty its button reads "Coming soon" and does not navigate, so the
page never carries a dead link. Fill one in and that button goes live immediately.

Also update the domain in `robots.txt` and `sitemap.xml` (currently `tenthtone.com`).

## Images

`assets/clip-*.jpg` and `assets/av-*.jpg` are **placeholders** from Lorem Picsum.
They stand in for real clips and avatars. Swap them for real content when you have it,
keeping the same filenames so nothing else needs editing:

- `clip-1` to `clip-4` are portrait, used inside the phone mockups and the profile grid
- `clip-5` is landscape, used in the feature row and on the About page
- `clip-2` is also the hero photo, so replace that one first
- `av-1` and `av-2` are square avatars

The phone screens themselves are not screenshots. They are built in HTML and CSS from
the app's own design, so they stay sharp at any size and update by editing markup.

## Languages

Arabic is the default. The AR / EN switch in the header and footer changes the language
and the page direction, and the choice is remembered in the browser.

Short strings carry both languages on the element itself:

```html
<h3 data-ar="حساب خاص" data-en="Private account">حساب خاص</h3>
```

Long documents keep one full block per language instead:

```html
<div class="doc-in" data-block="ar"> ... </div>
<div class="doc-in" data-block="en"> ... </div>
```

If you add text, add both versions. The English page must contain no Arabic characters
and the Arabic page no untranslated English.

## Editing

The header and footer are repeated in every file, so a change to either means editing
all twelve. The scripts in `_build/` generate the pages and keep them consistent:

```bash
cd _build && python pages_main.py && python p_privacy.py && python p_terms.py && python p_rules.py && python p_support.py
```

**If you edit the `.html` files by hand, do not run those scripts afterwards** — they
would overwrite your changes. Pick one approach and stay with it.

After editing `site.css` or `site.js`, bump `CSSV` / `JSV` in `_build/build_site.py`
and regenerate, or change `?v=3` by hand in every page, so browsers do not serve a
stale copy.
