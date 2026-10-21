// Chat themes (0149_chat_theme.sql): a chat's background, shared by its
// members. set_chat_theme checks membership (and, in a DM, that it is not an
// unanswered request or across a block) and writes a 'system' line, so the
// other side repaints through the thread's live listener.
//
// ApiError codes:
//   needs_update   set_chat_theme is not in the database yet (0149)
//   not_accepted   a DM request they have not answered
//   blocked        a block between you
//   gone           the chat no longer exists, or you are not in it
//   bad_theme / bad_wallpaper_url / photo_failed
import { ApiError, supabase } from './client';
import type { Uuid } from './types';
import { type LocalMedia, uploadToStorage } from './upload';

const KNOWN: Record<string, string> = {
  not_accepted: 'not_accepted',
  blocked: 'blocked',
  not_member: 'gone',
  chat_not_found: 'gone',
  bad_theme: 'bad_theme',
  bad_wallpaper_url: 'bad_wallpaper_url',
};

/**
 * Sets the chat's theme for everyone in it. `theme` null resets to the
 * default; 'photo' needs `photo` (a new picture to upload) or `wallpaperUrl`
 * (the one already set).
 */
export async function setChatTheme(
  chatId: Uuid,
  theme: string | null,
  opts: { photo?: LocalMedia | null; wallpaperUrl?: string | null } = {},
): Promise<void> {
  let url: string | null = null;
  if (theme === 'photo') {
    if (opts.photo) {
      try {
        // The public group-photos bucket, under your own folder (0058), as a
        // group photo is; 0149 accepts only that bucket's URLs.
        url = await uploadToStorage('group-photos', opts.photo, { prefix: 'wallpaper' });
      } catch (e) {
        throw new ApiError('photo_failed', (e as Error)?.message);
      }
    } else {
      url = opts.wallpaperUrl ?? null;
    }
    if (!url) throw new ApiError('bad_wallpaper_url');
  }
  const { error, status } = await supabase.rpc('set_chat_theme', {
    p_chat_id: chatId,
    p_theme: theme,
    p_wallpaper_url: url,
  });
  if (!error) return;
  if (error.code === 'PGRST202' || error.code === '42883' || status === 404) throw new ApiError('needs_update');
  const code = KNOWN[error.message];
  throw code ? new ApiError(code, error.message) : error;
}

/** The i18n key for an error from setChatTheme. */
export function chatThemeErrorKey(e: unknown): string {
  switch (e instanceof ApiError ? e.code : '') {
    case 'needs_update':
      return 'chatTheme.err.needsUpdate';
    case 'not_accepted':
      return 'chatTheme.err.notAccepted';
    case 'blocked':
      return 'chatTheme.err.blocked';
    case 'gone':
      return 'chatTheme.err.gone';
    case 'photo_failed':
      return 'chatTheme.err.photoFailed';
    default:
      return 'chatTheme.err.generic';
  }
}
