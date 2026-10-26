/* === FLYP admin v2 - data layer ===
 *
 * Every call goes to the Mumbai project with the signed-in admin's own JWT.
 * Anything that touches is_admin / banned_until / deletion state, or acts on
 * someone else's content, goes through the admin_v2_* SECURITY DEFINER
 * functions from supabase/migrations/0128_admin_v2.sql: since 0124 the
 * authenticated role cannot even SELECT those profile columns, and each
 * function writes its own admin_logs row.
 */
(function () {
  const CFG = window.FLYP_ADMIN_V2_CONFIG;
  if (!CFG || !/^https:\/\/vfkwipvinmnybilcrdzr\.supabase\.co$/.test(CFG.url)) {
    throw new Error('admin v2: refusing to start without the Mumbai project config');
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('admin v2: supabase-js did not load');
  }

  const sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage,
      storageKey: CFG.storageKey,
    },
  });

  class ApiError extends Error {
    constructor(message, code) { super(message); this.code = code || null; }
  }

  // PGRST202 = function not found: 0128 has not been applied yet.
  function fail(error) {
    if (!error) return;
    const msg = error.message || String(error);
    if (error.code === 'PGRST202' || /Could not find the function/i.test(msg)) {
      throw new ApiError('MIGRATION_MISSING', 'migration');
    }
    if (error.code === '42501' || /not permitted/i.test(msg)) throw new ApiError('NOT_ADMIN', 'forbidden');
    throw new ApiError(msg, error.code);
  }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    fail(error);
    return data;
  }

  const API = {
    sb,
    ApiError,

    // ---------- auth ----------
    async session() {
      const { data } = await sb.auth.getSession();
      return data && data.session ? data.session : null;
    },
    async signInPassword(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signOut() { try { await sb.auth.signOut(); } catch (e) { /* already gone */ } },
    // is_admin() answers only for auth.uid() (0002), and stays granted to
    // authenticated after 0124.
    async isAdmin() { return (await rpc('is_admin')) === true; },
    async me() {
      const s = await API.session();
      if (!s) return null;
      const { data } = await sb.from('profiles').select('id, name, handle, avatar_url').eq('id', s.user.id).maybeSingle();
      return { id: s.user.id, email: s.user.email, name: data && data.name, handle: data && data.handle, avatar: data && data.avatar_url };
    },

    // ---------- dashboard ----------
    counts: () => rpc('admin_v2_counts'),
    async growth(days) {
      const { data, error } = await sb.rpc('admin_growth', { p_days: days });
      if (error) return [];
      return data || [];
    },
    moderationRecent: (limit) => rpc('admin_moderation_recent', { p_limit: limit || 100 }),

    // ---------- users ----------
    listUsers: (search, status, limit, offset) =>
      rpc('admin_v2_list_users', { p_search: search || null, p_status: status || 'all', p_limit: limit || 50, p_offset: offset || 0 }),
    userDetail: (id) => rpc('admin_v2_user_detail', { p_user: id }),
    setBan: (id, until, reason) => rpc('admin_v2_set_ban', { p_user: id, p_until: until, p_reason: reason || null }),
    setAdmin: (id, make) => rpc('admin_v2_set_admin', { p_user: id, p_make: !!make }),
    setVerified: (id, v) => rpc('admin_v2_set_verified', { p_user: id, p_verified: !!v }),
    deleteUser: (id) => rpc('admin_delete_user', { p_user: id }),
    pendingDeletions: () => rpc('admin_pending_deletions'),
    cancelDeletion: (id) => rpc('admin_cancel_deletion', { p_user: id }),

    // ---------- reports / content ----------
    listReports: (status, type, limit, offset) =>
      rpc('admin_v2_list_reports', { p_status: status || 'pending', p_type: type || null, p_limit: limit || 100, p_offset: offset || 0 }),
    resolveReport: (id, status, action, allForTarget) =>
      rpc('admin_v2_resolve_report', { p_report: id, p_status: status, p_action: action || null, p_all_for_target: allForTarget !== false }),
    setHidden: (type, id, hidden, reason) => rpc('admin_v2_set_hidden', { p_type: type, p_id: id, p_hidden: !!hidden, p_reason: reason || null }),
    deleteContent: (type, id, reason) => rpc('admin_v2_delete_content', { p_type: type, p_id: id, p_reason: reason || null }),
    listVideos: (filter, search, limit, offset) =>
      rpc('admin_v2_list_videos', { p_filter: filter || 'all', p_search: search || null, p_limit: limit || 60, p_offset: offset || 0 }),
    listStories: (filter, limit) => rpc('admin_v2_list_stories', { p_filter: filter || 'active', p_limit: limit || 100 }),
    listLives: (status, limit) => rpc('admin_v2_list_lives', { p_status: status || 'live', p_limit: limit || 100 }),
    liveComments: (id, limit) => rpc('admin_v2_live_comments', { p_live: id, p_limit: limit || 200 }),
    endLive: (id, reason) => rpc('admin_v2_end_live', { p_live: id, p_reason: reason || null }),

    // ---------- money (read-only) ----------
    wallet: (days) => rpc('admin_v2_wallet_overview', { p_days: days || 30 }),

    // ---------- store refunds + accounts to review (0127, if applied) ----------
    // Read straight from the tables under their admin-only RLS. null = the
    // table does not exist on this database yet (0127 not applied).
    async refunds(limit) {
      const { data, error } = await sb.from('iap_refunds')
        .select('store_transaction_id, platform, user_id, outcome, coins_reversed, balance_after, reason, refunded_at, recorded_at, profiles:profiles!iap_refunds_user_id_fkey(handle,name)')
        .order('recorded_at', { ascending: false }).limit(limit || 100);
      if (error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find the table/i.test(error.message || ''))) return null;
      fail(error);
      return data || [];
    },
    async walletFlags() {
      const { data, error } = await sb.from('wallet_flags')
        .select('user_id, refund_count, refunded_coins, reason, flagged_at, updated_at, reviewed_at, review_note, profiles:profiles!wallet_flags_user_id_fkey(handle,name)')
        .order('updated_at', { ascending: false }).limit(200);
      if (error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find the table/i.test(error.message || ''))) return null;
      fail(error);
      return data || [];
    },
    async reviewWalletFlag(userId, note, adminId) {
      const { error } = await sb.from('wallet_flags')
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: adminId, review_note: note || null })
        .eq('user_id', userId);
      fail(error);
    },

    // ---------- support desk (admin policies from 0033/0124) ----------
    async tickets(status) {
      let q = sb.from('support_tickets')
        .select('*, profiles:profiles!support_tickets_user_id_fkey(id,name,handle,avatar_url)')
        .order('created_at', { ascending: false }).limit(200);
      if (status && status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      fail(error);
      return data || [];
    },
    async replyTicket(id, reply, status, adminId) {
      const { error } = await sb.from('support_tickets').update({
        admin_reply: reply, status, replied_at: new Date().toISOString(), replied_by: adminId,
      }).eq('id', id);
      fail(error);
    },
    async setTicketStatus(id, status) {
      const { error } = await sb.from('support_tickets').update({ status }).eq('id', id);
      fail(error);
    },

    // ---------- data export requests (0037) ----------
    async exports() {
      const { data, error } = await sb.from('data_export_requests')
        .select('*, profiles:profiles!data_export_requests_user_id_fkey(id,name,handle)')
        .order('requested_at', { ascending: false }).limit(200);
      fail(error);
      return data || [];
    },
    async completeExport(id, url) {
      const { error } = await sb.from('data_export_requests')
        .update({ status: 'ready', file_url: url, completed_at: new Date().toISOString() }).eq('id', id);
      fail(error);
    },
    async failExport(id) {
      const { error } = await sb.from('data_export_requests')
        .update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', id);
      fail(error);
    },

    // ---------- storage ----------
    storage: () => rpc('admin_v2_storage_overview'),
    async updateLimits(patch) {
      const { error } = await sb.from('app_limits').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
      fail(error);
    },

    // ---------- usage watcher: R2 + Agora (0129) ----------
    usage: () => rpc('admin_v2_usage_overview'),
    // For the banner on every page: [] whenever it cannot be read (0129 not
    // applied yet, network), so a missing migration never breaks a page.
    async usageOpenAlerts() {
      try {
        const d = await rpc('admin_v2_usage_open_alerts');
        return Array.isArray(d) ? d : [];
      } catch (e) { return []; }
    },
    // null leaves a value unchanged.
    setUsageLimits: (p) => rpc('admin_v2_set_usage_limits', {
      p_r2_storage_bytes: p.r2_storage_bytes ?? null,
      p_r2_storage_baseline_bytes: p.r2_storage_baseline_bytes ?? null,
      p_r2_class_a_ops: p.r2_class_a_ops ?? null,
      p_r2_class_b_ops: p.r2_class_b_ops ?? null,
      p_agora_minutes: p.agora_minutes ?? null,
      p_alert_emails: p.alert_emails ?? null,
    }),
    // id null = acknowledge every open alert.
    ackUsageAlert: (id) => rpc('admin_v2_ack_usage_alert', { p_id: id == null ? null : Number(id) }),

    // ---------- creator payouts (0130) ----------
    // Every function refuses unless is_admin() and writes admin_logs itself.
    // The KYC / withdrawal tables have no grants for authenticated: RPCs only.
    payoutOverview: () => rpc('admin_v2_payout_overview'),
    // For the sidebar badges, the bell and the dashboard: {} whenever 0130 is
    // not applied (or the network fails), so it never breaks a page.
    async payoutCounts() {
      try {
        const o = await rpc('admin_v2_payout_overview');
        if (!o) return {};
        return {
          payouts_waiting: Number((o.requested && o.requested.count) || 0) + Number((o.approved && o.approved.count) || 0),
          kyc_pending: Number(o.kyc_pending || 0),
        };
      } catch (e) { return {}; }
    },
    kycList: (status, limit, offset) =>
      rpc('admin_v2_kyc_list', { p_status: status || 'pending', p_limit: limit || 50, p_offset: offset || 0 }),
    // ID photo: the RPC logs the view and returns the object path; the admin's
    // own session signs a 120-second URL ("kyc admin read" storage policy).
    // Never cached or put in a link.
    async kycPhotoUrl(kycId) {
      const doc = await rpc('admin_v2_kyc_document', { p_kyc_id: kycId });
      if (!doc || !doc.path) throw new ApiError('NO_DOCUMENT', 'no_document');
      const { data, error } = await sb.storage.from('kyc').createSignedUrl(doc.path, 120);
      fail(error);
      if (!data || !data.signedUrl) throw new ApiError('NO_DOCUMENT', 'no_document');
      return data.signedUrl;
    },
    kycReview: (id, approve, reason) =>
      rpc('admin_v2_kyc_review', { p_kyc_id: id, p_approve: !!approve, p_reason: reason || null }),
    withdrawals: (status, limit, offset) =>
      rpc('admin_v2_payout_withdrawals', { p_status: status || 'requested', p_limit: limit || 50, p_offset: offset || 0 }),
    approveWithdrawal: (id, note) => rpc('admin_v2_payout_approve', { p_id: id, p_note: note || null }),
    markWithdrawalPaid: (id, reference) => rpc('admin_v2_payout_mark_paid', { p_id: id, p_reference: reference }),
    rejectWithdrawal: (id, reason) => rpc('admin_v2_payout_reject', { p_id: id, p_reason: reason }),
    // Only the fields that change; null keeps the current value.
    setPayoutConfig: (p) => rpc('admin_v2_payout_set_config', {
      p_diamonds_per_coin: p.diamonds_per_coin ?? null,
      p_sar_per_diamond: p.sar_per_diamond ?? null,
      p_min_withdraw_sar: p.min_withdraw_sar ?? null,
      p_hold_days: p.hold_days ?? null,
      p_min_account_age_days: p.min_account_age_days ?? null,
      p_min_age: p.min_age ?? null,
      p_refund_lookback_days: p.refund_lookback_days ?? null,
      p_active: p.active ?? null,
    }),
    payoutCreator: (userId) => rpc('admin_v2_payout_creator', { p_user: userId }),
    payoutHold: (userId, hold, reason) => rpc('admin_v2_payout_hold', { p_user: userId, p_hold: !!hold, p_reason: reason || null }),
    setEarning: (earningId, action, reason) => rpc('admin_v2_payout_set_earning', { p_earning_id: earningId, p_action: action, p_reason: reason || null }),
    payoutBackfill: (sinceIso) => rpc('admin_v2_payout_backfill', { p_since: sinceIso }),

    // ---------- appeals (0132) ----------
    // Counts for the tabs, the sidebar badge, the bell and the dashboard.
    appealCounts: () => rpc('admin_v2_appeal_counts'),
    // {} whenever 0132 is not applied (or the network fails), so it never
    // breaks a page.
    async appealBadge() {
      try {
        const o = await rpc('admin_v2_appeal_counts');
        return o ? { appeals_open: Number(o.open || 0) } : {};
      } catch (e) { return {}; }
    },
    // status: open | accepted | rejected | all (the RPC caps the limit at 200).
    listAppeals: (status, limit, offset) =>
      rpc('admin_v2_list_appeals', { p_status: status || 'open', p_limit: limit || 50, p_offset: offset || 0 }),
    decideAppeal: (id, accept, note) =>
      rpc('admin_v2_decide_appeal', { p_appeal: id, p_accept: !!accept, p_note: note || null }),

    // ---------- audit log ----------
    async logs(limit) {
      const { data, error } = await sb.from('admin_logs')
        .select('id, action, target_type, target_id, payload, created_at, admin:profiles!admin_logs_admin_id_fkey(handle,name)')
        .order('created_at', { ascending: false }).limit(limit || 200);
      fail(error);
      return data || [];
    },
  };

  window.AdminV2API = API;
})();
