import { ApiError, requireUid, supabase } from '@/api/client';
import { checkText } from '@/api/moderation';
import type { Privacy, Uuid } from '@/api/types';

export type DraftEdit = {
  description: string;
  privacy: Privacy;
  allow_comments: boolean;
  allow_saving: boolean;
};

// Client note 2: edit a saved draft's caption and settings before posting.
// The clip itself was screened when the draft was saved; a new caption is
// screened here as text, the same check a caption gets on publish, so an
// edit cannot slip something past moderation on its way to "Post now".
export async function updateDraft(videoId: Uuid, edit: DraftEdit): Promise<void> {
  const me = await requireUid();
  const description = edit.description.trim();
  const verdict = await checkText('video', description).catch(() => null);
  if (verdict?.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
  const { data, error } = await supabase
    .from('videos')
    .update({
      description,
      privacy: edit.privacy,
      allow_comments: edit.allow_comments,
      allow_saving: edit.allow_saving,
    })
    .eq('id', videoId)
    .eq('user_id', me)
    .eq('is_draft', true)
    .select('id');
  if (error) throw error;
  if (!data || !data.length) throw new ApiError('draft_update_failed');
}
