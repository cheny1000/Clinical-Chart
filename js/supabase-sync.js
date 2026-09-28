/* ============================================================
   supabase-sync.js
   Bridges the localStorage catalog ↔ Supabase `medications` table.

   Strategy: localStorage stays the source of truth for instant UI
   rendering (no async waits). Supabase is the cloud replica.

   - pullCatalog()   : fetch all rows from Supabase and merge with local
                       (local wins for items newer than the cloud —
                        to prevent a stale pull from overwriting local
                        edits that haven't been pushed yet)
   - pushCatalog()   : upsert the current localStorage catalog into
                       Supabase (safer than delete+insert: if push fails
                        mid-way, the cloud stays consistent)

   The `medications` table schema (see schema.sql):
     id              TEXT PRIMARY KEY
     name_trade      TEXT
     name_ar         TEXT
     name_en         TEXT
     form            TEXT NOT NULL DEFAULT 'vial'
     default_dose    TEXT NOT NULL
     default_frequency TEXT NOT NULL
     sort_order      INT  NOT NULL DEFAULT 0
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
   ============================================================ */

(function (global) {
  "use strict";

  const SB = global.PharmacySupabase;
  const Local = global.PharmacyStorage;

  // Sync state tracking — prevents a stale pull from overwriting local edits
  const SYNC_STATE_KEY = "pharma.supabase.syncstate.v1";
  // We consider a recent failed push as "don't pull" for this long (ms):
  const PULL_BLOCK_AFTER_FAILED_PUSH_MS = 30 * 60 * 1000; // 30 minutes

  function loadSyncState() {
    try {
      const raw = localStorage.getItem(SYNC_STATE_KEY);
      if (!raw) return { lastPushOk: null, lastPushAt: 0 };
      const s = JSON.parse(raw);
      return {
        lastPushOk: typeof s.lastPushOk === "boolean" ? s.lastPushOk : null,
        lastPushAt: typeof s.lastPushAt === "number" ? s.lastPushAt : 0
      };
    } catch (e) {
      return { lastPushOk: null, lastPushAt: 0 };
    }
  }

  function saveSyncState(patch) {
    try {
      const cur = loadSyncState();
      const next = Object.assign({}, cur, patch);
      localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(next));
    } catch (e) { /* ignore */ }
  }

  // Should we skip the next pull? True if the last push failed recently.
  function shouldSkipPull() {
    const s = loadSyncState();
    if (s.lastPushOk === false) {
      const age = Date.now() - (s.lastPushAt || 0);
      if (age < PULL_BLOCK_AFTER_FAILED_PUSH_MS) return true;
    }
    return false;
  }

  // Convert local med objects (camelCase) ↔ Supabase rows (snake_case)
  function medToRow(m, sortOrder) {
    return {
      id: m.id,
      name_trade: m.nameTrade || null,
      name_ar: m.nameAr || null,
      name_en: m.nameEn || null,
      form: m.form || "vial",
      default_dose: m.defaultDose || "",
      default_frequency: m.defaultFrequency || "",
      sort_order: sortOrder,
      updated_at: new Date().toISOString()
    };
  }
  function rowToMed(row) {
    return {
      id: row.id,
      nameTrade: row.name_trade || "",
      nameAr: row.name_ar || "",
      nameEn: row.name_en || "",
      form: row.form || "vial",
      defaultDose: row.default_dose || "",
      defaultFrequency: row.default_frequency || ""
    };
  }

  // Pull the catalog from Supabase → write into localStorage.
  // Returns { ok: true, count: N } on success or { ok: false, error }.
  // Refuses to pull if the last push failed recently (so local edits
  // that haven't reached the cloud aren't blown away).
  async function pullCatalog(force) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    if (!force && shouldSkipPull()) {
      const s = loadSyncState();
      return {
        ok: false,
        error: "تم تجاهل السحب — آخر رفع فشل، الكتالوج المحلي محفوظ",
        skipped: true,
        lastFailedPushAt: s.lastPushAt
      };
    }
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    try {
      const { data, error } = await client
        .from("medications")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) return { ok: false, error: error.message };
      if (!Array.isArray(data)) return { ok: false, error: "استجابة غير متوقعة" };

      const meds = data.map(rowToMed);
      // Overwrite the local catalog with the cloud version
      Local.saveMedications(meds);
      return { ok: true, count: meds.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Push the current localStorage catalog → Supabase.
  // Uses upsert (insert with ON CONFLICT DO UPDATE) so partial failures
  // don't leave the cloud table empty. Also deletes any rows that exist
  // in the cloud but not locally (so removals propagate).
  // Returns { ok: true } on success or { ok: false, error }.
  async function pushCatalog() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    const meds = Local.loadMedications();
    if (!Array.isArray(meds)) return { ok: false, error: "كتالوج محلي غير صالح" };

    try {
      // 1) Upsert all rows (insert OR update on conflict by id)
      const rows = meds.map((m, i) => medToRow(m, i));
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: upErr } = await client
          .from("medications")
          .upsert(slice, { onConflict: "id" });
        if (upErr) {
          saveSyncState({ lastPushOk: false, lastPushAt: Date.now() });
          return { ok: false, error: upErr.message };
        }
      }

      // 2) Delete rows that exist in the cloud but not in the local catalog
      //    (so removals propagate). We build a list of local IDs and ask
      //    Supabase to delete anything not in that list.
      const localIds = meds.map(m => m.id);
      // Supabase PostgREST filter: .not("id", "in", '("a","b","c")')
      if (localIds.length > 0) {
        const inList = "(" + localIds.map(id => JSON.stringify(id)).join(",") + ")";
        const { error: delErr } = await client
          .from("medications")
          .delete()
          .not("id", "in", inList);
        if (delErr) {
          // Deletion failure is less critical — the catalog is still
          // consistent (just may have stale rows). Log but report OK.
          console.warn("[Supabase] cleanup delete failed:", delErr.message);
        }
      } else {
        // No local meds → wipe cloud (rare case)
        const { error: delErr } = await client
          .from("medications")
          .delete()
          .neq("id", "__never__");
        if (delErr) console.warn("[Supabase] wipe failed:", delErr.message);
      }

      saveSyncState({ lastPushOk: true, lastPushAt: Date.now() });
      return { ok: true, count: meds.length };
    } catch (e) {
      saveSyncState({ lastPushOk: false, lastPushAt: Date.now() });
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  global.PharmacySupabaseSync = {
    pullCatalog,
    pushCatalog,
    medToRow,
    rowToMed,
    loadSyncState,
    saveSyncState,
    shouldSkipPull,
    SYNC_STATE_KEY
  };
})(window);

