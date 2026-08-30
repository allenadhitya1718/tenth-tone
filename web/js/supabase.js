/* === Supabase client + auth helpers === */
(function () {
  const SUPABASE_URL = 'https://qnzgxihlrwanywndcmpf.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_dMa7Ce6Gml-NC4bCmbsC9Q_DR16xAdf';

  // Load supabase-js from CDN dynamically (so the rest of the app keeps working
  // even if the CDN is briefly down; we just fall back to mock data).
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const ready = (async () => {
    if (!window.supabase) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.46.1/dist/umd/supabase.min.js');
      } catch (e) {
        console.warn('Supabase SDK failed to load — falling back to mock auth.', e);
        return null;
      }
    }
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: 'tt-auth' },
    });
    return client;
  })();

  // === Public API ===
  const SB = {
    ready,
    async client() { return await ready; },

    // ---------- Auth ----------
    async signUp({ email, phone, password, name, handle }) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      // Refuse rather than send a blank. This used to pass `name || ''`, and
      // the profile trigger's coalesce chain only replaces NULL — an empty
      // string went straight through it and produced a nameless account.
      const cleanName = (name || '').trim();
      if (cleanName.length < 2) throw new Error('الاسم مطلوب');
      // handle_new_user reads this out of raw_user_meta_data. Sent only when
      // it is genuinely set and valid, so the trigger's generated fallback
      // still applies to any account created by another route.
      const cleanHandle = String(handle || '').trim().toLowerCase();
      const meta = { name: cleanName };
      if (/^[a-z0-9._]{3,30}$/.test(cleanHandle)) meta.handle = cleanHandle;
      const opts = { password, options: { data: meta } };
      if (email) opts.email = email; else if (phone) opts.phone = phone;
      const { data, error } = await c.auth.signUp(opts);
      if (error) throw error;
      return data;
    },

    async signIn({ email, phone, password }) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const params = { password };
      if (email) params.email = email; else if (phone) params.phone = phone;
      const { data, error } = await c.auth.signInWithPassword(params);
      if (error) throw error;
      return data;
    },

    // Resend the signup confirmation code.
    //
    // This used to call signInWithOtp, which was the wrong flow entirely: that
    // starts a passwordless login and so makes Supabase send the Magic Link
    // template, not Confirm signup. The result was an email headed "Magic Link"
    // carrying a link instead of the six digit code the screen asks for.
    //
    // resend re-sends the original signup confirmation, so it uses the Confirm
    // signup template and the code matches the type 'signup' that the OTP
    // screen verifies against.
    async resendSignup(email) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const { data, error } = await c.auth.resend({ type: 'signup', email });
      if (error) throw error;
      return data;
    },

    async verifyOtp({ email, phone, token, type = 'email' }) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const params = { token, type };
      if (email) {
        params.email = email;
        // Only fall back to a guess when the caller did not name a type.
        // 'recovery' and 'signup' are both email types and must survive.
        if (!type || type === 'email' || type === 'sms') params.type = 'email';
      } else if (phone) {
        params.phone = phone;
        params.type = 'sms';
      }
      const { data, error } = await c.auth.verifyOtp(params);
      if (error) throw error;
      return data;
    },

    async resetPassword(email) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      // No redirect: recovery is by six digit code, verified with
      // verifyRecoveryCode. A redirect would only make sense for a link,
      // and the app has no screen that consumes one.
      const { error } = await c.auth.resetPasswordForEmail(email);
      if (error) throw error;
    },

    // Confirms the signed-in user really knows their current password, the way
    // every real app re-asks before a sensitive change.
    //
    // This runs on a THROWAWAY client with persistSession off, so neither a
    // wrong guess nor a correct one can touch the live session. Signing in on
    // the shared client would rewrite the stored session as a side effect.
    async verifyPassword(currentPassword) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const { data: u } = await c.auth.getUser();
      const email = u && u.user && u.user.email;
      if (!email) throw new Error('no-email');
      const probe = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await probe.auth.signInWithPassword({ email, password: currentPassword });
      try { await probe.auth.signOut({ scope: 'local' }); } catch (e) {}
      if (!error) return true;
      // Anything other than a plain rejection is worth surfacing as itself
      // (rate limiting, network) rather than reporting a wrong password.
      if (/invalid login credentials/i.test(error.message || '')) return false;
      throw error;
    },

    // Ends every other session but this one, after a password change.
    async signOutOtherDevices() {
      const c = await ready; if (!c) return;
      const { error } = await c.auth.signOut({ scope: 'others' });
      if (error) throw error;
    },

    async changeEmail(newEmail) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      // Code based, like the rest. Supabase mails the new address a token
      // which verifyEmailChange below exchanges.
      const { error } = await c.auth.updateUser({ email: newEmail });
      if (error) throw error;
    },

    // The code sent to the new address after changeEmail.
    async verifyEmailChange(newEmail, token) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const { data, error } = await c.auth.verifyOtp({ email: newEmail, token, type: 'email_change' });
      if (error) throw error;
      return data;
    },

    async updatePassword(newPassword) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const { data, error } = await c.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return data;
    },

    // Password recovery by code rather than by link. The emailed template must
    // include {{ .Token }} for a code to be there at all.
    async verifyRecoveryCode(email, token) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const { data, error } = await c.auth.verifyOtp({ email, token, type: 'recovery' });
      if (error) throw error;
      return data;
    },

    async signOut() {
      const c = await ready; if (!c) return;
      await c.auth.signOut();
    },

    async getSession() {
      const c = await ready; if (!c) return null;
      const { data } = await c.auth.getSession();
      return data.session;
    },

    // The signed-in user, read from the session already held locally.
    //
    // This used to call auth.getUser(), which asks the auth server to
    // re-validate the token on every single call — measured at 206-289ms.
    // Between db.js (119 uses via uid()) and the screens (15 more), almost
    // every action in the app paid that round trip before doing its actual
    // work, which roughly doubled the latency of everything.
    //
    // The session carries the same user object, decoded from the JWT the
    // client already holds, and returns in about 1ms.
    //
    // Safe, because this value never authorises anything. It is used to
    // build queries and to decide what to show; Postgres derives auth.uid()
    // from the JWT itself and RLS enforces access server-side. A stale or
    // tampered value here gets nothing back from the database.
    //
    // Use getUserVerified() for the rare case that genuinely needs the auth
    // server's own answer — confirming an account still exists before a
    // destructive action, for instance.
    async getUser() {
      const c = await ready; if (!c) return null;
      const { data } = await c.auth.getSession();
      return (data && data.session && data.session.user) || null;
    },

    // Round-trips to the auth server. Costs ~230ms; use deliberately.
    async getUserVerified() {
      const c = await ready; if (!c) return null;
      const { data } = await c.auth.getUser();
      return data.user;
    },

    onAuthChange(cb) {
      ready.then(c => { if (c) c.auth.onAuthStateChange((event, session) => cb(event, session)); });
    },

    // ---------- Profiles ----------
    async getProfile(userId) {
      const c = await ready; if (!c) return null;
      const { data, error } = await c.from('profiles').select('*').eq('id', userId).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },

    async updateProfile(userId, fields) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const { data, error } = await c.from('profiles').update(fields).eq('id', userId).select().single();
      if (error) throw error;
      return data;
    },

    // ---------- Storage ----------
    async uploadAvatar(userId, file) {
      const c = await ready; if (!c) throw new Error('SDK not loaded');
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error } = await c.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
      if (error) throw error;
      const { data: pub } = c.storage.from('avatars').getPublicUrl(path);
      return pub.publicUrl;
    },
  };

  window.SB = SB;
})();
