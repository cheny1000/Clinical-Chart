/* ============================================================
   auth.js  —  Simple role-based auth for the clinical pharmacy app
   ============================================================

   Two roles:
   - "admin"      : full access (medications catalog admin, Supabase
                    settings, danger zone)
   - "pharmacist" : ward workflow only (rooms, patients, adding meds
                    to patients) — does NOT see the ⚙ admin button.

   Login is local-only in this version (no Supabase Auth yet).
   Passwords are stored in plain text in this file as a placeholder —
   in production you should replace this with Supabase Auth (email +
   password) which the same Supabase project already supports.

   The session is persisted in localStorage so the user stays logged
   in after refreshing / reopening the browser.
   ============================================================ */

(function (global) {
  "use strict";

  const SESSION_KEY = "pharma.session.v1";

  // ─── Credential store ───────────────────────────────────────
  // Edit these to set the hospital's credentials.
  // (For multi-user scenarios or stronger security, migrate to
  //  Supabase Auth later — same Supabase project.)
  const ACCOUNTS = {
    admin: {
      username: "admin",
      // Plain-text demo password — REPLACE in production
      password: "admin123",
      role: "admin",
      displayName: "المسؤول"
    },
    pharmacist: {
      username: "pharmacist",
      // Plain-text demo password — REPLACE in production
      password: "pharm123",
      role: "pharmacist",
      displayName: "الصيدلي السريري"
    }
  };

  // ─── Session ───────────────────────────────────────────────
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && s.username && s.role) return s;
      return null;
    } catch (e) { return null; }
  }

  function saveSession(account) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        username:    account.username,
        role:        account.role,
        displayName: account.displayName
      }));
      return true;
    } catch (e) { return false; }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); return true; }
    catch (e) { return false; }
  }

  function isLoggedIn() {
    return !!loadSession();
  }

  function getCurrentUser() {
    return loadSession();
  }

  function isAdmin() {
    const s = loadSession();
    return !!(s && s.role === "admin");
  }

  function isPharmacist() {
    const s = loadSession();
    return !!(s && s.role === "pharmacist");
  }

  // ─── Login ──────────────────────────────────────────────────
  // Returns { ok: true, account } on success, { ok: false, error } on failure.
  function login(username, password) {
    if (!username || !password) {
      return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };
    }
    // Match by username (case-insensitive)
    const account = Object.values(ACCOUNTS).find(
      a => a.username.toLowerCase() === username.trim().toLowerCase()
    );
    if (!account) {
      return { ok: false, error: "اسم المستخدم غير موجود" };
    }
    if (account.password !== password) {
      return { ok: false, error: "كلمة المرور غير صحيحة" };
    }
    saveSession(account);
    return { ok: true, account };
  }

  // ─── Quick role-login (one tap, used by the demo buttons) ────
  function loginAs(role) {
    const account = Object.values(ACCOUNTS).find(a => a.role === role);
    if (!account) return { ok: false, error: "الحساب غير موجود" };
    saveSession(account);
    return { ok: true, account };
  }

  function logout() {
    clearSession();
  }

  global.PharmacyAuth = {
    SESSION_KEY,
    ACCOUNTS,
    loadSession,
    saveSession,
    clearSession,
    isLoggedIn,
    getCurrentUser,
    isAdmin,
    isPharmacist,
    login,
    loginAs,
    logout
  };
})(window);
