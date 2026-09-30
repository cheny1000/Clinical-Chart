/* ============================================================
   storage.js
   Local storage abstraction layer.

   The public API exposed on window.PharmacyStorage is the
   contract any future backend (Supabase / PostgreSQL / hospital
   DB / REST API) needs to implement. Replacing this file with a
   remote-backed adapter should not require touching ui.js / app.js.
   ============================================================ */

(function (global) {
  "use strict";

  const STORAGE_KEYS = {
    PATIENTS:    "pharma.patients.v1",     // map: bedKey -> patient
    MEDICATIONS: "pharma.medications.v1",  // array: default med catalog
    MEDICATIONS_LAST_MODIFIED: "pharma.medications.modified.v1", // ms timestamp
    MEDICATIONS_LAST_SYNCED: "pharma.medications.synced.v1"      // ms timestamp
  };

  function safeParse(raw, fallback) {
    if (raw == null || raw === "") return fallback;
    try { return JSON.parse(raw); }
    catch (e) { console.warn("[PharmacyStorage] parse failed:", e); return fallback; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("[PharmacyStorage] set failed:", e); return false; }
  }

  // ----- Migration: ensure every medication has nameTrade + form -----
  // Older versions stored only nameAr + nameEn. We now use nameTrade
  // (trade/brand name) as the primary display name. If a stored
  // medication lacks nameTrade, we copy it from nameAr (or nameEn).
  // We also back-fill the `form` field (one of: vial, ampule,
  // prefilled-syringe, tablet, supplies) — defaulting to "vial"
  // since most hospital ward medications are injectables.
  // We do the same for patient.medications entries so existing
  // patient data keeps working after the upgrade.
  const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "syrup", "suppository", "solution", "supplies"];
  function migrateMed(med) {
    if (!med || typeof med !== "object") return med;
    if (!("nameTrade" in med) || !med.nameTrade) {
      med.nameTrade = med.nameAr || med.nameEn || "";
    }
    if (!("form" in med) || !med.form || VALID_FORMS.indexOf(med.form) === -1) {
      med.form = "vial";
    }
    return med;
  }
  function migrateMedsList(list) {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const out = list.map(m => {
      if (!m || typeof m !== "object") return m;
      const needsTrade = !("nameTrade" in m) || !m.nameTrade;
      const needsForm  = !("form" in m) || !m.form;
      if (needsTrade || needsForm) {
        changed = true;
        return migrateMed({ ...m });
      }
      return m;
    });
    return { list: out, changed };
  }

  // ----- Patients -----
  // Each patient may carry an `updatedAt` (ms timestamp) used by the
  // Supabase sync layer to do last-write-wins merging. If missing
  // (legacy data), we treat it as 0 so a cloud row with a real
  // updated_at always wins the first merge.
  function loadPatients() {
    const all = safeParse(localStorage.getItem(STORAGE_KEYS.PATIENTS), {});
    // Migrate patient.medications entries: back-fill nameTrade
    let changed = false;
    for (const bedKey of Object.keys(all)) {
      const p = all[bedKey];
      if (!p || !Array.isArray(p.medications)) continue;
      const res = migrateMedsList(p.medications);
      if (res.changed) {
        p.medications = res.list;
        changed = true;
      }
    }
    if (changed) savePatients(all);
    return all;
  }
  function savePatients(map) {
    return safeSet(STORAGE_KEYS.PATIENTS, map);
  }
  function getPatient(bedKey) {
    const all = loadPatients();
    return all[bedKey] || null;
  }
  function upsertPatient(bedKey, patient) {
    const all = loadPatients();
    // Stamp the patient with the current time so the sync layer
    // can resolve conflicts with last-write-wins.
    if (patient && typeof patient === "object") {
      patient.updatedAt = Date.now();
    }
    all[bedKey] = patient;
    return savePatients(all);
  }
  function deletePatient(bedKey) {
    const all = loadPatients();
    delete all[bedKey];
    return savePatients(all);
  }
  function allPatientsArray() {
    const all = loadPatients();
    return Object.entries(all).map(([key, p]) => ({ ...p, _key: key }));
  }

  // Merge a remote (cloud) patients map with the local map.
  // For each bed_key:
  //   - only in local → keep local
  //   - only in remote → keep remote
  //   - in both → keep the one with the newer `updatedAt`
  // `updatedAt` may be a JS number (ms) or an ISO 8601 string
  // (from Supabase's TIMESTAMPTZ). We normalize both to ms.
  function _toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }
  function mergePatients(localMap, remoteMap) {
    const local = localMap || {};
    const remote = remoteMap || {};
    const keys = new Set(Object.keys(local).concat(Object.keys(remote)));
    const out = {};
    for (const k of keys) {
      const lp = local[k];
      const rp = remote[k];
      if (lp && !rp) { out[k] = lp; continue; }
      if (rp && !lp) { out[k] = rp; continue; }
      const lt = _toMs(lp.updatedAt);
      const rt = _toMs(rp.updatedAt);
      // Last-write-wins. Tie → keep local (don't surprise the user
      // by overwriting what they just edited on this device).
      out[k] = rt > lt ? rp : lp;
    }
    return out;
  }

  // ----- Medications catalog -----
  // First-run detection: we only seed the default catalog if the user
  // has NEVER saved anything (key doesn't exist). Once the user has
  // saved (even an empty array), we respect their choice — deleting
  // all meds should NOT silently restore defaults on next boot.
  //
  // HOWEVER: there are a few "required supplies" that the app's
  // auto-add rules depend on (e.g. '5cc Syringe' is auto-added with
  // every vial/ampule). If a returning user has a saved catalog that
  // predates the auto-add rule, we inject the required supplies on
  // the next load. This is a one-time migration — once injected,
  // they show up like any other catalog item and the user can edit
  // or delete them (though deleting them will break the auto-add
  // rule for new vials/ampules added afterwards).
  const REQUIRED_SUPPLIES = [
    {
      id: "syringe-5cc",
      nameTrade: "5cc Syringe",
      nameAr:    "سرنجة 5 سي سي",
      nameEn:    "5cc Syringe",
      form:      "supplies",
      defaultDose:      "1 سرنجة",
      defaultFrequency: "حسب الحاجة"
    }
  ];
  function injectRequiredSupplies(list) {
    if (!Array.isArray(list)) return list;
    const existingIds = new Set(list.map(m => m && m.id).filter(Boolean));
    let changed = false;
    for (const req of REQUIRED_SUPPLIES) {
      if (!existingIds.has(req.id)) {
        list.push(Object.assign({}, req));
        changed = true;
      }
    }
    return { list, changed };
  }

  function loadMedications() {
    const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS);
    if (raw === null) {
      // First run: seed defaults (already includes all required supplies)
      const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
      safeSet(STORAGE_KEYS.MEDICATIONS, def);
      return def;
    }
    // The user has a stored catalog (even if empty) — respect it.
    const stored = safeParse(raw, []);
    if (Array.isArray(stored)) {
      // Migrate: ensure nameTrade + form are present on every catalog entry
      let res = migrateMedsList(stored);
      // Inject any required supplies that are missing (e.g. user's
      // saved catalog predates the introduction of 'syringe-5cc').
      const inj = injectRequiredSupplies(res.list);
      if (inj.changed) {
        res.list = inj.list;
        res.changed = true;
      }
      if (res.changed) safeSet(STORAGE_KEYS.MEDICATIONS, res.list);
      return res.list;
    }
    // Fallback if parse failed entirely
    return [];
  }
  function saveMedications(list) {
    // Mark the local catalog as modified — pullCatalog uses this to
    // decide whether the local version is newer than the cloud version.
    try {
      localStorage.setItem(STORAGE_KEYS.MEDICATIONS_LAST_MODIFIED, String(Date.now()));
    } catch (e) { /* ignore */ }
    return safeSet(STORAGE_KEYS.MEDICATIONS, list);
  }
  function resetMedicationsToDefault() {
    const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
    return saveMedications(def);
  }
  function getLocalCatalogModifiedAt() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS_LAST_MODIFIED);
      return raw ? parseInt(raw, 10) : 0;
    } catch (e) { return 0; }
  }
  function getLocalCatalogSyncedAt() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS_LAST_SYNCED);
      return raw ? parseInt(raw, 10) : 0;
    } catch (e) { return 0; }
  }
  function setLocalCatalogSyncedAt(ms) {
    try {
      localStorage.setItem(STORAGE_KEYS.MEDICATIONS_LAST_SYNCED, String(ms));
    } catch (e) { /* ignore */ }
  }
  // True if the local catalog has unsynced edits (modified after last sync)
  function hasUnsyncedLocalEdits() {
    const m = getLocalCatalogModifiedAt();
    const s = getLocalCatalogSyncedAt();
    return m > s;
  }

  // ----- Bulk (used for initial hydration) -----
  function loadAll() {
    return {
      patients:    loadPatients(),
      medications: loadMedications()
    };
  }

  global.PharmacyStorage = {
    // patients
    loadPatients,
    savePatients,
    getPatient,
    upsertPatient,
    deletePatient,
    allPatientsArray,
    mergePatients,
    // medications catalog
    loadMedications,
    saveMedications,
    resetMedicationsToDefault,
    getLocalCatalogModifiedAt,
    getLocalCatalogSyncedAt,
    setLocalCatalogSyncedAt,
    hasUnsyncedLocalEdits,
    // auto-add rule support
    REQUIRED_SUPPLIES,
    // bulk
    loadAll
  };
})(window);
