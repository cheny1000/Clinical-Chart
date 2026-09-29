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
  const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "supplies"];
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

  // ----- Medications catalog -----
  // First-run detection: we only seed the default catalog if the user
  // has NEVER saved anything (key doesn't exist). Once the user has
  // saved (even an empty array), we respect their choice — deleting
  // all meds should NOT silently restore defaults on next boot.
  function loadMedications() {
    const raw = localStorage.getItem(STORAGE_KEYS.MEDICATIONS);
    if (raw === null) {
      // First run: seed defaults
      const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
      safeSet(STORAGE_KEYS.MEDICATIONS, def);
      return def;
    }
    // The user has a stored catalog (even if empty) — respect it.
    const stored = safeParse(raw, []);
    if (Array.isArray(stored)) {
      // Migrate: ensure nameTrade + form are present on every catalog entry
      const res = migrateMedsList(stored);
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
    // medications catalog
    loadMedications,
    saveMedications,
    resetMedicationsToDefault,
    getLocalCatalogModifiedAt,
    getLocalCatalogSyncedAt,
    setLocalCatalogSyncedAt,
    hasUnsyncedLocalEdits,
    // bulk
    loadAll
  };
})(window);
