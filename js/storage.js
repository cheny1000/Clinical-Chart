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
    MEDICATIONS: "pharma.medications.v1"   // array: default med catalog
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

  // ----- Patients -----
  function loadPatients() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.PATIENTS), {});
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
  function loadMedications() {
    const stored = safeParse(localStorage.getItem(STORAGE_KEYS.MEDICATIONS), null);
    if (stored && Array.isArray(stored) && stored.length > 0) return stored;
    // fall back to defaults and persist
    const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
    safeSet(STORAGE_KEYS.MEDICATIONS, def);
    return def;
  }
  function saveMedications(list) {
    return safeSet(STORAGE_KEYS.MEDICATIONS, list);
  }
  function resetMedicationsToDefault() {
    const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
    return saveMedications(def);
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
    // bulk
    loadAll
  };
})(window);
