// Shapes shared across src/api modules. Column names follow the database
// (snake_case), as returned by PostgREST, so rows pass through unmapped.

export type Uuid = string;
export type Iso = string;

// The person shown on a card, row or bubble.
export type UserSummary = {
  id: Uuid;
  name: string | null;
  handle: string | null;
  avatar_url: string | null;
  verified?: boolean | null;
};

export type Privacy = 'public' | 'followers' | 'private';

// A video as the feed, grids and the player use it. The viewer-relative
// fields (liked, saved, following) are filled in by the API, never stored.
export type Video = {
  id: Uuid;
  description: string | null;
  music: string | null;
  sound_id: Uuid | null;
  video_url: string | null;
  thumbnail: string | null;
  privacy: Privacy | string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  views_count: number;
  created_at: Iso;
  is_draft?: boolean;
  pinned?: boolean | null;
  allow_comments?: boolean | null;
  allow_saving?: boolean | null;
  user: UserSummary | null;
  liked?: boolean;
  saved?: boolean;
  following?: boolean;
};

export type Page = { limit?: number; offset?: number };

// Realtime subscriptions return this; call it on unmount.
export type Unsubscribe = () => void;
