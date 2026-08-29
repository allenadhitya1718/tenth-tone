/* === Supabase data access layer === */
(function () {
  if (!window.SB) { console.warn('SB not ready, db.js loaded too early'); return; }

  const API = {};

  async function client() { return await window.SB.client(); }
  async function uid() { const u = await window.SB.getUser(); return u ? u.id : null; }

  // ---------- Videos ----------
  API.publishVideo = async ({ file, thumbnail_url, description, music, sound_id = null, privacy = 'public', is_draft = false, allow_comments = true, allow_saving = true }) => {
    const c = await client();
    const userId = await uid();
    if (!userId) throw new Error('not signed in');

    let video_url = null;
    if (file) {
      const q = await API.uploadQuota();
      if (q && !q.allowed) throw new Error(API.quotaMessage(q));
      if (q && q.max_video_bytes && file.size > q.max_video_bytes) {
        throw new Error('حجم الملف كبير جدًا (الحد الأقصى ' + Math.floor(q.max_video_bytes / 1048576) + ' ميجابايت)');
      }
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await c.storage.from('videos').upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = c.storage.from('videos').getPublicUrl(path);
      video_url = pub.publicUrl;
    }

    const { data, error } = await c.from('videos').insert({
      user_id: userId, description: description || '', music: music || null,
      sound_id, video_url, thumbnail: thumbnail_url || video_url, privacy, is_draft,
      allow_comments, allow_saving,
    }).select().single();
    if (error) throw error;

    // Every public post gets an original sound others can reuse - the loop
    // that makes a short-video app work. Skipped when the user picked an
    // existing sound, and for drafts.
    if (!sound_id && !is_draft && data && data.id) {
      try {
        const snd = await API.createOriginalSound({
          videoId: data.id,
          title: 'صوت أصلي',
          coverUrl: thumbnail_url || null,
          audioUrl: video_url || null,
        });
        if (snd && snd.id) {
          await c.from('videos').update({ sound_id: snd.id }).eq('id', data.id);
          data.sound_id = snd.id;
        }
      } catch (e) { console.warn('original sound:', e); } // never block a post
    }
    return data;
  };

  API.fetchFeed = async ({ tab = 'foryou', limit = 20, offset = 0 } = {}) => {
    const c = await client();
    let data = [];

    if (tab === 'foryou') {
      try {
        const p_user_id = await uid();
        const { data: rpcData, error: rpcErr } = await c.rpc('fetch_fyp_feed', { p_limit: limit, p_offset: offset, p_user_id });
        if (!rpcErr && rpcData && rpcData.length) {
          data = rpcData.map(r => ({
            id: r.id,
            description: r.description,
            music: r.music,
            sound_id: r.sound_id,
            video_url: r.video_url,
            thumbnail: r.thumbnail,
            privacy: r.privacy,
            likes_count: r.likes_count,
            comments_count: r.comments_count,
            shares_count: r.shares_count,
            views_count: r.views_count,
            created_at: r.created_at,
            user: {
              id: r.user_id,
              name: r.user_name,
              handle: r.user_handle,
              avatar_url: r.user_avatar_url,
              verified: r.user_verified,
            },
          }));
        }
      } catch (err) {
        console.warn('FYP RPC fallback to standard query:', err);
      }
    }

    if (!data.length) {
      let q = c.from('videos').select(`
        id, description, music, sound_id, video_url, thumbnail, privacy,
        likes_count, comments_count, shares_count, views_count, created_at,
        user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url, verified )
      `).eq('is_draft', false).eq('privacy', 'public').order('created_at', { ascending: false });

      if (tab === 'following') {
        const me = await uid();
        if (!me) return [];
        const { data: f } = await c.from('follows').select('followed_id').eq('follower_id', me);
        const ids = (f || []).map(r => r.followed_id);
        if (!ids.length) return [];
        q = q.in('user_id', ids);
      }

      const { data: fetched, error } = await q.range(offset, offset + limit - 1);
      if (error) throw error;
      data = fetched || [];
    }

    // Mark which videos current user already liked / saved
    const me = await uid();
    if (me && data && data.length) {
      const ids = data.map(v => v.id);
      const [{ data: likes }, { data: saves }] = await Promise.all([
        c.from('likes').select('video_id').eq('user_id', me).in('video_id', ids),
        c.from('saves').select('video_id').eq('user_id', me).in('video_id', ids),
      ]);
      const likeSet = new Set((likes || []).map(r => r.video_id));
      const saveSet = new Set((saves || []).map(r => r.video_id));
      data.forEach(v => { v.liked = likeSet.has(v.id); v.saved = saveSet.has(v.id); });
    }
    return data || [];
  };

  // ---------- Original sounds ----------
  // An "original sound" is the audio of someone's own video. No licensing is
  // involved, which is why this is the only kind of sound the app creates.

  // audioUrl points at the origin video file. Browsers happily play just the
  // audio track of an mp4 through an <audio> element, so this makes the sound
  // playable without extracting a separate audio file.
  API.createOriginalSound = async ({ videoId, title, coverUrl = null, duration = 30, audioUrl = null }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data: prof } = await c.from('profiles').select('name, handle').eq('id', me).maybeSingle();
    const author = (prof && (prof.name || prof.handle)) || '';
    const { data, error } = await c.from('sounds').insert({
      title: title || 'صوت أصلي',
      author_name: author,
      cover_url: coverUrl,
      audio_url: audioUrl,
      duration: Math.max(1, Math.round(duration || 30)),
      created_by: me,
      origin_video_id: videoId || null,
      is_original: true,
    }).select().single();
    if (error) throw error;
    return data;
  };

  API.fetchSound = async (soundId) => {
    const c = await client();
    // The creator join needs sounds.created_by, added in migration 0023. Fall
    // back to a plain read so the page still works before that is applied.
    const withCreator = await c.from('sounds')
      .select('*, creator:profiles!sounds_created_by_fkey ( id, name, handle, avatar_url )')
      .eq('id', soundId).maybeSingle();
    if (!withCreator.error) return withCreator.data || null;
    const { data, error } = await c.from('sounds').select('*').eq('id', soundId).maybeSingle();
    if (error) throw error;
    return data || null;
  };

  API.fetchSoundVideos = async (soundId, limit = 60) => {
    const c = await client();
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at')
      .eq('sound_id', soundId).eq('is_draft', false).eq('is_hidden', false)
      .order('likes_count', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  API.isSoundFavorited = async (soundId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { count } = await c.from('sound_favorites')
      .select('*', { count: 'exact', head: true }).eq('user_id', me).eq('sound_id', soundId);
    return (count || 0) > 0;
  };

  API.favoriteSound = async (soundId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('sound_favorites').insert({ user_id: me, sound_id: soundId });
    if (error && error.code !== '23505') throw error;
  };

  API.unfavoriteSound = async (soundId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('sound_favorites').delete().eq('user_id', me).eq('sound_id', soundId);
    if (error) throw error;
  };

  API.fetchSounds = async () => {
    const c = await client();
    const { data, error } = await c.from('sounds').select('*').order('usage_count', { ascending: false }).limit(50);
    if (error && error.code !== 'PGRST116') return [];
    return data || [];
  };

  // Trending hashtags for Discover — real counts, maintained by the
  // sync_hashtags trigger (0016_live_chat_hashtags.sql).
  // ---------- Hashtags ----------
  // Lookups go through the video_hashtags join table (migration 0025), so a
  // tag match is exact and indexed. The old path was a LIKE over captions,
  // which also matched #travelling when you asked for #travel.
  API.fetchHashtag = async (tag) => {
    const c = await client();
    const clean = String(tag || '').replace(/^#/, '').toLowerCase();
    const { data } = await c.from('hashtags').select('*').eq('tag', clean).maybeSingle();
    return data || { tag: clean, usage_count: 0 };
  };

  API.fetchHashtagVideos = async (tag, limit = 60) => {
    const c = await client();
    const clean = String(tag || '').replace(/^#/, '').toLowerCase();
    const link = await c.from('video_hashtags').select('video_id').eq('tag', clean).limit(limit);
    if (link.error) {
      // Before 0025 is applied there is no join table - fall back to the old
      // caption search so the page still works.
      const { data } = await c.from('videos')
        .select('id, description, thumbnail, video_url, likes_count, created_at')
        .ilike('description', '%#' + clean + '%').eq('is_draft', false).limit(limit);
      return data || [];
    }
    const ids = (link.data || []).map(r => r.video_id);
    if (!ids.length) return [];
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, views_count, created_at')
      .in('id', ids).eq('is_draft', false).eq('is_hidden', false)
      .order('likes_count', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  API.fetchTrendingHashtags = async (limit = 8) => {
    const c = await client();
    const { data, error } = await c.from('hashtags')
      .select('tag, usage_count').order('usage_count', { ascending: false }).limit(limit);
    if (error) return [];
    return data || [];
  };

  // Suggested creators for Discover (most-followed, excluding yourself).
  API.fetchSuggestedProfiles = async (limit = 12) => {
    const c = await client();
    const me = await uid();
    let q = c.from('profiles')
      .select('id, name, handle, avatar_url, bio, verified, followers_count')
      .order('followers_count', { ascending: false }).limit(limit);
    if (me) q = q.neq('id', me);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  };

  // Popular videos grid on Discover — most-engaged public videos.
  API.fetchPopularVideos = async (limit = 12) => {
    const c = await client();
    const { data, error } = await c.from('videos').select(`
      id, description, thumbnail, video_url, likes_count, comments_count, views_count, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
    `).eq('is_draft', false).eq('privacy', 'public').eq('is_hidden', false)
      .order('likes_count', { ascending: false }).limit(limit);
    if (error) return [];
    return data || [];
  };

  // Videos the given user liked — backs the "Liked" tab on a profile.
  API.fetchLikedVideos = async (userId) => {
    const c = await client();
    const target = userId || await uid();
    if (!target) return [];
    const { data, error } = await c.from('likes').select(`
      created_at,
      video:videos!likes_video_id_fkey (
        id, description, thumbnail, video_url, likes_count, created_at,
        user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
      )
    `).eq('user_id', target).order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    return (data || []).map(r => r.video).filter(Boolean);
  };

  // Videos the current user saved — backs the "Saved" tab. Saves are
  // private, so this is always the signed-in user's own list.
  API.fetchSavedVideos = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('saves').select(`
      created_at,
      video:videos!saves_video_id_fkey (
        id, description, thumbnail, video_url, likes_count, created_at,
        user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
      )
    `).eq('user_id', me).order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    return (data || []).map(r => r.video).filter(Boolean);
  };

  // People you can share a video to: existing DM threads first, then
  // people you follow. Replaces the fake contacts list on the share screen.
  API.fetchShareTargets = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('follows').select(`
      followed_id,
      profile:profiles!follows_followed_id_fkey ( id, name, handle, avatar_url )
    `).eq('follower_id', me).limit(50);
    if (error) return [];
    return (data || []).map(r => r.profile).filter(Boolean);
  };

  // Actually sends a video to the chosen people as a DM containing its
  // deep link. The share screen previously just showed "Sent ✓" and did
  // nothing. Returns the number of recipients successfully sent to.
  API.shareVideoTo = async (videoId, userIds) => {
    if (!videoId || !userIds || !userIds.length) return 0;
    const link = (window.DeepLink && window.DeepLink.videoLink(videoId)) || String(videoId);
    let sent = 0;
    for (const userId of userIds) {
      try {
        const chatId = await API.openOrCreateDm(userId);
        await API.sendMessage({ chatId, text: link });
        sent++;
      } catch (e) { console.warn('share to', userId, 'failed:', e.message); }
    }
    if (sent) { try { await API.countShare(videoId); } catch (e) {} }
    return sent;
  };

  // Increments a video's share counter.
  API.countShare = async (videoId) => {
    const c = await client();
    const { error } = await c.rpc('increment_share_count', { p_video_id: videoId });
    if (error) console.warn('countShare failed:', error.message);
  };

  API.searchAll = async (query) => {
    const c = await client();
    const term = `%${query.replace(/[%_]/g, '\\$&')}%`;
    const [profilesRes, videosRes, soundsRes] = await Promise.all([
      c.from('profiles').select('id, name, handle, avatar_url, verified, followers_count').or(`name.ilike.${term},handle.ilike.${term}`).limit(20),
      c.from('videos').select('id, description, thumbnail, video_url, likes_count, created_at, user:profiles!videos_user_id_fkey(id,name,handle,avatar_url)').ilike('description', term).eq('is_draft', false).limit(20),
      c.from('sounds').select('*').or(`title.ilike.${term},author_name.ilike.${term}`).limit(20),
    ]);
    return {
      profiles: profilesRes.data || [],
      videos: videosRes.data || [],
      sounds: soundsRes.data || [],
    };
  };

  // Single video by id — used by deep links (/v/<id>) to pin a shared
  // video to the top of the feed.
  API.fetchVideo = async (videoId) => {
    const c = await client();
    const { data, error } = await c.from('videos').select(`
      id, description, music, sound_id, video_url, thumbnail, privacy,
      likes_count, comments_count, shares_count, views_count, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url, verified )
    `).eq('id', videoId).maybeSingle();
    if (error) throw error;
    return data || null;
  };

  API.fetchUserVideos = async (userId) => {
    const c = await client();
    // Pinned videos sit at the top of the grid, newest first within each group.
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at, is_pinned')
      .eq('user_id', userId).eq('is_draft', false).eq('is_archived', false)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  // Pin / unpin one of your own videos. The 3-per-user cap is enforced by a
  // database trigger, so this surfaces that error rather than guessing.
  API.setVideoPinned = async (videoId, pinned) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('videos')
      .update({ is_pinned: !!pinned }).eq('id', videoId).eq('user_id', me);
    if (error) {
      if (/pin limit reached/i.test(error.message || '')) throw new Error('يمكنك تثبيت 3 فيديوهات كحد أقصى');
      throw error;
    }
  };

  // ---------- Likes / Saves ----------
  API.like = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('likes').insert({ user_id: me, video_id: videoId });
    if (error && error.code !== '23505') throw error;
    await c.rpc('noop'); // placeholder; counts maintained client-side until trigger added
    return true;
  };

  API.unlike = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('likes').delete().eq('user_id', me).eq('video_id', videoId);
    if (error) throw error;
    return true;
  };

  API.save = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('saves').upsert({ user_id: me, video_id: videoId });
    if (error) throw error;
    return true;
  };

  API.unsave = async (videoId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('saves').delete().eq('user_id', me).eq('video_id', videoId);
    if (error) throw error;
    return true;
  };

  // ---------- Comments ----------
  API.fetchComments = async (videoId) => {
    const c = await client(); const me = await uid();
    const { data, error } = await c.from('comments').select(`
      id, text, likes_count, created_at, user_id,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).eq('video_id', videoId).order('created_at', { ascending: false });
    if (error) throw error;
    let rows = data || [];
    if (!me) return rows;

    // Hidden words and Restrict are per-viewer, so they are applied here
    // rather than in a database policy.
    try {
      const [words, restricted] = await Promise.all([
        API.fetchHiddenWords(),
        API.fetchRestricted(),
      ]);
      const restrictedIds = new Set((restricted || []).map(r => r && r.id).filter(Boolean));
      if (restrictedIds.size) {
        // A restricted person still sees their own comment, so it looks
        // normal to them - that is the whole point of Restrict.
        rows = rows.filter(r => !restrictedIds.has(r.user_id) || r.user_id === me);
      }
      if ((words || []).length) {
        const list = words.map(w => String(w).toLowerCase());
        rows = rows.filter(r => {
          const t = String(r.text || '').toLowerCase();
          return !list.some(w => w && t.includes(w));
        });
      }
    } catch (e) { /* filters are best-effort - never hide the whole thread */ }
    return rows;
  };

  API.postComment = async (videoId, text) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data, error } = await c.from('comments').insert({ video_id: videoId, user_id: me, text }).select(`
      id, text, likes_count, created_at,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).single();
    if (error) throw error;
    return data;
  };

  API.deleteComment = async (id) => {
    const c = await client();
    const { error } = await c.from('comments').delete().eq('id', id);
    if (error) throw error;
  };

  // ---------- Follows ----------
  // Returns 'following' or 'requested'. A private account turns a follow into
  // a request, so the caller must render the button from what came back rather
  // than assuming it worked.
  API.follow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (me === userId) return 'following';
    const { data, error } = await c.rpc('follow_or_request', { p_target: userId });
    if (!error) return data || 'following';
    // Before 0030 the function does not exist; the plain insert still works.
    if (error.code === 'PGRST202' || /function .*follow_or_request/i.test(error.message || '')) {
      const { error: e2 } = await c.from('follows').insert({ follower_id: me, followed_id: userId });
      if (e2 && e2.code !== '23505') throw e2;
      return 'following';
    }
    throw error;
  };

  API.hasRequestedFollow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.from('follow_requests')
      .select('target_id').eq('requester_id', me).eq('target_id', userId).maybeSingle();
    if (error) return false;
    return !!data;
  };

  API.cancelFollowRequest = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('follow_requests')
      .delete().eq('requester_id', me).eq('target_id', userId);
    if (error) throw error;
  };

  API.fetchFollowRequests = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('follow_requests')
      .select('requester_id, created_at, profiles:profiles!follow_requests_requester_id_fkey(id,name,handle,avatar_url,verified)')
      .eq('target_id', me).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => r.profiles ? Object.assign({}, r.profiles, { requested_at: r.created_at }) : null).filter(Boolean);
  };

  API.countFollowRequests = async () => {
    const c = await client(); const me = await uid(); if (!me) return 0;
    const { count, error } = await c.from('follow_requests')
      .select('*', { count: 'exact', head: true }).eq('target_id', me);
    if (error) return 0;
    return count || 0;
  };

  API.approveFollowRequest = async (requesterId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.rpc('approve_follow_request', { p_requester: requesterId });
    if (error) throw error;
  };

  API.declineFollowRequest = async (requesterId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('follow_requests')
      .delete().eq('requester_id', requesterId).eq('target_id', me);
    if (error) throw error;
  };

  API.unfollow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('follows').delete().eq('follower_id', me).eq('followed_id', userId);
    if (error) throw error;
    return true;
  };

  API.isFollowing = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.from('follows').select('followed_id').eq('follower_id', me).eq('followed_id', userId).maybeSingle();
    if (error) return false;
    return !!data;
  };

  API.fetchFollowers = async (userId) => {
    const c = await client();
    const { data, error } = await c.from('follows').select(`
      profiles:profiles!follows_follower_id_fkey ( id, name, handle, avatar_url, verified, followers_count )
    `).eq('followed_id', userId);
    if (error) throw error;
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.fetchFollowing = async (userId) => {
    const c = await client();
    const { data, error } = await c.from('follows').select(`
      profiles:profiles!follows_followed_id_fkey ( id, name, handle, avatar_url, verified, followers_count )
    `).eq('follower_id', userId);
    if (error) throw error;
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  // ---------- Profile by id ----------
  // Gender / country live in their own table because
  // public.profiles is world-readable (anon included) - see migration 0022.
  API.fetchMyPrivateDetails = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data, error } = await c.from('user_private').select('*').eq('user_id', me).maybeSingle();
    if (error) throw error;
    return data || null;
  };

  // ---------- Age ----------
  // The birthday is written once at signup and cannot be edited afterwards
  // (a database trigger enforces that), because it is what the 18+ location
  // gate reads.
  API.saveBirthDate = async (isoDate) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_private')
      .upsert({ user_id: me, birth_date: isoDate }, { onConflict: 'user_id' });
    if (error) {
      if (/minimum age/i.test(error.message || '')) {
        throw new Error('يجب أن يكون عمرك 13 عامًا على الأقل');
      }
      if (/cannot be changed/i.test(error.message || '')) {
        throw new Error('لا يمكن تغيير تاريخ الميلاد');
      }
      throw error;
    }
  };

  API.getMyBirthDate = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data, error } = await c.from('user_private')
      .select('birth_date').eq('user_id', me).maybeSingle();
    if (error) return null;
    return (data && data.birth_date) || null;
  };

  API.isAdult = async () => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.rpc('is_adult', { p_user: me });
    if (error) return false;   // migration not applied yet - treat as not proven
    return data === true;
  };

  API.saveMyPrivateDetails = async ({ gender = null, country = null }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_private')
      .upsert({ user_id: me, gender, country }, { onConflict: 'user_id' });
    if (error) throw error;
  };

  API.fetchProfile = async (userId) => {
    const c = await client();
    const { data, error } = await c.from('profiles').select('*').eq('id', userId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  };

  API.searchProfiles = async (q) => {
    const c = await client();
    const term = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const { data, error } = await c.from('profiles').select('id, name, handle, avatar_url, verified, followers_count')
      .or(`name.ilike.${term},handle.ilike.${term}`).limit(30);
    if (error) throw error;
    return data || [];
  };

  // ---------- Chats ----------
  // Details for ONE chat (title + photo + members). V.chat only ever fetched
  // messages, so the header name/avatar were never populated outside demo mode.
  API.fetchChatInfo = async (chatId) => {
    const c = await client(); const me = await uid();
    const [{ data: chat }, { data: members }] = await Promise.all([
      c.from('chats').select('id, type, name, photo_url').eq('id', chatId).maybeSingle(),
      c.from('chat_members').select('user_id, profiles:profiles!chat_members_user_id_fkey(id, name, handle, avatar_url)').eq('chat_id', chatId),
    ]);
    const others = (members || []).filter(m => m.user_id !== me).map(m => m.profiles).filter(Boolean);
    const isGroup = chat && chat.type === 'group';
    return {
      id: chatId,
      type: (chat && chat.type) || 'dm',
      others,
      memberCount: (members || []).length,
      title: isGroup ? ((chat && chat.name) || 'مجموعة') : ((others[0] && others[0].name) || (others[0] && others[0].handle) || 'محادثة'),
      photo: isGroup ? ((chat && chat.photo_url) || '') : ((others[0] && others[0].avatar_url) || ''),
    };
  };

  API.fetchChats = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data: memberships } = await c.from('chat_members').select('chat_id').eq('user_id', me);
    const chatIds = (memberships || []).map(r => r.chat_id);
    if (!chatIds.length) return [];

    const [{ data: chats }, { data: lastMsgs }, { data: members }] = await Promise.all([
      c.from('chats').select('id, type, name, photo_url, created_by, created_at').in('id', chatIds),
      c.from('messages').select('chat_id, text, type, from_user_id, created_at').in('chat_id', chatIds).order('created_at', { ascending: false }),
      c.from('chat_members').select('chat_id, user_id, profiles:profiles!chat_members_user_id_fkey(id, name, handle, avatar_url)').in('chat_id', chatIds),
    ]);

    // Latest message per chat
    const lastByChat = {};
    (lastMsgs || []).forEach(m => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m; });
    // Members per chat (excluding me — for DM display)
    const membersByChat = {};
    (members || []).forEach(m => {
      (membersByChat[m.chat_id] = membersByChat[m.chat_id] || []).push(m);
    });

    return (chats || []).map(c => {
      const others = (membersByChat[c.id] || []).filter(m => m.user_id !== me).map(m => m.profiles);
      const last = lastByChat[c.id];
      return {
        ...c,
        others,
        last_message: last,
        // An empty display name is falsy, so this used to fall through to the
        // literal word "Chat". Try the handle before giving up.
        title: c.type === 'group'
          ? (c.name || 'مجموعة')
          : ((others[0] && others[0].name) || (others[0] && others[0].handle) || 'محادثة'),
        avatar: c.type === 'group' ? c.photo_url : (others[0] && others[0].avatar_url),
      };
    }).sort((a, b) => new Date((b.last_message && b.last_message.created_at) || b.created_at) - new Date((a.last_message && a.last_message.created_at) || a.created_at));
  };

  API.openOrCreateDm = async (otherUserId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (otherUserId === me) throw new Error('cannot DM yourself');

    // Find existing DM that has BOTH me and otherUserId
    const { data: myChats } = await c.from('chat_members').select('chat_id, chats!inner(type)').eq('user_id', me);
    const dmIds = (myChats || []).filter(r => r.chats && r.chats.type === 'dm').map(r => r.chat_id);
    if (dmIds.length) {
      const { data: shared } = await c.from('chat_members').select('chat_id').eq('user_id', otherUserId).in('chat_id', dmIds);
      if (shared && shared.length) return shared[0].chat_id;
    }

    // Create new DM
    const { data: newChat, error: e1 } = await c.from('chats').insert({ type: 'dm', created_by: me }).select('id').single();
    if (e1) throw e1;
    const { error: e2 } = await c.from('chat_members').insert([
      { chat_id: newChat.id, user_id: me, role: 'member' },
      { chat_id: newChat.id, user_id: otherUserId, role: 'member' },
    ]);
    if (e2) throw e2;
    return newChat.id;
  };

  API.createGroup = async ({ name, memberIds, photoFile }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');

    let photo_url = null;
    if (photoFile) {
      const ext = (photoFile.name.split('.').pop() || 'png').toLowerCase();
      const path = `${me}/group-${Date.now()}.${ext}`;
      const { error: upErr } = await c.storage.from('group-photos').upload(path, photoFile, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = c.storage.from('group-photos').getPublicUrl(path);
      photo_url = pub.publicUrl;
    }

    const { data: chat, error: e1 } = await c.from('chats').insert({ type: 'group', name, photo_url, created_by: me }).select('id').single();
    if (e1) throw e1;

    const ids = Array.from(new Set([me, ...memberIds]));
    const rows = ids.map(u => ({ chat_id: chat.id, user_id: u, role: u === me ? 'owner' : 'member' }));
    const { error: e2 } = await c.from('chat_members').insert(rows);
    if (e2) throw e2;
    return chat.id;
  };

  API.fetchMessages = async (chatId, limit = 100) => {
    const c = await client();
    const { data, error } = await c.from('messages').select(`
      id, type, text, attachment_url, from_user_id, created_at,
      from:profiles!messages_from_user_id_fkey ( id, name, avatar_url )
    `).eq('chat_id', chatId).order('created_at', { ascending: true }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  API.sendMessage = async ({ chatId, text, type = 'text', file }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const row = { chat_id: chatId, from_user_id: me, type, text };
    if (file) {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${chatId}/${Date.now()}-${me}.${ext}`;
      const q = await API.uploadQuota();
      if (q && !q.allowed) throw new Error(API.quotaMessage(q));
      const { error: upErr } = await c.storage.from('chat-media').upload(path, file);
      if (upErr) throw upErr;
      const { data: signed } = await c.storage.from('chat-media').createSignedUrl(path, 60 * 60 * 24 * 7);
      row.attachment_url = signed.signedUrl;
    }
    const { data, error } = await c.from('messages').insert(row).select().single();
    if (error) throw error;
    return data;
  };

  API.subscribeToMessages = (chatId, cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel(`messages:${chatId}`).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  // ---------- Calls (signalling) ----------
  // Agora carries the audio/video, but it cannot make a phone ring. These
  // functions are that missing half: they tell the other person a call is
  // coming and let either side accept, decline or hang up. All of it works
  // without an Agora App ID.

  API.startCall = async ({ calleeId, kind = 'audio', chatId = null }) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    if (calleeId === me) throw new Error('cannot call yourself');
    // Both sides need the same channel name, so settle it up front.
    const channel = 'call_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const { data, error } = await c.from('calls')
      .insert({ caller_id: me, callee_id: calleeId, kind, chat_id: chatId, channel, status: 'ringing' })
      .select().single();
    if (error) throw error;
    return data;
  };

  async function _setCallStatus(callId, status, extra) {
    const c = await client();
    const patch = Object.assign({ status }, extra || {});
    const { data, error } = await c.from('calls').update(patch).eq('id', callId).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  API.acceptCall  = (callId) => _setCallStatus(callId, 'accepted', { answered_at: new Date().toISOString() });
  API.declineCall = (callId) => _setCallStatus(callId, 'declined', { ended_at: new Date().toISOString() });
  API.endCall     = (callId) => _setCallStatus(callId, 'ended',    { ended_at: new Date().toISOString() });
  API.missCall    = (callId) => _setCallStatus(callId, 'missed',   { ended_at: new Date().toISOString() });

  // Any call still ringing for me right now (e.g. the app was reopened
  // mid-ring, or the realtime event was missed).
  API.fetchIncomingCall = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const cutoff = new Date(Date.now() - 60000).toISOString(); // ignore stale rings
    const { data } = await c.from('calls')
      .select('*, caller:profiles!calls_caller_id_fkey ( id, name, handle, avatar_url )')
      .eq('callee_id', me).eq('status', 'ringing').gte('created_at', cutoff)
      .order('created_at', { ascending: false }).limit(1);
    return (data && data[0]) || null;
  };

  API.fetchCall = async (callId) => {
    const c = await client();
    const { data } = await c.from('calls')
      .select('*, caller:profiles!calls_caller_id_fkey ( id, name, handle, avatar_url ), callee:profiles!calls_callee_id_fkey ( id, name, handle, avatar_url )')
      .eq('id', callId).maybeSingle();
    return data || null;
  };

  // Fires when somebody calls me.
  API.subscribeToIncomingCalls = (cb) => {
    let channel = null;
    (async () => {
      const c = await client(); const me = await uid(); if (!me) return;
      channel = c.channel('calls:incoming:' + me).on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${me}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  // Fires when THIS call changes - answered, declined, hung up.
  API.subscribeToCall = (callId, cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel('calls:one:' + callId).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}`,
      }, payload => cb(payload.new)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  API.addGroupMembers = async (chatId, userIds) => {
    const c = await client();
    const rows = userIds.map(u => ({ chat_id: chatId, user_id: u, role: 'member' }));
    const { error } = await c.from('chat_members').insert(rows);
    if (error) throw error;
  };
  API.removeGroupMember = async (chatId, userId) => {
    const c = await client();
    const { error } = await c.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
    if (error) throw error;
  };

  // ---------- Notifications ----------
  API.fetchNotifications = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('notifications').select(`
      id, type, payload, read_at, created_at,
      actor:profiles!notifications_actor_id_fkey ( id, name, avatar_url )
    `).eq('user_id', me).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  };

  // Nothing ever set read_at, so the unread badge could only ever grow.
  API.markNotificationsRead = async (ids) => {
    const c = await client(); const me = await uid(); if (!me) return 0;
    let q = c.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', me).is('read_at', null);
    if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
    const { data, error } = await q.select('id');
    if (error) throw error;
    return (data || []).length;
  };

  API.countUnreadNotifications = async () => {
    const c = await client(); const me = await uid(); if (!me) return 0;
    const { count, error } = await c.from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', me).is('read_at', null);
    if (error) return 0;
    return count || 0;
  };

  // ---------- Handles ----------
  API.fetchProfileByHandle = async (handle) => {
    const c = await client();
    const { data, error } = await c.from('profiles')
      .select('id, name, handle, avatar_url, verified, is_private')
      .ilike('handle', String(handle || '').trim())
      .maybeSingle();
    if (error) return null;
    return data;
  };

  // Typeahead for the @ picker while composing.
  API.searchHandles = async (prefix, limit = 8) => {
    const c = await client();
    const { data, error } = await c.rpc('search_handles', { p_prefix: prefix, p_limit: limit });
    if (!error) return data || [];
    // Before 0035 the function does not exist; fall back to a plain query.
    const r = await c.from('profiles')
      .select('id, handle, name, avatar_url, verified')
      .ilike('handle', prefix + '%').limit(limit);
    return r.data || [];
  };

  // ---------- Support ----------
  API.createSupportTicket = async ({ category, subject, message }) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('support_tickets').insert({
      user_id: me,
      category: category || 'other',
      subject: subject || null,
      message: message,
      app_version: '1.0.0',
      device: (navigator.userAgent || '').slice(0, 200),
    });
    if (error) {
      if (/too many reports/i.test(error.message || '')) {
        throw new Error('أرسلت بلاغات كثيرة، حاول لاحقًا');
      }
      throw error;
    }
  };

  API.fetchMySupportTickets = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('support_tickets')
      .select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(20);
    if (error) return [];
    return data || [];
  };

  // ---------- Upload quotas ----------
  // Neither storage provider offers a hard spending cap, so the ceiling is
  // enforced here and in a storage policy. This call is only for showing the
  // reason - the policy is what actually stops the upload.
  API.uploadQuota = async () => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data, error } = await c.rpc('upload_quota_status');
    if (error) return null;   // migration not applied yet - do not block uploads
    return data;
  };

  API.quotaMessage = (q) => {
    if (!q || q.allowed) return '';
    if (q.reason === 'daily_count') {
      return 'وصلت إلى حد الرفع اليومي (' + q.uploads_limit + '). حاول غدًا.';
    }
    if (q.reason === 'daily_bytes') {
      return 'وصلت إلى حد الحجم اليومي. حاول غدًا.';
    }
    if (q.reason === 'global_full') {
      return 'التخزين ممتلئ مؤقتًا. حاول لاحقًا.';
    }
    return 'تعذر الرفع الآن';
  };

  API.fetchAppLimits = async () => {
    const c = await client();
    const { data, error } = await c.from('app_limits').select('*').eq('id', 1).maybeSingle();
    if (error) return null;
    return data;
  };

  API.updateAppLimits = async (fields) => {
    const c = await client();
    const { error } = await c.from('app_limits').update(fields).eq('id', 1);
    if (error) throw error;
  };

  // ---------- Archive ----------
  // Archiving is the author hiding their own post. It is deliberately not the
  // same flag as is_hidden, which is moderation taking something down.
  API.setVideoArchived = async (videoId, archived) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('videos')
      .update({ is_archived: !!archived }).eq('id', videoId).eq('user_id', me);
    if (error) throw error;
  };

  API.fetchArchivedVideos = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at')
      .eq('user_id', me).eq('is_archived', true).eq('is_draft', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  // ---------- Close friends ----------
  API.fetchCloseFriends = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('close_friends')
      .select('friend_id, profiles:profiles!close_friends_friend_id_fkey(id,name,handle,avatar_url)')
      .eq('user_id', me);
    if (error) throw error;
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.addCloseFriend = async (friendId) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('close_friends').insert({ user_id: me, friend_id: friendId });
    if (error && error.code !== '23505') throw error;
  };

  API.removeCloseFriend = async (friendId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('close_friends')
      .delete().eq('user_id', me).eq('friend_id', friendId);
    if (error) throw error;
  };

  // ---------- Download your data ----------
  API.requestDataExport = async () => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('data_export_requests').insert({ user_id: me });
    // A unique index allows only one pending request, so a second tap is a
    // no-op rather than an error the user has to read.
    if (error && error.code !== '23505') throw error;
  };

  API.fetchDataExports = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('data_export_requests')
      .select('*').eq('user_id', me).order('requested_at', { ascending: false }).limit(10);
    if (error) throw error;
    return data || [];
  };

  // ---------- Your activity ----------
  // What you did, not what was done to you - that is the notifications screen.
  API.fetchMyLikedVideos = async (limit = 60) => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('likes')
      .select('created_at, videos:videos!likes_video_id_fkey(id, thumbnail, description, likes_count)')
      .eq('user_id', me).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(r => r.videos ? Object.assign({}, r.videos, { acted_at: r.created_at }) : null).filter(Boolean);
  };

  API.fetchMyComments = async (limit = 60) => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('comments')
      .select('id, text, created_at, video_id')
      .eq('user_id', me).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  API.deleteMyComment = async (id) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('comments').delete().eq('id', id).eq('user_id', me);
    if (error) throw error;
  };

  API.countMyContent = async () => {
    const c = await client(); const me = await uid();
    if (!me) return { posts: 0, likes: 0, comments: 0, archived: 0 };
    const one = async (t, extra) => {
      let q = c.from(t).select('*', { count: 'exact', head: true }).eq('user_id', me);
      if (extra) q = extra(q);
      const { count } = await q;
      return count || 0;
    };
    const [posts, likes, comments, archived] = await Promise.all([
      one('videos', q => q.eq('is_draft', false).eq('is_archived', false)),
      one('likes'),
      one('comments'),
      one('videos', q => q.eq('is_archived', true)),
    ]);
    return { posts, likes, comments, archived };
  };

  // ---------- Moderation tools (hidden words / restrict / mute) ----------

  API.fetchHiddenWords = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('hidden_words').select('word').eq('user_id', me);
    if (error) return [];
    return (data || []).map(r => r.word);
  };

  API.addHiddenWord = async (word) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const w = String(word || '').trim().toLowerCase();
    if (!w) return;
    const { error } = await c.from('hidden_words').insert({ user_id: me, word: w });
    if (error && error.code !== '23505') throw error;
  };

  API.removeHiddenWord = async (word) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('hidden_words')
      .delete().eq('user_id', me).eq('word', String(word).trim().toLowerCase());
    if (error) throw error;
  };

  API.fetchRestricted = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('restricted_users')
      .select('restricted_id, profiles:profiles!restricted_users_restricted_id_fkey(id,name,handle,avatar_url)')
      .eq('user_id', me);
    if (error) return [];
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.restrictUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('restricted_users').insert({ user_id: me, restricted_id: targetId });
    if (error && error.code !== '23505') throw error;
  };

  API.unrestrictUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('restricted_users')
      .delete().eq('user_id', me).eq('restricted_id', targetId);
    if (error) throw error;
  };

  API.isRestricted = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { count } = await c.from('restricted_users')
      .select('*', { count: 'exact', head: true }).eq('user_id', me).eq('restricted_id', targetId);
    return (count || 0) > 0;
  };

  API.fetchMuted = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('muted_users')
      .select('muted_id, profiles:profiles!muted_users_muted_id_fkey(id,name,handle,avatar_url)')
      .eq('user_id', me);
    if (error) return [];
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  API.muteUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('muted_users').insert({ user_id: me, muted_id: targetId });
    if (error && error.code !== '23505') throw error;
  };

  API.unmuteUser = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.from('muted_users').delete().eq('user_id', me).eq('muted_id', targetId);
    if (error) throw error;
  };

  API.isMuted = async (targetId) => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { count } = await c.from('muted_users')
      .select('*', { count: 'exact', head: true }).eq('user_id', me).eq('muted_id', targetId);
    return (count || 0) > 0;
  };

  // ---------- User settings ----------
  // Every toggle on the Settings screen used to call an empty function.
  // These read and write real rows; the database enforces them (0027).

  const SETTINGS_DEFAULTS = {
    notif_likes: true, notif_comments: true, notif_follows: true,
    notif_messages: true, notif_live: true, notif_gifts: true,
    who_can_message: 'everyone', who_can_comment: 'everyone', who_can_tag: 'everyone',
    autoplay: true, data_saver: false,
  };

  API.fetchUserSettings = async () => {
    const c = await client(); const me = await uid();
    if (!me) return { ...SETTINGS_DEFAULTS };
    const { data, error } = await c.from('user_settings').select('*').eq('user_id', me).maybeSingle();
    if (error) return { ...SETTINGS_DEFAULTS };   // table not there yet -> defaults
    return { ...SETTINGS_DEFAULTS, ...(data || {}) };
  };

  API.updateUserSettings = async (patch) => {
    const c = await client(); const me = await uid();
    if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_settings')
      .upsert({ user_id: me, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
  };

  // Can I open a DM with this person? Honours their "who can message me"
  // choice and any block they have on me.
  API.canMessage = async (targetId) => {
    const c = await client(); const me = await uid();
    if (!me) return false;
    const { data, error } = await c.rpc('may_message', { p_target: targetId, p_actor: me });
    if (error) return true;   // function not deployed yet - do not block the user
    return data !== false;
  };

  // ---------- Sessions / login alerts ----------
  function describeDevice() {
    const ua = navigator.userAgent || '';
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\//.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' :
      /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
    const os =
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' : 'Unknown';
    return { device: browser + ' on ' + os, platform: /Android|iPhone|iPad|iPod/.test(ua) ? 'mobile' : 'web' };
  }

  API.recordSession = async () => {
    const c = await client(); const me = await uid();
    if (!me) return null;
    const d = describeDevice();
    const { data, error } = await c.rpc('record_session', { p_device: d.device, p_platform: d.platform });
    if (error) return null;   // migration not applied yet
    // Kept so the devices list can mark which row you are reading it on.
    try { if (data) localStorage.setItem('tt-session-id', data); } catch (e) {}
    return data;
  };

  API.fetchMySessions = async () => {
    const c = await client(); const me = await uid();
    if (!me) return [];
    const { data, error } = await c.from('user_sessions')
      .select('*').eq('user_id', me).order('last_seen', { ascending: false });
    if (error) return [];
    return data || [];
  };

  API.revokeSession = async (id) => {
    const c = await client(); const me = await uid();
    if (!me) return;
    const { error } = await c.from('user_sessions').delete().eq('id', id).eq('user_id', me);
    if (error) throw error;
  };

  // ---------- Locations ----------
  API.upsertLocation = async ({ lat, lng, accuracy, sharing_enabled = true, visibility = 'friends' }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_locations').upsert({
      user_id: me, lat, lng, accuracy, sharing_enabled, visibility, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  };

  // Reading the two flags the settings screen needs, so the switch can show
  // the stored state instead of always starting at off.
  API.fetchMyLocationSettings = async () => {
    const c = await client(); const me = await uid();
    if (!me) return { sharing_enabled: false, visibility: 'friends' };
    const { data, error } = await c.from('user_locations')
      .select('sharing_enabled, visibility').eq('user_id', me).maybeSingle();
    if (error || !data) return { sharing_enabled: false, visibility: 'friends' };
    return { sharing_enabled: !!data.sharing_enabled, visibility: data.visibility || 'friends' };
  };

  // The master switch. Setting visibility alone left sharing_enabled false,
  // which the read policy requires - so the switch reported success while
  // nobody could actually see you.
  API.setLocationSharing = async (on) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (!on) return API.stopSharingLocation();
    const current = await API.fetchMyLocationSettings();
    const { error } = await c.from('user_locations').upsert({
      user_id: me,
      sharing_enabled: true,
      // 'none' would contradict the switch being on, so fall back to friends.
      visibility: current.visibility === 'none' ? 'friends' : current.visibility,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  };

  API.setLocationVisibility = async (visibility) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (visibility === 'none') return API.stopSharingLocation();
    const { error } = await c.from('user_locations').upsert({ user_id: me, visibility, updated_at: new Date().toISOString() });
    if (error) throw error;
  };

  // Clears the stored coordinates rather than only flipping a flag - a
  // position nobody can see is still a position being kept.
  API.stopSharingLocation = async () => {
    const c = await client(); const me = await uid(); if (!me) return;
    const { error } = await c.rpc('stop_sharing_location');
    if (!error) return;
    // Before 0032 the function does not exist; blank the row directly.
    await c.from('user_locations').upsert({
      user_id: me, visibility: 'none', sharing_enabled: false,
      lat: null, lng: null, accuracy: null, updated_at: new Date().toISOString(),
    });
  };

  API.fetchFriendLocations = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    // Get who I follow
    const { data: f } = await c.from('follows').select('followed_id').eq('follower_id', me);
    const ids = (f || []).map(r => r.followed_id);
    if (!ids.length) return [];
    const { data, error } = await c.from('user_locations').select(`
      user_id, lat, lng, updated_at, visibility, sharing_enabled,
      profiles:profiles!user_locations_user_id_fkey ( id, name, handle, avatar_url )
    `).in('user_id', ids).eq('sharing_enabled', true)
      .gt('updated_at', new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString());
    if (error) throw error;
    // A row with no coordinates is someone who has stopped sharing.
    return (data || []).filter(r => r.lat != null && r.lng != null);
  };

  API.subscribeToFriendLocations = (cb) => {
    let channel = null;
    (async () => {
      const c = await client();
      channel = c.channel('friend-locations').on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_locations',
      }, payload => cb(payload)).subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  };

  API.subscribeToLiveComments = async (liveStreamId, cb) => {
    const c = await client();
    const ch = c.channel('live-comments-' + liveStreamId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_comments', filter: `live_stream_id=eq.${liveStreamId}` },
        (payload) => cb(payload.new))
      .subscribe();
    return () => { try { c.removeChannel(ch); } catch (e) {} };
  };

  API.startLive = async ({ title, thumbnail }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data, error } = await c.from('live_streams').insert({ host_id: me, title, thumbnail, status: 'live' }).select().single();
    if (error) throw error;
    return data;
  };

  API.endLive = async (id) => {
    const c = await client();
    const { error } = await c.from('live_streams').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  };

  // The list card reads host.avatar while the stream screen reads
  // host.avatar_url, so both names are returned rather than changing two
  // screens over a key.
  function shapeHost(p) {
    if (!p) return null;
    return { id: p.id, name: p.name, handle: p.handle, avatar_url: p.avatar_url, avatar: p.avatar_url };
  }

  API.fetchLiveStreams = async () => {
    const c = await client();
    const { data, error } = await c
      .from('live_streams')
      .select('id, title, thumbnail, viewer_count, status, started_at, host:profiles!live_streams_host_id_fkey (id, name, handle, avatar_url)')
      .eq('status', 'live')
      .order('viewer_count', { ascending: false })
      .limit(60);
    if (error) throw error;
    return (data || []).map(r => Object.assign({}, r, { host: shapeHost(r.host) }));
  };

  API.fetchLiveStream = async (id) => {
    const c = await client();
    const { data, error } = await c
      .from('live_streams')
      .select('id, title, thumbnail, viewer_count, status, started_at, ended_at, host:profiles!live_streams_host_id_fkey (id, name, handle, avatar_url)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return Object.assign({}, data, { host: shapeHost(data.host) });
  };

  // Oldest first, so the chat reads top to bottom the way it is rendered.
  // Only the tail matters on a busy stream.
  API.fetchLiveComments = async (liveStreamId, limit = 40) => {
    const c = await client();
    const { data, error } = await c
      .from('live_comments')
      .select('id, text, created_at, user:profiles!live_comments_user_id_fkey (id, name, handle, avatar_url)')
      .eq('live_stream_id', liveStreamId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse();
  };

  API.postLiveComment = async (liveStreamId, text) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const body = String(text || '').trim();
    if (!body) throw new Error('empty comment');
    // Matches the column constraint, so an over-long comment fails here with
    // a readable message instead of a database error.
    if (body.length > 500) throw new Error('التعليق طويل جدًا');
    const { data, error } = await c.from('live_comments')
      .insert({ live_stream_id: liveStreamId, user_id: me, text: body })
      .select('id, text, created_at')
      .single();
    if (error) throw error;
    return data;
  };

  // ---------- Reports ----------
  API.report = async ({ targetType, targetId, reason }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('reports').insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason });
    if (error) throw error;
  };

  // ---------- Community Guidelines agreement (required before first publish) ----------
  API.hasAcceptedGuidelines = async () => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data, error } = await c.from('profiles').select('guidelines_accepted_at').eq('id', me).single();
    if (error) return false;
    return !!(data && data.guidelines_accepted_at);
  };

  API.acceptGuidelines = async () => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.rpc('accept_guidelines');
    if (error) throw error;
  };

  // ---------- Interested / Not interested feedback (negative signal for the feed algorithm) ----------
  API.setVideoFeedback = async (videoId, feedback) => {
    if (!videoId || typeof videoId !== 'string' || videoId.length < 10) return;
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.rpc('set_video_feedback', { p_video_id: videoId, p_feedback: feedback });
    if (error) throw error;
  };

  // ---------- Engagement tracking (feeds the personalized FYP algorithm) ----------
  API.trackEngagement = async ({ videoId, watchMs = 0, loopCount = 0, completionPct = 0 }) => {
    if (!videoId || typeof videoId !== 'string' || videoId.length < 10) return; // skip mock/placeholder ids
    const c = await client();
    const me = await uid();
    if (!me) return; // only signed-in users build a preference profile
    const { error } = await c.rpc('track_engagement', {
      p_video_id: videoId,
      p_watch_ms: Math.round(watchMs),
      p_loop_count: loopCount,
      p_completion_pct: Math.max(0, Math.min(1, completionPct)),
    });
    if (error) console.warn('trackEngagement failed:', error.message);
  };

  // ============================================================
  // ===== WALKIE-TALKIE — live audio broadcast in chat =========
  // Uses Supabase Realtime broadcast channel (not Postgres changes).
  // Sender streams audio chunks as base64; receivers reconstruct
  // and play in real time. Sub-500ms latency typical.
  // ============================================================
  API.openWalkieChannel = (chatId, { onChunk, onSpeakerChange }) => {
    let channel = null;
    let cleanup = () => {};
    (async () => {
      const c = await client();
      const me = await uid();
      channel = c.channel(`walkie:${chatId}`, { config: { broadcast: { ack: false } } });
      channel
        .on('broadcast', { event: 'audio' }, ({ payload }) => {
          if (!payload || payload.from === me) return;
          onChunk && onChunk(payload);
        })
        .on('broadcast', { event: 'talking' }, ({ payload }) => {
          if (!payload || payload.from === me) return;
          onSpeakerChange && onSpeakerChange(payload);
        })
        .subscribe();
      cleanup = () => { try { channel.unsubscribe(); } catch (e) {} };
    })();
    return {
      // Send one chunk of audio
      sendChunk: async ({ data, mime, seq }) => {
        if (!channel) return;
        const me = await uid();
        await channel.send({ type: 'broadcast', event: 'audio', payload: { from: me, data, mime, seq, t: Date.now() } });
      },
      // Notify everyone that someone started/stopped talking
      sendTalking: async (isTalking, name) => {
        if (!channel) return;
        const me = await uid();
        await channel.send({ type: 'broadcast', event: 'talking', payload: { from: me, isTalking, name, t: Date.now() } });
      },
      close: () => cleanup(),
    };
  };

  // ============================================================
  // ===================== LOCATION PERMITS =======================
  // A → asks B for location → B approves/denies → A can track until revoked
  // ============================================================
  API.requestLocationPermit = async (targetUserId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data, error } = await c.from('location_permits')
      .upsert({ requester_id: me, target_id: targetUserId, status: 'pending' }, { onConflict: 'requester_id,target_id' })
      .select().single();
    if (error) throw error;
    return data;
  };

  API.respondToLocationPermit = async (permitId, decision /* 'approved' | 'denied' */) => {
    const c = await client();
    const { error } = await c.from('location_permits')
      .update({ status: decision, responded_at: new Date().toISOString() })
      .eq('id', permitId);
    if (error) throw error;
  };

  API.revokeLocationPermit = async (targetUserId) => {
    const c = await client(); const me = await uid();
    const { error } = await c.from('location_permits')
      .update({ status: 'revoked', responded_at: new Date().toISOString() })
      .or(`and(requester_id.eq.${me},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${me})`);
    if (error) throw error;
  };

  API.fetchPermitStatus = async (targetUserId) => {
    const c = await client(); const me = await uid(); if (!me) return null;
    const { data } = await c.from('location_permits')
      .select('id,status')
      .eq('requester_id', me).eq('target_id', targetUserId)
      .maybeSingle();
    return data;
  };

  API.fetchIncomingPermits = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('location_permits')
      .select('id, status, created_at, requester:profiles!location_permits_requester_id_fkey(id,name,handle,avatar_url)')
      .eq('target_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  API.fetchTrackedLocations = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    // Get permits I own that are approved
    const { data: permits } = await c.from('location_permits')
      .select('target_id')
      .eq('requester_id', me)
      .eq('status', 'approved');
    const ids = (permits || []).map(p => p.target_id);
    if (!ids.length) return [];
    const { data, error } = await c.from('user_locations')
      .select('user_id, lat, lng, updated_at, profiles:profiles!user_locations_user_id_fkey(id,name,handle,avatar_url)')
      .in('user_id', ids);
    if (error) throw error;
    return data || [];
  };

  // ============================================================
  // ============================ BLOCKS ==========================
  // ============================================================
  API.blockUser = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('blocks').insert({ blocker_id: me, blocked_id: userId });
    if (error && error.code !== '23505') throw error;
  };
  API.unblockUser = async (userId) => {
    const c = await client(); const me = await uid();
    const { error } = await c.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId);
    if (error) throw error;
  };
  API.fetchBlocked = async () => {
    const c = await client(); const me = await uid(); if (!me) return [];
    const { data, error } = await c.from('blocks').select('blocked_id, profiles:profiles!blocks_blocked_id_fkey(id,name,handle,avatar_url)').eq('blocker_id', me);
    if (error) throw error;
    return (data || []).map(r => r.profiles).filter(Boolean);
  };

  // ============================================================
  // ============== SELF-SERVICE (wallet, privacy, deletion) ======
  // ============================================================
  // Fetch full profile incl. is_private (so settings can show the toggle correctly)
  API.fetchMySettings = async () => {
    const c = await client(); const me = await uid(); if (!me) return {};
    const { data, error } = await c.from('profiles').select('id, name, handle, is_private, verified').eq('id', me).maybeSingle();
    if (error) throw error;
    return data || {};
  };

  API.setPrivate = async (isPrivate) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('profiles').update({ is_private: !!isPrivate }).eq('id', me);
    if (error) throw error;
  };


  // ---------- Account status ----------
  // Deactivate hides the account and destroys nothing. Deletion is scheduled
  // 30 days out and cancelled by signing back in, so the warning we show is
  // actually true.
  API.fetchAccountStatus = async () => {
    const c = await client(); const me = await uid();
    if (!me) return null;
    const { data, error } = await c.rpc('my_account_status');
    if (error) return null;   // migration not applied yet
    return data;
  };

  API.deactivateAccount = async () => {
    const c = await client();
    const { error } = await c.rpc('deactivate_account');
    if (error) throw error;
    try { await window.SB.signOut(); } catch (e) {}
  };

  API.reactivateAccount = async () => {
    const c = await client();
    const { error } = await c.rpc('reactivate_account');
    if (error) throw error;
  };

  API.scheduleAccountDeletion = async () => {
    const c = await client();
    const { data, error } = await c.rpc('schedule_account_deletion');
    if (error) throw error;
    try { await window.SB.signOut(); } catch (e) {}
    return data;
  };

  API.cancelAccountDeletion = async () => {
    const c = await client();
    const { error } = await c.rpc('cancel_account_deletion');
    if (error) throw error;
  };

  API.selfDeleteAccount = async () => {
    const c = await client();
    const { error } = await c.rpc('self_delete_account');
    if (error) throw error;
    try { await window.SB.signOut(); } catch (e) {}
  };

  // ============================================================
  // ============== ADMIN ENDPOINTS (require is_admin) ============
  // ============================================================
  API.adminCheckIsAdmin = async () => {
    const c = await client(); const me = await uid(); if (!me) return false;
    const { data } = await c.from('profiles').select('is_admin').eq('id', me).maybeSingle();
    return !!(data && data.is_admin);
  };

  API.adminStats = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_stats');
    if (error) throw error;
    return data;
  };

  API.adminFetchUsers = async ({ search = '', status = '' } = {}) => {
    const c = await client();
    let q = c.from('profiles').select('id, name, handle, avatar_url, verified, is_admin, banned_until, followers_count, created_at').order('created_at', { ascending: false }).limit(200);
    if (search) {
      const term = `%${search.replace(/[%_]/g, '\\$&')}%`;
      q = q.or(`name.ilike.${term},handle.ilike.${term}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    let users = data || [];
    if (status === 'active') users = users.filter(u => !u.banned_until);
    if (status === 'banned') users = users.filter(u => u.banned_until && new Date(u.banned_until) > new Date());
    if (status === 'admin') users = users.filter(u => u.is_admin);
    return users;
  };

  API.adminBanUser = async (userId, days) => {
    const c = await client();
    const until = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await c.from('profiles').update({ banned_until: until }).eq('id', userId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: until ? 'ban_user' : 'unban_user', target_type: 'user', target_id: userId, payload: { until } });
  };

  API.adminToggleAdmin = async (userId, makeAdmin) => {
    const c = await client();
    const { error } = await c.from('profiles').update({ is_admin: !!makeAdmin }).eq('id', userId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: makeAdmin ? 'grant_admin' : 'revoke_admin', target_type: 'user', target_id: userId });
  };

  // Full detail blob for the admin edit-user modal (profile + wallet + recent videos/logs)
  API.adminFetchUserDetail = async (userId) => {
    const c = await client();
    const { data, error } = await c.rpc('admin_user_detail', { p_user_id: userId });
    if (error) throw error;
    return data || {};
  };

  // Patch a user's profile (admin only). Accepts: { name, handle, bio, verified, avatar_url }
  API.adminUpdateProfile = async (userId, patch) => {
    const c = await client();
    const allowed = ['name', 'handle', 'bio', 'verified', 'avatar_url'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if (!Object.keys(clean).length) return;
    const { error } = await c.from('profiles').update(clean).eq('id', userId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'update_profile', target_type: 'user', target_id: userId, payload: clean });
  };

  // ---------- Admin: support desk ----------
  API.adminFetchTickets = async (status = 'all') => {
    const c = await client();
    let q = c.from('support_tickets')
      .select('*, profiles:profiles!support_tickets_user_id_fkey(id,name,handle,avatar_url)')
      .order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminReplyTicket = async (id, reply, status = 'resolved') => {
    const c = await client(); const me = await uid();
    const { error } = await c.from('support_tickets').update({
      admin_reply: reply,
      status,
      replied_at: new Date().toISOString(),
      replied_by: me,
    }).eq('id', id);
    if (error) throw error;
  };

  API.adminSetTicketStatus = async (id, status) => {
    const c = await client();
    const { error } = await c.from('support_tickets').update({ status }).eq('id', id);
    if (error) throw error;
  };

  // ---------- Admin: data export requests ----------
  API.adminFetchExports = async () => {
    const c = await client();
    const { data, error } = await c.from('data_export_requests')
      .select('*, profiles:profiles!data_export_requests_user_id_fkey(id,name,handle,avatar_url)')
      .order('requested_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data || [];
  };

  API.adminCompleteExport = async (id, fileUrl) => {
    const c = await client();
    const { error } = await c.from('data_export_requests').update({
      status: 'ready', file_url: fileUrl, completed_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  };

  API.adminFailExport = async (id) => {
    const c = await client();
    const { error } = await c.from('data_export_requests')
      .update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  };

  // ---------- Admin: deletion queue ----------
  API.adminPendingDeletions = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_pending_deletions');
    if (error) throw error;
    return data || [];
  };

  API.adminCancelDeletion = async (userId) => {
    const c = await client();
    const { error } = await c.rpc('admin_cancel_deletion', { p_user: userId });
    if (error) throw error;
  };

  // ---------- Admin: storage and limits ----------
  API.adminStorageOverview = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_storage_overview');
    if (error) throw error;
    return data;
  };

  API.adminQueueCounts = async () => {
    const c = await client();
    const { data, error } = await c.rpc('admin_queue_counts');
    if (error) return null;   // migration not applied yet
    return data;
  };

  API.adminGrowth = async (days = 30) => {
    const c = await client();
    const { data, error } = await c.rpc('admin_growth', { p_days: days });
    if (error) return [];
    return data || [];
  };

  // ---------- Admin: live locations ----------
  // Only rows that are actually being shared, so the page reflects what other
  // people can really see rather than every row in the table.
  API.adminFetchLocations = async () => {
    const c = await client();
    const { data, error } = await c.from('user_locations')
      .select('user_id, lat, lng, visibility, sharing_enabled, updated_at, profiles:profiles!user_locations_user_id_fkey(id,name,handle,avatar_url)')
      .eq('sharing_enabled', true)
      .order('updated_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).filter(r => r.lat != null && r.lng != null);
  };

  // Adjust wallet balance by `delta` (positive or negative). Goes through SECURITY DEFINER RPC.
  API.adminAdjustWallet = async (userId, delta, reason) => {
    const c = await client();
    const { data, error } = await c.rpc('admin_adjust_wallet', { p_user_id: userId, p_delta: delta, p_reason: reason || null });
    if (error) throw error;
    return data; // new balance
  };

  // Hard-delete a user (cascades to videos, wallet, etc. via FK on delete cascade)
  API.adminDeleteUser = async (userId) => {
    const c = await client();
    // Removes the login, which cascades to the profile and everything under
    // it. Deleting the profile directly left the email registered forever,
    // so the person could never sign up again. The function writes its own
    // admin_logs entry.
    const { error } = await c.rpc('admin_delete_user', { p_user: userId });
    if (!error) return;
    // Before 0039 the function does not exist; fall back to the old path so
    // the button still works on a database that has not been migrated yet.
    if (!/does not exist|Could not find/i.test(error.message || '')) throw error;
    const { error: e2 } = await c.from('profiles').delete().eq('id', userId);
    if (e2) throw e2;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'delete_user', target_type: 'user', target_id: userId });
  };

  API.adminFetchVideos = async ({ status = 'all', search = '' } = {}) => {
    const c = await client();
    let q = c.from('videos').select(`
      id, description, thumbnail, video_url, privacy, likes_count, comments_count, views_count, is_draft, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
    `).order('created_at', { ascending: false }).limit(200);
    if (status === 'published') q = q.eq('is_draft', false);
    if (status === 'draft') q = q.eq('is_draft', true);
    if (search) q = q.ilike('description', `%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminDeleteVideo = async (videoId) => {
    const c = await client();
    const { error } = await c.from('videos').delete().eq('id', videoId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'delete_video', target_type: 'video', target_id: videoId });
  };

  API.adminFetchComments = async ({ search = '' } = {}) => {
    const c = await client();
    let q = c.from('comments').select(`
      id, text, video_id, created_at,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).order('created_at', { ascending: false }).limit(200);
    if (search) q = q.ilike('text', `%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminDeleteComment = async (commentId) => {
    const c = await client();
    const { error } = await c.from('comments').delete().eq('id', commentId);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'delete_comment', target_type: 'comment', target_id: commentId });
  };

  API.adminFetchReports = async ({ status = 'pending', target_type = '' } = {}) => {
    const c = await client();
    let q = c.from('reports').select(`
      id, target_type, target_id, reason, status, action_taken, created_at, resolved_at,
      reporter:profiles!reports_reporter_id_fkey ( id, name, handle, avatar_url )
    `).order('created_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    if (target_type) q = q.eq('target_type', target_type);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.adminResolveReport = async (id, { action, status = 'resolved' }) => {
    const c = await client();

    // If dismissing as a false report, reverse any auto-hide that report may have triggered.
    if (status === 'dismissed') {
      const { data: report } = await c.from('reports').select('target_type, target_id').eq('id', id).single();
      if (report && (report.target_type === 'video' || report.target_type === 'comment')) {
        try { await c.rpc('admin_unhide_content', { p_target_type: report.target_type, p_target_id: report.target_id }); }
        catch (e) { console.warn('admin_unhide_content failed:', e.message); }
      }
    }

    const { error } = await c.from('reports').update({ status, action_taken: action || null, resolved_by: await uid(), resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'resolve_report', target_type: 'report', target_id: id, payload: { action } });
  };

  API.adminFetchLiveStreams = async () => {
    const c = await client();
    const { data, error } = await c.from('live_streams').select(`
      id, title, thumbnail, viewer_count, started_at, status, ended_at,
      host:profiles!live_streams_host_id_fkey ( id, name, handle, avatar_url )
    `).order('started_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  };

  API.adminEndLive = async (id) => {
    const c = await client();
    const { error } = await c.from('live_streams').update({ status: 'banned', ended_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'end_live', target_type: 'live_stream', target_id: id });
  };

  API.adminFetchLogs = async ({ limit = 100 } = {}) => {
    const c = await client();
    const { data, error } = await c.from('admin_logs').select(`
      id, action, target_type, target_id, payload, ip, created_at,
      admin:profiles!admin_logs_admin_id_fkey ( id, name, avatar_url )
    `).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  };

  // Ads
  API.adminFetchAds = async () => {
    const c = await client();
    const { data, error } = await c.from('ads').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  API.adminCreateAd = async (row) => {
    const c = await client(); const me = await uid();
    const { data, error } = await c.from('ads').insert({ ...row, created_by: me }).select().single();
    if (error) throw error;
    return data;
  };

  API.adminUpdateAd = async (id, patch) => {
    const c = await client();
    const { error } = await c.from('ads').update(patch).eq('id', id);
    if (error) throw error;
  };

  API.adminDeleteAd = async (id) => {
    const c = await client();
    const { error } = await c.from('ads').delete().eq('id', id);
    if (error) throw error;
  };

  // Notifications composer
  API.adminBroadcastNotification = async ({ title, body, target = {} }) => {
    const c = await client();
    let q = c.from('profiles').select('id');
    if (target.region) q = q.ilike('bio', `%${target.region}%`);
    const { data: targets } = await q.limit(10000);
    const rows = (targets || []).map(t => ({
      user_id: t.id,
      type: 'system',
      payload: { title, body },
    }));
    if (!rows.length) return 0;
    // Insert in chunks of 1000
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await c.from('notifications').insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }
    await c.from('admin_logs').insert({ admin_id: await uid(), action: 'broadcast_notification', target_type: 'system', target_id: null, payload: { title, count: inserted } });
    return inserted;
  };

  window.API = API;
})();
