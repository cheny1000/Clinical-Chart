/* ============================================================
   supabase-sync.js
   Bridges the localStorage catalog ↔ Supabase `medications` table.

   Strategy: localStorage stays the source of truth for instant UI
   rendering (no async waits). Supabase is the cloud replica.

   - pullCatalog()   : fetch all rows from Supabase and overwrite
                       localStorage (called on boot if configured)
   - pushCatalog()   : upsert the current localStorage catalog into
                       Supabase (called after every save)

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
  async function pullCatalog() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
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
  // Strategy: delete-all + insert-all (simple, robust, idempotent).
  // Returns { ok: true } on success or { ok: false, error }.
  async function pushCatalog() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    const meds = Local.loadMedications();
    if (!Array.isArray(meds)) return { ok: false, error: "كتالوج محلي غير صالح" };

    try {
      // 1) Wipe the remote table
      const { error: delErr } = await client
        .from("medications")
        .delete()
        .gte("sort_order", 0);
      if (delErr) return { ok: false, error: delErr.message };

      // 2) Insert the local catalog with sort_order = array index
      const rows = meds.map((m, i) => medToRow(m, i));
      // Insert in chunks of 100 to avoid payload limits
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: insErr } = await client
          .from("medications")
          .insert(slice);
        if (insErr) return { ok: false, error: insErr.message };
      }
      return { ok: true, count: meds.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  global.PharmacySupabaseSync = {
    pullCatalog,
    pushCatalog,
    medToRow,
    rowToMed
  };
})(window);
