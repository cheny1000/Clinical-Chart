/* ============================================================
   supabase-client.js
   Reads Supabase configuration with the following precedence:
     1. Local override (saved from admin panel): pharma.supabase.v1
     2. Embedded default (from supabase-config.js)

   This means every device that opens the app is automatically
   connected to the hospital's shared Supabase project — no manual
   setup needed. A device can still override locally for testing.
   ============================================================ */

(function (global) {
  "use strict";

  const STORAGE_KEY = "pharma.supabase.v1";

  function loadConfig() {
    // 1) Try local override (admin-panel-saved config)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg && cfg.url && cfg.anonKey) return cfg;
      }
    } catch (e) {
      console.warn("[Supabase] loadConfig: local parse failed:", e);
    }
    // 2) Fall back to embedded default (supabase-config.js)
    if (global.PharmacySupabaseConfig && global.PharmacySupabaseConfig.EMBEDDED_CONFIG) {
      return global.PharmacySupabaseConfig.EMBEDDED_CONFIG;
    }
    return null;
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

  // True when the active config is the embedded default (not a local override)
  function isUsingEmbedded() {
    if (global.PharmacySupabaseConfig && global.PharmacySupabaseConfig.EMBEDDED_CONFIG) {
      const cfg = loadConfig();
      const emb = global.PharmacySupabaseConfig.EMBEDDED_CONFIG;
      return cfg && cfg.url === emb.url && cfg.anonKey === emb.anonKey;
    }
    return false;
  }

  // Build the Supabase client from the global `supabase` UMD object
  // (loaded from the CDN in index.html).
  // We cache the client (singleton) so that Realtime subscriptions
  // and REST queries use the SAME client instance. Without this,
  // each getClient() call creates a new client, and the Realtime
  // channel on one client won't receive events from operations
  // done on another client.
  let _cachedClient = null;
  function getClient() {
    const cfg = loadConfig();
    if (!cfg) return null;
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      console.warn("[Supabase] supabase-js not loaded (check CDN)");
      return null;
    }
    // Return the cached client if the config hasn't changed
    if (_cachedClient) return _cachedClient;
    _cachedClient = global.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } }
    });
    return _cachedClient;
  }
  // Force-create a new client (used when the config changes via admin panel)
  function resetClient() {
    _cachedClient = null;
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
    isUsingEmbedded,
    getClient,
    resetClient,
    testConnection
  };
})(window);
