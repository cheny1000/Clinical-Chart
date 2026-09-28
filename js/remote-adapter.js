/* ============================================================
   remote-adapter.js  —  MIGRATION TEMPLATE (NOT WIRED BY DEFAULT)
   ============================================================

   This file is a TEMPLATE for a future backend-backed implementation
   of the same storage contract currently provided by `storage.js`.

   WHY THIS FILE EXISTS
   --------------------
   The app talks to its persistence layer only through
   `window.PharmacyStorage`, which exposes a small set of async/sync
   methods (loadPatients, upsertPatient, deletePatient, loadMedications,
   saveMedications, …). Today `storage.js` implements those against
   the browser's `localStorage`.

   When you migrate to Supabase / PostgreSQL / a hospital REST API,
   you do NOT need to touch ui.js, app.js, medications.js, or ward.js.
   You only need to swap the implementation behind the same facade.

   HOW TO USE
   ----------
   1. Fill in the body of each method with your remote call
      (Supabase JS client, fetch against your REST endpoints, etc.).
   2. Convert all methods to async (and update ui.js / app.js to
      `await` them — search for usages of `PharmacyStorage.`).
   3. Replace `window.PharmacyStorage` with `RemotePharmacyStorage`
      in app.js, or conditionally choose one based on a feature flag.
   4. Optionally add an offline queue + sync layer (recommended).

   SUGGESTED SCHEMA (PostgreSQL)
   -----------------------------
   CREATE TABLE patients (
     bed_key        TEXT PRIMARY KEY,   -- 'room-1-bed-3'
     room_id        INT  NOT NULL,
     bed_number     INT  NOT NULL,
     name           TEXT NOT NULL,
     medications    JSONB NOT NULL DEFAULT '[]',  -- [{id,nameTrade,nameAr,nameEn,dose,frequency}]
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   CREATE TABLE medications_catalog (
     id              TEXT PRIMARY KEY,
     name_trade      TEXT,                -- trade / brand name (primary display name)
     name_ar         TEXT,                -- Arabic generic name (fallback)
     name_en         TEXT,                -- Scientific / INN Latin name (secondary display)
     default_dose    TEXT NOT NULL,
     default_frequency TEXT NOT NULL,
     sort_order      INT  NOT NULL DEFAULT 0,
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   SUGGESTED REST ENDPOINTS
   ------------------------
   GET    /api/patients                 → { bedKey: patient, ... }
   PUT    /api/patients/:bedKey         → upsert
   DELETE /api/patients/:bedKey
   GET    /api/medications              → [...]
   PUT    /api/medications              → replace catalog
   POST   /api/medications/:id          → add (or upsert)
   DELETE /api/medications/:id

   ============================================================ */

(function (global) {
  "use strict";

  // EXAMPLE: Supabase client (uncomment and configure if you use Supabase)
  // import { createClient } from '@supabase/supabase-js'
  // const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // EXAMPLE: REST base URL
  // const API_BASE = '/api';

  // ---- Tiny async helpers (swap with real fetch / supabase calls) ----
  async function safeJson(res) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const RemotePharmacyStorage = {

    // ----- Patients -----
    async loadPatients() {
      // REST:  return safeJson(await fetch(`${API_BASE}/patients`));
      // Local fallback for template:
      return {};
    },

    async getPatient(bedKey) {
      // REST:  return safeJson(await fetch(`${API_BASE}/patients/${encodeURIComponent(bedKey)}`));
      return null;
    },

    async upsertPatient(bedKey, patient) {
      // REST:
      //   await fetch(`${API_BASE}/patients/${encodeURIComponent(bedKey)}`, {
      //     method: 'PUT',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify(patient)
      //   });
      //   return true;
      return true;
    },

    async deletePatient(bedKey) {
      // REST:
      //   await fetch(`${API_BASE}/patients/${encodeURIComponent(bedKey)}`, { method: 'DELETE' });
      //   return true;
      return true;
    },

    async allPatientsArray() {
      const all = await this.loadPatients();
      return Object.entries(all).map(([key, p]) => ({ ...p, _key: key }));
    },

    // ----- Medications catalog -----
    async loadMedications() {
      // REST:  return safeJson(await fetch(`${API_BASE}/medications`));
      return (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
    },

    async saveMedications(list) {
      // REST:
      //   await fetch(`${API_BASE}/medications`, {
      //     method: 'PUT',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify(list)
      //   });
      //   return true;
      return true;
    },

    async resetMedicationsToDefault() {
      const def = (global.PharmacyMedications && global.PharmacyMedications.DEFAULT_MEDICATIONS) || [];
      return this.saveMedications(def);
    },

    // ----- Bulk -----
    async loadAll() {
      const [patients, medications] = await Promise.all([
        this.loadPatients(),
        this.loadMedications()
      ]);
      return { patients, medications };
    }
  };

  // Export as a TEMPLATE — not auto-wired. To activate, set:
  //   window.PharmacyStorage = RemotePharmacyStorage;
  // in your app's bootstrap, after authentication is resolved.
  global.RemotePharmacyStorage = RemotePharmacyStorage;
})(window);
