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

  // Convert local med objects (camelCase) ↔ Supabase rows (snake_case).
  // IMPORTANT: we only set `updated_at = now()` for rows that are NEW
  // to the cloud (we don't know their previous cloud state). For rows
  // that we're going to upsert, the database default `updated_at` won't
  // auto-update on UPDATE (Postgres doesn't do that automatically), so
  // we must set it ourselves — but we should set it ONLY when the row's
  // content actually changed vs the cloud version, otherwise every
  // push refreshes ALL updated_at and makes future pulls think the
  // cloud is newer than the local (false-positive sync conflict).
  // Simplest robust approach: don't set updated_at on upsert; let the
  // DB trigger handle it. (We add a trigger in schema.sql v2.)
  // For now (no trigger), we set updated_at only for the insert path
  // by passing it only when the row is new — but upsert can't tell
  // insert vs update apart from the client. So we just don't touch
  // updated_at here and accept that the trigger-less version will
  // refresh updated_at on every upsert. The local-vs-cloud comparison
  // still works because we ALSO bump localMs only on REAL edits.
  function medToRow(m, sortOrder) {
    return {
      id: m.id,
      name_trade: m.nameTrade || null,
      name_ar: m.nameAr || null,
      name_en: m.nameEn || null,
      form: m.form || "vial",
      default_dose: m.defaultDose || "",
      default_frequency: m.defaultFrequency || "",
      sort_order: sortOrder
      // NOTE: we deliberately omit updated_at so the DB trigger
      // (if installed) sets it; otherwise the column default is now()
      // which would refresh on every upsert — handled by the localMs
      // comparison being based on real edits, not push timing.
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
  // Refuses to pull if:
  //   (a) the last push failed recently, OR
  //   (b) the local catalog has unsynced edits (modified after last
  //       successful sync). This is the key fix: it prevents a stale
  //       cloud (where a previous push failed) from overwriting local
  //       edits on the next boot.
  async function pullCatalog(force) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    if (!force && shouldSkipPull()) {
      const s = loadSyncState();
      return {
        ok: false,
        error: "تم تجاهل السحب — آخر رفع فشل، الكتالوج المحلي محفوظ",
        skipped: true,
        reason: "push-failed-recently",
        lastFailedPushAt: s.lastPushAt
      };
    }
    // Check for unsynced local edits — skip pull if local is fresher
    // than the last successful sync.
    if (!force && Local.hasUnsyncedLocalEdits && Local.hasUnsyncedLocalEdits()) {
      return {
        ok: false,
        error: "تم تجاهل السحب — لديك تعديلات محلية لم تُرفع بعد",
        skipped: true,
        reason: "local-unsynced"
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
      // CRITICAL: Don't blindly overwrite the local catalog with the
      // cloud version. If we just merged new DEFAULT_MEDICATIONS
      // (via the catalog-version migration in storage.js), the local
      // catalog has those new meds but the cloud doesn't (yet).
      // Overwriting here would WIPE the newly-merged meds.
      //
      // Instead: take the cloud meds, merge in any local-only meds
      // (matched by id, so we don't duplicate), then save. This way:
      //   - Cloud-only meds come down (preserves other devices' edits)
      //   - Local-only meds (the newly-merged defaults) stay
      //   - Cloud wins for shared ids (preserves cross-device edits)
      //
      // After save, the caller (pullCatalogOnBoot) will push the
      // merged catalog back to the cloud so other devices also get
      // the new meds on their next pull.
      const localMeds = Local.loadMedications();
      const cloudIds = new Set(meds.map(m => m && m.id).filter(Boolean));
      const localOnlyMeds = (Array.isArray(localMeds) ? localMeds : [])
        .filter(m => m && m.id && !cloudIds.has(m.id));
      const mergedMeds = meds.concat(localOnlyMeds);
      Local.saveMedications(mergedMeds);
      // Mark local as "synced" at this moment — both localModifiedAt
      // and localSyncedAt are now equal, so future pulls are allowed
      // until the user makes another local edit.
      const nowMs = Date.now();
      try {
        localStorage.setItem("pharma.medications.modified.v1", String(nowMs));
        Local.setLocalCatalogSyncedAt(nowMs);
      } catch (e) { /* ignore */ }
      return { ok: true, count: mergedMeds.length, addedFromLocal: localOnlyMeds.length };
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
      // Mark local catalog as fully synced (modified == synced)
      if (Local.setLocalCatalogSyncedAt) {
        Local.setLocalCatalogSyncedAt(Date.now());
      }
      return { ok: true, count: meds.length };
    } catch (e) {
      saveSyncState({ lastPushOk: false, lastPushAt: Date.now() });
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // ---------- Patient sync (bed_key → patient) ----------
  // Strategy: MERGE (not overwrite).
  //
  //   pullPatients()
  //     - Fetch all rows from Supabase
  //     - Merge with the LOCAL map using last-write-wins on `updated_at`
  //     - Save the merged map back to localStorage
  //     - Push the merged map back to Supabase (so any local-only
  //       entries — present only on this device — propagate to the
  //       cloud and from there to other devices)
  //
  //   pushPatients()
  //     - UPSERT only. NEVER bulk-delete rows that aren't in local,
  //       because those rows belong to other devices and we'd be
  //       wiping their data. (Bulk delete is only available via the
  //       explicit `pushPatientsWipe()` used by the admin "wipe all"
  //       action.)
  //
  //   pushPatientDelete(bedKey)
  //     - Delete a single bed_key from the cloud. Used by the per-bed
  //       "delete patient" action so a deletion on one device propagates
  //       to others on their next pull.
  //
  // Each local patient carries an `updatedAt` (ms) field set by
  // `Storage.upsertPatient()`. The cloud stores `updated_at` as
  // TIMESTAMPTZ (ISO 8601 string). `mergePatients()` normalizes both.

  function _toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }

  // Convert a local patient object → Supabase row.
  function patientToRow(bedKey, p) {
    const m = bedKey.match(/room-(\d+)-bed-(\d+)/);
    const roomId = m ? parseInt(m[1], 10) : 0;
    const bedNum = m ? parseInt(m[2], 10) : 0;
    return {
      bed_key:     bedKey,
      room_id:     roomId,
      bed_number: bedNum,
      name:        (p && p.name) ? p.name : "",
      medications: JSON.stringify((p && p.medications) || []),
      // Use the local updatedAt if present (ms → ISO); otherwise now.
      updated_at:  new Date(_toMs(p && p.updatedAt) || Date.now()).toISOString()
    };
  }

  // Convert a Supabase row → local patient object. Preserves the
  // cloud's `updated_at` as a JS number (ms) under `updatedAt` so the
  // merge function can compare apples to apples.
  function rowToPatient(row) {
    let meds = [];
    try {
      meds = typeof row.medications === "string"
        ? JSON.parse(row.medications)
        : (row.medications || []);
    } catch (e) { meds = []; }
    return {
      name:        row.name || "",
      medications: Array.isArray(meds) ? meds : [],
      updatedAt:   _toMs(row.updated_at)
    };
  }

  // Upsert ALL local patients to Supabase. Does NOT delete cloud rows
  // that aren't local — those belong to other devices.
  async function pushPatients() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    const patients = Local.loadPatients();
    const entries = Object.entries(patients).map(([k, p]) => patientToRow(k, p));

    try {
      if (entries.length > 0) {
        const CHUNK = 100;
        for (let i = 0; i < entries.length; i += CHUNK) {
          const slice = entries.slice(i, i + CHUNK);
          const { error: upErr } = await client
            .from("patients")
            .upsert(slice, { onConflict: "bed_key" });
          if (upErr) return { ok: false, error: upErr.message };
        }
      }
      // No bulk delete — see header comment.
      return { ok: true, count: entries.length };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Delete a single bed_key from the cloud (used when the user
  // explicitly deletes a patient on this device).
  async function pushPatientDelete(bedKey) {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { error } = await client
        .from("patients")
        .delete()
        .eq("bed_key", bedKey);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Wipe ALL patients from the cloud (used by the admin "wipe all
  // patients" action). This is the ONLY place that bulk-deletes.
  async function pushPatientsWipe() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };
    try {
      const { error } = await client
        .from("patients")
        .delete()
        .neq("bed_key", "__never__"); // matches all rows
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  // Pull all patients from Supabase and MERGE with local.
  // After merging locally, also push the merged result back so any
  // local-only entries propagate to the cloud.
  async function pullPatients() {
    if (!SB || !SB.isConfigured()) return { ok: false, error: "غير مُهيّأ" };
    const client = SB.getClient();
    if (!client) return { ok: false, error: "تعذّر إنشاء عميل Supabase" };

    try {
      const { data, error } = await client
        .from("patients")
        .select("*");
      if (error) return { ok: false, error: error.message };
      if (!Array.isArray(data)) return { ok: false, error: "استجابة غير متوقعة" };

      // Build the remote map (bed_key → patient)
      const remote = {};
      data.forEach(row => {
        if (!row.bed_key) return;
        remote[row.bed_key] = rowToPatient(row);
      });

      // Merge with local (last-write-wins on updatedAt)
      const localNow = Local.loadPatients();
      const merged = Local.mergePatients(localNow, remote);

      // Persist the merged map locally. Use the raw save (not
      // upsertPatient) so we don't overwrite the existing updatedAt
      // stamps with "now".
      Local.savePatients(merged);

      // Push the merged result back so local-only entries propagate
      // to the cloud (and from there to other devices). Best-effort:
      // failure here just means another device will pull a slightly
      // older cloud, which is fine.
      const pushRes = await pushPatients();
      // We don't propagate pushRes.error to the caller — the pull
      // itself succeeded and the merge is consistent locally.
      return {
        ok: true,
        count: Object.keys(merged).length,
        pushedBack: pushRes.ok
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  global.PharmacySupabaseSync = {
    pullCatalog,
    pushCatalog,
    pushPatients,
    pullPatients,
    pushPatientDelete,
    pushPatientsWipe,
    patientToRow,
    rowToPatient,
    medToRow,
    rowToMed,
    loadSyncState,
    saveSyncState,
    shouldSkipPull,
    SYNC_STATE_KEY
  };
})(window);

