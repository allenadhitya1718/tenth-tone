// Location sharing, the friends map, location permits and their realtime
// feed. Port of the Locations and Location Permits sections of web/js/db.js.
//
// Location is the most sensitive thing the app stores. Three rules hold
// throughout, and the database enforces them too (0032, 0077):
//   * sharing is consented: nothing is readable unless sharing_enabled is on
//   * it is visibility-scoped: 'public', 'friends' (people who follow you)
//     or 'none'; blocks hide it in both directions
//   * only the current position is kept: one row per user, overwritten on
//     every fix, unreadable after 8 hours and deleted after 7 days. The
//     privacy policy promises this, so never add a history table here.
//
// This module takes coordinates as parameters. Reading the device position
// (expo-location, permission prompts, background updates) belongs to the
// screen or a hook, not here.
//
// TODO(client note 27): follow-a-friend and directions on the map.
//
// ApiError codes introduced in this file:
//   note_blocked, note_too_long, not_sharing (setLocationNote, 0154)
import type { PostgrestError, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { ApiError, must, requireUid, supabase, uid, listenerTopic } from './client';
import type { Iso, Unsubscribe, UserSummary, Uuid } from './types';

export const locationKeys = {
  all: () => ['location'] as const,
  settings: () => ['location', 'settings'] as const,
  friends: () => ['location', 'friends'] as const,
  tracked: () => ['location', 'tracked'] as const,
  incomingPermits: () => ['location', 'permits', 'incoming'] as const,
  permit: (targetUserId: string) => ['location', 'permits', targetUserId] as const,
};

export type LocationVisibility = 'public' | 'friends' | 'none';

// public.user_locations. lat/lng/accuracy are null once sharing stops: a
// trigger blanks them whenever sharing_enabled is false or visibility is
// 'none'.
export type UserLocationRow = {
  user_id: Uuid;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  visibility: LocationVisibility;
  sharing_enabled: boolean;
  updated_at: Iso;
  // 0154: a short note shown with the pin; null before 0154 is applied.
  note?: string | null;
  note_at?: Iso | null;
};

type LocationPerson = Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'>;

export type FriendLocation = {
  user_id: Uuid;
  lat: number;
  lng: number;
  updated_at: Iso;
  visibility: LocationVisibility;
  sharing_enabled: boolean;
  note?: string | null;
  note_at?: Iso | null;
  profiles: LocationPerson | null;
};

export type TrackedLocation = {
  user_id: Uuid;
  lat: number | null;
  lng: number | null;
  updated_at: Iso;
  note?: string | null;
  note_at?: Iso | null;
  profiles: LocationPerson | null;
};

export type LocationSettings = {
  sharing_enabled: boolean;
  visibility: LocationVisibility;
  note?: string | null;
  note_at?: Iso | null;
};

/** How long a note shows on the map after it was set. */
export const LOCATION_NOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const LOCATION_NOTE_MAX = 80;

/** The note to show, or null once it is a day old. */
export function liveNote(row: { note?: string | null; note_at?: Iso | null }): string | null {
  if (!row.note || !row.note_at) return null;
  return Date.now() - new Date(row.note_at).getTime() < LOCATION_NOTE_MAX_AGE_MS ? row.note : null;
}

// Until 0154 is applied the note columns do not exist (42703): read without
// them, so the map keeps working on an older database.
async function withNoteFallback<T>(
  run: (withNote: boolean) => PromiseLike<{ data: T; error: PostgrestError | null }>,
): Promise<{ data: T; error: PostgrestError | null }> {
  const res = await run(true);
  if (res.error?.code === '42703') return run(false);
  return res;
}

export type PermitStatus = 'pending' | 'approved' | 'denied' | 'revoked';

// public.location_permits
export type LocationPermitRow = {
  id: Uuid;
  requester_id: Uuid;
  target_id: Uuid;
  status: PermitStatus;
  created_at: Iso;
  responded_at: Iso | null;
  expires_at: Iso | null;
};

export type IncomingPermit = {
  id: Uuid;
  status: PermitStatus;
  created_at: Iso;
  requester: LocationPerson | null;
};

const FRIEND_LOCATION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

// ---------- Locations ----------

export type LocationFix = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  sharing_enabled?: boolean;
  visibility?: LocationVisibility;
};

