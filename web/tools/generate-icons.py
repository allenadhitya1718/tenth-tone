"""Generate every app icon from one source logo.

Replaces the previous version, which DREW the old FLYP icon from
scratch (purple gradient plus a letter T) and took no input. This one takes
the real FLYP logo and produces every size the project needs.

Usage:
    python web/tools/generate-icons.py [source.png]

Default source: resources/flyp-logo-master.png

Writes:
    web/icons/*                       PWA + favicons
    site/assets/*                     marketing site
    android/.../mipmap-*/ic_launcher* Android launcher, all densities
    resources/AppIcon-1024.png        iOS source
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'resources', 'flyp-logo-master.png')

# The logo sits inside a lot of empty space, and the outer rounded-rectangle
# frame is part of the artwork rather than something to keep. These bounds
# were measured on the 1254px master: the waveform starts at x=215 and the
# P ends at x=1050, with the artwork band running y=458..802.
LOCKUP = (215, 458, 1050, 802)

# The icon uses the WAVEFORM ALONE, not the lockup. The app's name already
# appears under the icon on every home screen, so the mark only has to be
# recognisable — which is why Instagram, TikTok and WhatsApp all use a
# wordless symbol. Squeezed into 32px the "FLYP" text was an unreadable
# smudge, while the waveform keeps its silhouette at every size and survives
# Android cropping it to a circle.
#
# The waveform runs to x=545; the F of FLYP starts around x=575, so the right
# edge has to stay under 566 or a sliver of the letter creeps in.
MARK = (215, 458, 545, 802)
MARK_MARGIN = 24          # a little real artwork around the mark
MARK_RIGHT_LIMIT = 566    # keeps the F out

# Android crops adaptive icons to a circle or squircle and only the middle
# ~66% is guaranteed to survive. The foreground layer therefore needs much
# more padding than the plain icon does.
PAD_STANDARD = 0.30    # 'roomy' — the chosen framing
PAD_ADAPTIVE = 0.42


def squared(im, box, pad_ratio, size, bg):
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    side = int(max(cw, ch) * (1 + pad_ratio * 2))
    canvas = Image.new('RGBA', (side, side), bg)
    canvas.paste(im.crop(box), ((side - cw) // 2, (side - ch) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def marked(im, pad_ratio, size):
    """The waveform, padded by extending its own edges outward.

    Padding with a flat colour leaves a visible seam. The master is not flat:
    it is a dark blue gradient inside a glowing frame, so a fill sampled from
    the corner (0, 4, 33) does not match the (5, 26, 109) sitting right beside
    the mark, and the join shows as a rectangle around the artwork.

    Cropping a wider square from the real artwork would avoid that, but the
    mark is not centred in the logo — anything roomy enough reaches the F.

    So the outermost rows and columns are stretched outward instead. The
    padding then follows the artwork's own gradient and cannot seam, and a
    gentle blur hides the streaking that stretching produces. The mark itself
    is pasted back on top untouched.
    """
    x0, y0, x1, y1 = MARK
    src = im.crop((x0 - MARK_MARGIN, y0 - MARK_MARGIN,
                   min(x1 + MARK_MARGIN, MARK_RIGHT_LIMIT), y1 + MARK_MARGIN))
    cw, ch = src.size
    side = int(max(cw, ch) * (1 + pad_ratio * 2))
    canvas = Image.new('RGB', (side, side))
    ox, oy = (side - cw) // 2, (side - ch) // 2

    left = src.crop((0, 0, 1, ch)).resize((ox, ch), Image.NEAREST)
    right = src.crop((cw - 1, 0, cw, ch)).resize((side - ox - cw, ch), Image.NEAREST)
    canvas.paste(left, (0, oy))
    canvas.paste(right, (ox + cw, oy))
    canvas.paste(src.convert('RGB'), (ox, oy))
    top = canvas.crop((0, oy, side, oy + 1)).resize((side, oy), Image.NEAREST)
    canvas.paste(top, (0, 0))
    bottom = canvas.crop((0, oy + ch - 1, side, oy + ch)).resize((side, side - oy - ch), Image.NEAREST)
    canvas.paste(bottom, (0, oy + ch))

    out = canvas.filter(ImageFilter.GaussianBlur(18))
    out.paste(src.convert('RGB'), (ox, oy))
    return out.resize((size, size), Image.LANCZOS).convert('RGBA')


def write(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.convert('RGB').save(path)
    print('  ', os.path.relpath(path, ROOT))


def main():
    if not os.path.exists(SRC):
        sys.exit('source not found: ' + SRC)

    im = Image.open(SRC).convert('RGBA')
    bg = im.convert('RGB').getpixel((6, 6)) + (255,)
    print('source:', os.path.relpath(SRC, ROOT), im.size, 'background', bg[:3])

    def icon(size, pad=PAD_STANDARD):
        # PAD_STANDARD is the "roomy" framing that was chosen; the adaptive
        # sizes pass their own, larger value because Android crops them.
        return marked(im, pad, size)

    print('web/icons:')
    web = os.path.join(ROOT, 'web', 'icons')
    write(icon(192), os.path.join(web, 'icon-192.png'))
    write(icon(512), os.path.join(web, 'icon-512.png'))
    # Maskable icons are cropped by the launcher, so keep the art well inside.
    write(icon(512, PAD_ADAPTIVE), os.path.join(web, 'icon-512-maskable.png'))
    write(icon(180), os.path.join(web, 'apple-touch-icon.png'))
    write(icon(167), os.path.join(web, 'apple-touch-icon-167.png'))
    write(icon(152), os.path.join(web, 'apple-touch-icon-152.png'))
    write(icon(32), os.path.join(web, 'favicon-32.png'))
    write(icon(16), os.path.join(web, 'favicon-16.png'))

    print('site/assets:')
    site = os.path.join(ROOT, 'site', 'assets')
    write(icon(512), os.path.join(site, 'app-icon.png'))
    write(icon(180), os.path.join(site, 'apple-touch-icon.png'))
    write(icon(32), os.path.join(site, 'favicon-32.png'))
    icon(32).convert('RGB').save(os.path.join(ROOT, 'site', 'favicon.ico'),
                                 sizes=[(16, 16), (32, 32)])
    print('   site/favicon.ico')
    icon(32).convert('RGB').save(os.path.join(ROOT, 'web', 'favicon.ico'),
                                 sizes=[(16, 16), (32, 32)])
    print('   web/favicon.ico')

    print('android launcher:')
    # mdpi is the 1x baseline; the rest are the standard Android multipliers.
    densities = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
    for name, px in densities.items():
        d = os.path.join(res, 'mipmap-' + name)
        write(icon(px), os.path.join(d, 'ic_launcher.png'))

        # Round variant: same art, circular mask.
        r = icon(px, PAD_ADAPTIVE)
        mask = Image.new('L', (px, px), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, px - 1, px - 1), fill=255)
        rounded = Image.new('RGB', (px, px), bg[:3])
        rounded.paste(r.convert('RGB'), (0, 0), mask)
        write(rounded, os.path.join(d, 'ic_launcher_round.png'))

        # Foreground layer for adaptive icons is rendered at 108dp against a
        # separate background colour, and the outer ~18dp is cropped away.
        write(icon(int(px * 108 / 48), PAD_ADAPTIVE),
              os.path.join(d, 'ic_launcher_foreground.png'))

    print('ios source:')
    write(icon(1024), os.path.join(ROOT, 'resources', 'AppIcon-1024.png'))

    print('\ndone')


if __name__ == '__main__':
    main()
