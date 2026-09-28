/* ============================================================
   supabase-client.js
   Reads Supabase configuration from localStorage and exposes a
   singleton client. Configuration is stored at:
     pharma.supabase.v1 = { url: "...", anonKey: "..." }
   ============================================================ */

(function (global) {
  "use strict";

  const STORAGE_KEY = "pharma.supabase.v1";

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const cfg = JSON.parse(raw);
      if (cfg && cfg.url && cfg.anonKey) return cfg;
      return null;
    } catch (e) {
      console.warn("[Supabase] loadConfig failed:", e);
      return null;
    }
  }

  function saveConfig(url, anonKey) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, anonKey }));
      return true;
    } catch (e) {
      console.warn("[Supabase] saveConfig failed:", e);
      return false;
    }
  }

  function clearConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) { return false; }
  }

  function isConfigured() {
    return !!loadConfig();
  }

  // Build the Supabase client from the global `supabase` UMD object
  // (loaded from the CDN in index.html).
  function getClient() {
    const cfg = loadConfig();
    if (!cfg) return null;
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      console.warn("[Supabase] supabase-js not loaded (check CDN)");
      return null;
    }
    // create a fresh client each time it's requested to keep it stateless;
    // for typical ward-scale usage this is fine.
    return global.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  // Test connection by selecting one row from the medications table.
  async function testConnection() {
    const client = getClient();
    if (!client) {
      return { ok: false, error: "Supabase غير مُهيّأ أو مكتبة supabase-js غير محمّلة" };
    }
    try {
      const { data, error } = await client
        .from("medications")
        .select("id")
        .limit(1);
      if (error) {
        return { ok: false, error: error.message || String(error) };
      }
      return { ok: true, count: Array.isArray(data) ? data.length : 0 };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  global.PharmacySupabase = {
    STORAGE_KEY,
    loadConfig,
    saveConfig,
    clearConfig,
    isConfigured,
    getClient,
    testConnection
  };
})(window);