// Moves the pin. Only coordinates change, and only while sharing is already
// on: update_my_location (0105) returns false and writes nothing otherwise,
// so a late GPS fix can never switch sharing back on or reset a 'public'
// choice to 'friends' (the web app's full upsert did both). Turning sharing
// on and choosing visibility go through setLocationSharing /
// setLocationVisibility. Returns whether the fix was stored.
export async function upsertLocation({ lat, lng, accuracy }: LocationFix): Promise<boolean> {
  await requireUid();
  const { data, error } = await supabase.rpc('update_my_location', {
    p_lat: lat,
    p_lng: lng,
    p_accuracy: accuracy ?? null,
  });
  if (error) throw error;
  return data === true;
}

// The two flags the settings screen needs, so the switch shows the stored
// state instead of always starting at off.
export async function fetchMyLocationSettings(): Promise<LocationSettings> {
  const me = await uid();
  if (!me) return { sharing_enabled: false, visibility: 'friends' };
  // A failed read is not consent withdrawn. Collapsing the two meant a
  // transient error silently revoked sharing, so the error is thrown.
  const data = must(
    await withNoteFallback((withNote) =>
      supabase
        .from('user_locations')
        .select(withNote ? 'sharing_enabled, visibility, note, note_at' : 'sharing_enabled, visibility')
        .eq('user_id', me)
        .maybeSingle<Pick<UserLocationRow, 'sharing_enabled' | 'visibility' | 'note' | 'note_at'>>(),
    ),
  );
  if (!data) return { sharing_enabled: false, visibility: 'friends' };
  return {
    sharing_enabled: !!data.sharing_enabled,
    visibility: data.visibility || 'friends',
    note: data.note ?? null,
    note_at: data.note_at ?? null,
  };
}

// 0154: the note friends see with my pin. Empty clears it. The server trims
// it, runs the comment word filter and refuses it unless I am sharing.
export async function setLocationNote(note: string): Promise<void> {
  await requireUid();
  const { error } = await supabase.rpc('set_location_note', { p_note: note.trim() });
  if (!error) return;
  const msg = error.message ?? '';
  for (const code of ['note_blocked', 'note_too_long', 'not_sharing'] as const) {
    if (msg.includes(code)) throw new ApiError(code, msg);
  }
  throw error;
}

