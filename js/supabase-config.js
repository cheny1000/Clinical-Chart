/* ============================================================
   supabase-config.js  —  PRE-CONFIGURED for this hospital deployment
   ============================================================

   This file embeds the Supabase project URL and anon public key so
   that every device that opens the app is automatically connected
   to the same shared cloud catalog — no manual setup needed.

   SECURITY NOTE
   -------------
   The anon public key is designed to be exposed in client-side code.
   Supabase Row-Level-Security (RLS) is the real security boundary,
   not the key. As long as your RLS policies are correct, exposing the
   anon key is safe.

   Current RLS (see schema.sql):
   - medications: anon can read + write (catalog is shared, low risk)
   - patients: anon can read + write (will be tightened later with auth)

   To override this config on a specific device (e.g. for testing
   against a different Supabase project), open the admin panel and
   save a different URL/key there. That local config takes precedence
   over this embedded one.
   ============================================================ */

(function (global) {
  "use strict";

  const EMBEDDED_CONFIG = {
    url:     "https://nutwkuqxvnxpbnbtavjn.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51dHdrdXF4dm54cGJuYnRhdmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MjI1NTUsImV4cCI6MjEwNjE5ODU1NX0.j408GU1xNhevZDcchWPGfTo0qI5JOK280hJ984yvLbA"
  };

  global.PharmacySupabaseConfig = {
    EMBEDDED_CONFIG
  };
})(window);
