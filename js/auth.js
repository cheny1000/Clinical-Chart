/* ============================================================
   auth.js  —  Multi-user auth for the clinical pharmacy app
   ============================================================

   Two roles:
     - "admin"      : full access (medications catalog, Supabase
                      settings, user management, audit log, danger
                      zone)
     - "pharmacist" : ward workflow only (rooms, patients, adding
                      meds to patients) — does NOT see admin tools.

   Login flow:
     1. User enters username + password on the login screen.
     2. The app fetches the matching row from Supabase `users`.
     3. The row contains password_hash (PBKDF2-SHA256, format
        "salt:iterations:hash_hex") or the special 'LEGACY:<plaintext>'
        sentinel for the default admin account.
     4. The app hashes the entered password with the same salt +
        iterations and compares.
     5. If valid AND the user is active → save session and proceed.
        Otherwise → show error.

   Sessions are persisted in localStorage so the user stays logged
   in after refreshing / reopening the browser.

   Sensitive actions (patient add/delete, med delete, wipe) are
   logged via auditLog() which inserts a row into Supabase
   `audit_log`. Admins can view the log in the admin panel.
   ============================================================ */

(function (global) {
  "use strict";

  const SESSION_KEY = "pharma.session.v1";

  // ---------- PBKDF2 password hashing ----------
  // We use the Web Crypto API (SubtleCrypto) which is available in
  // all modern browsers (and in the iOS PWA webview). PBKDF2 with
  // SHA-256, 100,000 iterations, and a 16-byte salt is the standard
  // recommendation for password storage.
  const PBKDF2_ITERATIONS = 100000;
  const SALT_BYTES = 16;

  // Salt → hex (for storage as part of the password_hash string)
  function bufToHex(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
      s += bytes[i].toString(16).padStart(2, "0");
    }
    return s;
  }
  // hex → Uint8Array (for re-importing the salt during verification)
  function hexToBuf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  // Hash a password with a given salt + iterations, returning the
  // hash as a hex string.
  async function pbkdf2Hash(password, saltBytes, iterations) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: iterations,
        hash: "SHA-256"
      },
      keyMaterial,
      256 // 256 bits = 64 hex chars
    );
    return bufToHex(bits);
  }

  // Generate a hash string for a NEW password (used by createUser
  // and resetPassword). Returns "salt_hex:iterations:hash_hex".
  async function hashNewPassword(password) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const saltHex = bufToHex(saltBytes);
    const hashHex = await pbkdf2Hash(password, saltBytes, PBKDF2_ITERATIONS);
    return saltHex + ":" + PBKDF2_ITERATIONS + ":" + hashHex;
  }

  // Verify a password against a stored hash. Returns true/false.
  // Handles both the PBKDF2 format and the LEGACY sentinel.
  async function verifyPassword(password, storedHash) {
    if (!storedHash) return false;
    // LEGACY:<plaintext> → plaintext comparison (used only for the
    // default admin account that hasn't been re-hashed yet).
    if (storedHash.startsWith("LEGACY:")) {
      const plaintext = storedHash.slice("LEGACY:".length);
      return password === plaintext;
    }
    // PBKDF2 format: salt_hex:iterations:hash_hex
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const saltHex = parts[0];
    const iterations = parseInt(parts[1], 10);
    const storedHashHex = parts[2];
    if (!saltHex || !iterations || !storedHashHex) return false;
    try {
      const saltBytes = hexToBuf(saltHex);
      const candidateHashHex = await pbkdf2Hash(password, saltBytes, iterations);
      // Constant-time comparison (avoid timing attacks — although the
      // risk is minimal here since the comparison is in the browser).
      if (candidateHashHex.length !== storedHashHex.length) return false;
      let diff = 0;
      for (let i = 0; i < candidateHashHex.length; i++) {
        diff |= candidateHashHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
      }
      return diff === 0;
    } catch (e) {
      console.warn("[Auth] verifyPassword error:", e);
      return false;
    }
  }

  // ---------- Session ----------
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
        displayName: account.displayName,
        gender:      account.gender || "male"
      }));
      return true;
    } catch (e) { return false; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); return true; }
    catch (e) { return false; }
  }

  function isLoggedIn()  { return !!loadSession(); }
  function getCurrentUser() { return loadSession(); }
  function isAdmin() {
    const s = loadSession();
    return !!(s && s.role === "admin");
  }
  function isPharmacist() {
    const s = loadSession();
    return !!(s && s.role === "pharmacist");
  }
  function isDoctor() {
    const s = loadSession();
    return !!(s && s.role === "doctor");
  }

  // ---------- Login ----------
  // Fetches the user row from Supabase `users` and verifies the
  // password. Returns { ok: true, account } on success or
  // { ok: false, error } on failure.
  //
  // Side effect: if the stored password is the LEGACY sentinel and
  // the password matches, we re-hash it with PBKDF2 and update the
  // row in Supabase (so future logins use the secure comparison).
  async function login(username, password) {
    if (!username || !password) {
      return { ok: false, error: "أدخل اسم المستخدم وكلمة المرور" };
    }
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured || !SB.isConfigured()) {
      // Supabase not configured → fall back to legacy local accounts
      // (the original 2 hardcoded accounts from before this update).
      // This lets the app work in offline mode before the user sets
      // up Supabase.
      return legacyLogin(username, password);
    }
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    try {
      // Fetch the user row by username (case-insensitive)
      const { data, error } = await client
        .from("users")
        .select("*")
        .ilike("username", username.trim().toLowerCase());
      if (error) return { ok: false, error: error.message };
      if (!Array.isArray(data) || data.length === 0) {
        return { ok: false, error: "اسم المستخدم غير موجود" };
      }
      const row = data[0];
      if (row.active === false) {
        return { ok: false, error: "هذا الحساب معطّل — راجع المسؤول" };
      }
      const valid = await verifyPassword(password, row.password_hash || "");
      if (!valid) {
        return { ok: false, error: "كلمة المرور غير صحيحة" };
      }
      // Save the session (without password_hash).
      // display_name may contain a '|male' or '|female' suffix (used
      // for the welcome message). We split it into a clean displayName
      // and a gender field so the caller doesn't need to parse it.
      const rawName = row.display_name || row.username;
      const parts = rawName.split("|");
      const cleanName = (parts[0] || "").trim() || row.username;
      const gender = parts[1] === "female" ? "female" : "male";
      const account = {
        username:    row.username,
        role:        row.role || "pharmacist",
        displayName: cleanName,
        gender:      gender
      };
      saveSession(account);

      // If the stored hash was the LEGACY sentinel, re-hash the
      // password with PBKDF2 and update the row in Supabase. This
      // upgrades the legacy plaintext to a real hash so future
      // logins are properly secure.
      if ((row.password_hash || "").startsWith("LEGACY:")) {
        try {
          const newHash = await hashNewPassword(password);
          await client
            .from("users")
            .update({ password_hash: newHash })
            .eq("id", row.id);
        } catch (e) {
          console.warn("[Auth] failed to upgrade legacy hash:", e);
          // Non-fatal — the login itself already succeeded.
        }
      }
      return { ok: true, account };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Legacy fallback: works without Supabase using the original 2
  // hardcoded accounts (Admin / 19559 + pharmacist / pharm123).
  // Used only when Supabase isn't configured yet.
  const LEGACY_ACCOUNTS = {
    admin: {
      username: "Admin", password: "19559",
      role: "admin", displayName: "المسؤول", gender: "male"
    },
    pharmacist: {
      username: "pharmacist", password: "pharm123",
      role: "pharmacist", displayName: "الصيدلي السريري", gender: "male"
    }
  };
  function legacyLogin(username, password) {
    const account = Object.values(LEGACY_ACCOUNTS).find(
      a => a.username.toLowerCase() === username.trim().toLowerCase()
    );
    if (!account) return { ok: false, error: "اسم المستخدم غير موجود" };
    if (account.password !== password) return { ok: false, error: "كلمة المرور غير صحيحة" };
    saveSession(account);
    return { ok: true, account };
  }

  function loginAs(role) {
    // Demo button — only used for the quick-login pharmacist button
    // on the login screen. Falls back to the legacy account so the
    // button still works even before Supabase is configured.
    const account = Object.values(LEGACY_ACCOUNTS).find(a => a.role === role);
    if (!account) return { ok: false, error: "الحساب غير موجود" };
    saveSession(account);
    return { ok: true, account };
  }

  function logout() {
    clearSession();
  }

  // ---------- User management (admin only) ----------
  // All of these call Supabase directly. The app's admin panel
  // wires these to UI buttons. Each function returns
  // { ok: true, ... } or { ok: false, error }.

  async function listUsers() {
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return { ok: false, error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { data, error } = await client
        .from("users")
        .select("id, username, display_name, role, active, created_by, created_at")
        .order("created_at", { ascending: true });
      if (error) return { ok: false, error: error.message };
      return { ok: true, users: data || [] };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Create a new user. `creatorUsername` is the admin who's creating
  // the account (for the `created_by` field).
  // `gender` is 'male' or 'female' — appended to display_name as
  // '|male' or '|female' for the welcome message feature.
  async function createUser(creatorUsername, username, password, displayName, role, gender) {
    if (!username || !password || !displayName) {
      return { ok: false, error: "أدخل جميع الحقول" };
    }
    if (role !== "admin" && role !== "pharmacist" && role !== "doctor") {
      role = "pharmacist";
    }
    if (gender !== "male" && gender !== "female") {
      gender = "male";
    }
    if (password.length < 4) {
      return { ok: false, error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل" };
    }
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return { ok: false, error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const passwordHash = await hashNewPassword(password);
      // Append gender suffix to display_name: "عبدالله رائد|male"
      const fullDisplayName = displayName.trim() + "|" + gender;
      const { data, error } = await client
        .from("users")
        .insert([{
          username: username.trim().toLowerCase(),
          password_hash: passwordHash,
          display_name: fullDisplayName,
          role: role,
          active: true,
          created_by: creatorUsername || "admin"
        }])
        .select("id, username, display_name, role, active, created_at");
      if (error) {
        // Handle duplicate username (UNIQUE constraint)
        if (error.message && error.message.toLowerCase().includes("duplicate")) {
          return { ok: false, error: "اسم المستخدم موجود بالفعل" };
        }
        return { ok: false, error: error.message };
      }
      return { ok: true, user: data && data[0] };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Reset a user's password.
  async function resetPassword(userId, newPassword) {
    if (!newPassword || newPassword.length < 4) {
      return { ok: false, error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل" };
    }
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return { ok: false, error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const passwordHash = await hashNewPassword(newPassword);
      const { error } = await client
        .from("users")
        .update({ password_hash: passwordHash })
        .eq("id", userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Toggle active/inactive (soft disable, not delete).
  async function toggleUserActive(userId, currentActive) {
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return { ok: false, error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { error } = await client
        .from("users")
        .update({ active: !currentActive })
        .eq("id", userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Permanently delete a user (admin only).
  async function deleteUser(userId) {
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return { ok: false, error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { error } = await client
        .from("users")
        .delete()
        .eq("id", userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // ---------- Audit log ----------
  // Log a sensitive action. Best-effort — failure to log doesn't
  // block the action. Called from app.js after each sensitive op.
  async function auditLog(action, details) {
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return; // silent skip
    const client = SB.getClient();
    if (!client) return;
    const session = loadSession();
    if (!session) return;
    try {
      await client.from("audit_log").insert([{
        username: session.username,
        action:   action,
        details:  details || null
      }]);
    } catch (e) {
      console.warn("[Auth] auditLog failed:", e);
    }
  }

  // Read the audit log (admin only). Returns the latest N entries.
  async function getAuditLog(limit) {
    const SB = global.PharmacySupabase;
    if (!SB || !SB.isConfigured()) return { ok: false, error: "Supabase غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { data, error } = await client
        .from("audit_log")
        .select("id, username, action, details, created_at")
        .order("created_at", { ascending: false })
        .limit(limit || 200);
      if (error) return { ok: false, error: error.message };
      return { ok: true, entries: data || [] };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  global.PharmacyAuth = {
    SESSION_KEY,
    // session
    loadSession, saveSession, clearSession,
    isLoggedIn, getCurrentUser, isAdmin, isPharmacist, isDoctor,
    // login / logout
    login, loginAs, logout,
    // user management (admin only)
    listUsers, createUser, resetPassword, toggleUserActive, deleteUser,
    // audit log
    auditLog, getAuditLog
  };
})(window);