// The master switch. Setting visibility alone left sharing_enabled false,
// which the read policy requires, so the switch reported success while
// nobody could actually see you.
export async function setLocationSharing(on: boolean): Promise<void> {
  const me = await requireUid();
  if (!on) return stopSharingLocation();
  const current = await fetchMyLocationSettings();
  must(
    await supabase.from('user_locations').upsert(
      {
        user_id: me,
        sharing_enabled: true,
        // 'none' would contradict the switch being on, so fall back to friends.
        visibility: current.visibility === 'none' ? 'friends' : current.visibility,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
  );
}

export async function setLocationVisibility(visibility: LocationVisibility): Promise<void> {
  const me = await requireUid();
  if (visibility === 'none') return stopSharingLocation();
  must(
    await supabase
      .from('user_locations')
      .upsert({ user_id: me, visibility, updated_at: new Date().toISOString() }),
  );
}

// Clears the stored coordinates rather than only flipping a flag: a position
// nobody can see is still a position being kept.
export async function stopSharingLocation(): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.rpc('stop_sharing_location');
  if (!error) return;
  // Before 0032 the function does not exist; blank the row directly.
  await supabase.from('user_locations').upsert({
    user_id: me,
    visibility: 'none',
    sharing_enabled: false,
    lat: null,
    lng: null,
    accuracy: null,
    updated_at: new Date().toISOString(),
  });
}

// Positions of the people I follow who share with me. The 8-hour window
// mirrors the read policy, which already refuses older rows.
export async function fetchFriendLocations(): Promise<FriendLocation[]> {
  const me = await uid();
  if (!me) return [];
  const { data: f } = await supabase.from('follows').select('followed_id').eq('follower_id', me);
  const ids = ((f ?? []) as { followed_id: Uuid }[]).map((r) => r.followed_id);
  if (!ids.length) return [];
  const data = must(
    await withNoteFallback((withNote) =>
      supabase
        .from('user_locations')
        .select(
          `
      user_id, lat, lng, updated_at, visibility, sharing_enabled,${withNote ? ' note, note_at,' : ''}
      profiles:profiles!user_locations_user_id_fkey ( id, name, handle, avatar_url )
    `,
        )
        .in('user_id', ids)
        .eq('sharing_enabled', true)
        .gt('updated_at', new Date(Date.now() - FRIEND_LOCATION_MAX_AGE_MS).toISOString()),
    ),
  ) as unknown as (Omit<FriendLocation, 'lat' | 'lng'> & { lat: number | null; lng: number | null })[] | null;
  // A row with no coordinates is someone who has stopped sharing.
  return (data ?? []).filter((r): r is FriendLocation => r.lat != null && r.lng != null);
}

// Every change to user_locations that RLS lets this user see. Unfiltered on
// purpose: the map simply refetches on any event.
export function subscribeToFriendLocations(
  cb: (payload: RealtimePostgresChangesPayload<UserLocationRow>) => void,
): Unsubscribe {
  const channel = supabase
    .channel(listenerTopic('friend-locations'))
    .on<UserLocationRow>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_locations' },
      (payload) => cb(payload),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- Location permits ----------
// A asks B for their location, B approves or denies, A can track until
// either side revokes.
//
// Since 0032 the "locations read" policy no longer has the approved-permit
// clause 0004 added, so an approved permit grants no extra access: tracking
// only shows people whose public/friends sharing already lets you see them.

export async function requestLocationPermit(targetUserId: Uuid): Promise<LocationPermitRow> {
  const me = await requireUid();
  return must(
    await supabase
      .from('location_permits')
      .upsert(
        { requester_id: me, target_id: targetUserId, status: 'pending' },
        { onConflict: 'requester_id,target_id' },
      )
      .select()
      .single<LocationPermitRow>(),
  ) as LocationPermitRow;
}

export async function respondToLocationPermit(
  permitId: Uuid,
  decision: 'approved' | 'denied',
): Promise<void> {
  must(
    await supabase
      .from('location_permits')
      .update({ status: decision, responded_at: new Date().toISOString() })
      .eq('id', permitId),
  );
}

// Revokes in both directions: my permit on them and theirs on me.
export async function revokeLocationPermit(targetUserId: Uuid): Promise<void> {
  // db.js did not check for a session here; with no id the filter matched
  // nothing. Requiring one fails clearly instead.
  const me = await requireUid();
  must(
    await supabase
      .from('location_permits')
      .update({ status: 'revoked', responded_at: new Date().toISOString() })
      .or(
        `and(requester_id.eq.${me},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${me})`,
      ),
  );
}

// My permit on this person, if any. Errors read as "no permit".
export async function fetchPermitStatus(
  targetUserId: Uuid,
): Promise<Pick<LocationPermitRow, 'id' | 'status'> | null> {
  const me = await uid();
  if (!me) return null;
  const { data } = await supabase
    .from('location_permits')
    .select('id,status')
    .eq('requester_id', me)
    .eq('target_id', targetUserId)
    .maybeSingle<Pick<LocationPermitRow, 'id' | 'status'>>();
  return data;
}

// Pending requests for my location, newest first.
export async function fetchIncomingPermits(): Promise<IncomingPermit[]> {
  const me = await uid();
  if (!me) return [];
  const data = must(
    await supabase
      .from('location_permits')
      .select(
        'id, status, created_at, requester:profiles!location_permits_requester_id_fkey(id,name,handle,avatar_url)',
      )
      .eq('target_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ) as unknown as IncomingPermit[] | null;
  return data ?? [];
}

// Positions of the people whose permits I hold and who approved them.
export async function fetchTrackedLocations(): Promise<TrackedLocation[]> {
  const me = await uid();
  if (!me) return [];
  const { data: permits } = await supabase
    .from('location_permits')
    .select('target_id')
    .eq('requester_id', me)
    .eq('status', 'approved');
  const ids = ((permits ?? []) as { target_id: Uuid }[]).map((p) => p.target_id);
  if (!ids.length) return [];
  const data = must(
    await withNoteFallback((withNote) =>
      supabase
        .from('user_locations')
        .select(
          `user_id, lat, lng, updated_at,${withNote ? ' note, note_at,' : ''} profiles:profiles!user_locations_user_id_fkey(id,name,handle,avatar_url)`,
        )
        .in('user_id', ids),
    ),
  ) as unknown as TrackedLocation[] | null;
  return data ?? [];
}
