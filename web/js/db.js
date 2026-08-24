/* === Supabase data access layer === */
(function () {
  if (!window.SB) { console.warn('SB not ready, db.js loaded too early'); return; }

  const API = {};

  async function client() { return await window.SB.client(); }
  async function uid() { const u = await window.SB.getUser(); return u ? u.id : null; }

  // ---------- Videos ----------
  API.publishVideo = async ({ file, thumbnail_url, description, music, sound_id = null, privacy = 'public', is_draft = false }) => {
    const c = await client();
    const userId = await uid();
    if (!userId) throw new Error('not signed in');

    let video_url = null;
    if (file) {
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
    }).select().single();
    if (error) throw error;
    return data;
  };

  API.fetchFeed = async ({ tab = 'foryou', limit = 20, offset = 0 } = {}) => {
    const c = await client();
    let data = [];

    if (tab === 'foryou') {
      try {
        const { data: rpcData, error: rpcErr } = await c.rpc('fetch_fyp_feed', { p_limit: limit, p_offset: offset });
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

  API.fetchSounds = async () => {
    const c = await client();
    const { data, error } = await c.from('sounds').select('*').order('usage_count', { ascending: false }).limit(50);
    if (error && error.code !== 'PGRST116') return [];
    return data || [];
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

  API.fetchUserVideos = async (userId) => {
    const c = await client();
    const { data, error } = await c.from('videos').select('id, description, thumbnail, video_url, likes_count, created_at')
      .eq('user_id', userId).eq('is_draft', false).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
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
    const c = await client();
    const { data, error } = await c.from('comments').select(`
      id, text, likes_count, created_at,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `).eq('video_id', videoId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
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
  API.follow = async (userId) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    if (me === userId) return false;
    const { error } = await c.from('follows').insert({ follower_id: me, followed_id: userId });
    if (error && error.code !== '23505') throw error;
    return true;
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
        title: c.type === 'group' ? (c.name || 'مجموعة') : (others[0] && others[0].name) || 'محادثة',
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

  // ---------- Locations ----------
  API.upsertLocation = async ({ lat, lng, accuracy, sharing_enabled = true, visibility = 'friends' }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_locations').upsert({
      user_id: me, lat, lng, accuracy, sharing_enabled, visibility, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  };

  API.setLocationVisibility = async (visibility) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('user_locations').upsert({ user_id: me, visibility, updated_at: new Date().toISOString() });
    if (error) throw error;
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
    `).in('user_id', ids).eq('sharing_enabled', true);
    if (error) throw error;
    return data || [];
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

  // ---------- Wallet & Gifts ----------
  API.fetchWallet = async () => {
    const c = await client(); const me = await uid(); if (!me) return { balance: 0 };
    const { data } = await c.from('wallets').select('balance').eq('user_id', me).maybeSingle();
    return data || { balance: 0 };
  };

  API.fetchWalletTx = async (filter = 'all') => {
    const c = await client(); const me = await uid(); if (!me) return [];
    let q = c.from('wallet_transactions').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(100);
    if (filter === 'in') q = q.in('type', ['topup', 'gift_received']);
    if (filter === 'out') q = q.in('type', ['gift_sent', 'withdrawal']);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };

  API.fetchGiftCatalog = async () => {
    const c = await client();
    const { data, error } = await c.from('gifts').select('*').eq('active', true).order('price');
    if (error) throw error;
    return data || [];
  };

  API.sendGift = async ({ toUserId, giftId, liveStreamId = null }) => {
    // Client-side ledger update — production needs an Edge Function for atomicity
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { data: gift } = await c.from('gifts').select('*').eq('id', giftId).single();
    if (!gift) throw new Error('gift not found');

    const { data: wallet } = await c.from('wallets').select('balance').eq('user_id', me).maybeSingle();
    const balance = (wallet && wallet.balance) || 0;
    if (balance < gift.price) throw new Error('insufficient balance');

    // Insert transaction record
    const { data: tx, error: txErr } = await c.from('gift_transactions').insert({
      from_user_id: me, to_user_id: toUserId, gift_id: giftId, live_stream_id: liveStreamId, amount: gift.price,
    }).select().single();
    if (txErr) throw txErr;

    // Two wallet updates + ledger entries
    await c.from('wallets').upsert({ user_id: me, balance: balance - gift.price, updated_at: new Date().toISOString() });
    await c.from('wallet_transactions').insert({ user_id: me, type: 'gift_sent', amount: gift.price, reference: tx.id, description: gift.name });

    const { data: rcv } = await c.from('wallets').select('balance').eq('user_id', toUserId).maybeSingle();
    const rcvBal = (rcv && rcv.balance) || 0;
    await c.from('wallets').upsert({ user_id: toUserId, balance: rcvBal + gift.price, updated_at: new Date().toISOString() });
    await c.from('wallet_transactions').insert({ user_id: toUserId, type: 'gift_received', amount: gift.price, reference: tx.id, description: gift.name });

    return tx;
  };

  // ---------- Live streams ----------
  API.fetchLiveStreams = async () => {
    const c = await client();
    const { data, error } = await c.from('live_streams').select(`
      id, title, thumbnail, viewer_count, started_at, status,
      host:profiles!live_streams_host_id_fkey ( id, name, handle, avatar_url )
    `).eq('status', 'live').order('viewer_count', { ascending: false });
    if (error) throw error;
    return data || [];
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

  // ---------- Reports ----------
  API.report = async ({ targetType, targetId, reason }) => {
    const c = await client(); const me = await uid(); if (!me) throw new Error('not signed in');
    const { error } = await c.from('reports').insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason });
    if (error) throw error;
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

  // NOTE: After migration 0007, the self_topup / self_withdraw RPCs are no longer
  // callable from the client. Top-ups must come from a verified payment webhook
  // (Edge Function → service-role → self_topup). For demo, admins can credit any
  // balance via the admin panel (admin_adjust_wallet, which IS gated).
  // We keep the client-side functions so the wallet UI can surface a clear,
  // localized error instead of a raw Postgres "permission denied" message.
  API.selfTopup = async (amount, pkg = null) => {
    const c = await client();
    const { data, error } = await c.rpc('self_topup', { p_amount: amount, p_package: pkg });
    if (error) {
      if (/permission denied|not allowed|insufficient/i.test(error.message || '')) {
        throw new Error('سيتم تفعيل الدفع عبر Apple Pay / Stripe قبل الإطلاق الرسمي. للاختبار اطلب من المشرف شحن رصيدك.');
      }
      throw error;
    }
    return data;
  };

  API.selfWithdraw = async (amount, method = null) => {
    const c = await client();
    const { data, error } = await c.rpc('self_withdraw', { p_amount: amount, p_method: method });
    if (error) {
      if (/permission denied|not allowed/i.test(error.message || '')) {
        throw new Error('السحب يتطلب التحقق من الهوية — سيتم تفعيله قبل الإطلاق.');
      }
      throw error;
    }
    return data;
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
    const { error } = await c.from('profiles').delete().eq('id', userId);
    if (error) throw error;
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
