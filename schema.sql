-- ============================================================
-- Clinical Pharmacy Ward Management — Supabase Schema
-- ============================================================
-- Run this in your Supabase project's SQL Editor
-- (Dashboard → SQL → New query → paste → Run).
--
-- After running, copy your project URL and anon public key
-- (Dashboard → Settings → API) and enter them in the app's
-- admin panel → Supabase settings.
-- ============================================================

-- ---------- Catalog of medications ----------
-- This is the source of truth for the med list shared across devices.
-- The app's local catalog (localStorage) syncs to/from this table.
CREATE TABLE IF NOT EXISTS medications (
  id                 TEXT PRIMARY KEY,
  name_trade         TEXT,                     -- trade / brand name (primary display)
  name_ar            TEXT,                      -- Arabic generic name (fallback)
  name_en            TEXT,                      -- Scientific / INN Latin name (secondary display)
  form               TEXT NOT NULL DEFAULT 'vial',  -- 'tablet' | 'vial'
  default_dose       TEXT NOT NULL,
  default_frequency  TEXT NOT NULL,
  sort_order         INT  NOT NULL DEFAULT 0,   -- display order (lower = first)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast ordered reads (the app always sorts by sort_order).
CREATE INDEX IF NOT EXISTS medications_sort_order_idx
  ON medications (sort_order ASC);

-- ---------- Patient records ----------
-- One row per bed. bed_key is the composite 'room-N-bed-M' used by the app.
CREATE TABLE IF NOT EXISTS patients (
  bed_key        TEXT PRIMARY KEY,             -- e.g. 'room-1-bed-3'
  room_id        INT  NOT NULL,
  bed_number     INT  NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  plate_number   TEXT NOT NULL DEFAULT '',       -- optional free-text "رقم الطبلة" the pharmacist fills in
  age            TEXT NOT NULL DEFAULT '',       -- optional patient age (years) — free-text digits only, max 3
  gender         TEXT NOT NULL DEFAULT '',       -- optional gender: 'male' | 'female' | ''
  doctor         TEXT NOT NULL DEFAULT '',       -- optional attending physician (الطبيب المعالج)
  diagnosis      TEXT NOT NULL DEFAULT '',       -- optional admission diagnosis (التشخيص عند الدخول)
  first_med_date TEXT NOT NULL DEFAULT '',       -- ISO date string of first critical-med day (for D1/D2 tracking)
  labs           JSONB NOT NULL DEFAULT '{}',    -- object: { creatinine: "1.2", albumin: "3.5", ... }
  lab_history    JSONB NOT NULL DEFAULT '[]',    -- array of {date, key, label, value}
  medications    JSONB NOT NULL DEFAULT '[]',   -- array of {id,nameTrade,nameAr,nameEn,form,dose,frequency}
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For existing installations that already created the patients table
-- without some of these columns, add them (idempotent — wrapped in a
-- DO block so re-running this script doesn't error out).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'plate_number'
  ) THEN
    ALTER TABLE patients ADD COLUMN plate_number TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'age'
  ) THEN
    ALTER TABLE patients ADD COLUMN age TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'gender'
  ) THEN
    ALTER TABLE patients ADD COLUMN gender TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'doctor'
  ) THEN
    ALTER TABLE patients ADD COLUMN doctor TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'diagnosis'
  ) THEN
    ALTER TABLE patients ADD COLUMN diagnosis TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'first_med_date'
  ) THEN
    ALTER TABLE patients ADD COLUMN first_med_date TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'labs'
  ) THEN
    ALTER TABLE patients ADD COLUMN labs JSONB NOT NULL DEFAULT '{}';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'lab_history'
  ) THEN
    ALTER TABLE patients ADD COLUMN lab_history JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS patients_room_bed_idx
  ON patients (room_id, bed_number);

-- ---------- Row Level Security (RLS) ----------
-- The app uses the anon key only (no auth in v1). We allow anonymous
-- full access to both tables. Tighten this once you add authentication.
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_medications"
  ON medications FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon_write_medications"
  ON medications FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon_read_patients"
  ON patients FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon_write_patients"
  ON patients FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- ---------- Optional: seed with the default demo catalog ----------
-- Uncomment and run if you want to start with the in-app default meds.
/*
INSERT INTO medications (id, name_trade, name_ar, name_en, form, default_dose, default_frequency, sort_order)
VALUES
  ('paracetamol',    'تايفينول / بانادول', 'باراسيتامول',          'Paracetamol',              'tablet', '1 g',       '1×3', 0),
  ('pantoprazole',   'كونترولوك',           'بانتوبرازول',          'Pantoprazole',             'vial',   '40 mg',     '1×1', 1),
  ('ceftriaxone',    'سيفترياكسون فايزر',   'سيفترياكسون',          'Ceftriaxone',              'vial',   '1 g',       '1×2', 2),
  ('enoxaparin',     'كليكسان',             'إينوكسابارين',          'Enoxaparin',               'vial',   '40 mg',     '1×1', 3),
  ('metoclopramide', 'بريمبران',            'ميتوكلوبراميد',        'Metoclopramide',           'vial',   '10 mg',     '1×3', 4),
  ('ondansetron',    'زوفران',              'أوندانسيترون',          'Ondansetron',              'vial',   '4 mg',      '1×3', 5),
  ('furosemide',     'لازكس',               'فيوروسيميد',            'Furosemide',               'vial',   '20 mg',     '1×1', 6),
  ('amoxclav',       'أوغمنتين',            'أموكسيسيلين/كلافيولانات', 'Amoxicillin/Clavulanate', 'tablet', '1.2 g',     '1×3', 7),
  ('insulin',        'إنسولين بشري',        'إنسولين',               'Insulin',                  'vial',   'حسب الخطة',    'حسب القياس', 8),
  ('salbutamol',     'فنتولين',             'سالبوتامول',            'Salbutamol',               'vial',   '2.5 mg',    '1×4', 9),
  ('vancomycin',     'فانكوساين',           'فانكومايسين',           'Vancomycin',               'vial',   'حسب البروتوكول', 'حسب البروتوكول', 10),
  ('meropenem',      'ميرونيم',             'ميروبينيم',             'Meropenem',                'vial',   '1 g',       '1×3', 11)
ON CONFLICT (id) DO NOTHING;
*/

-- ============================================================
-- User Management + Audit Log
-- ============================================================
-- Run scripts/users-and-audit-schema.sql for the latest version
-- of this section (it includes the default admin account seed
-- and the LEGACY sentinel handling for the existing admin
-- password '19559').
--
-- Tables:
--   users        — pharmacist/admin accounts (PBKDF2 hashed passwords)
--   audit_log    — sensitive action log (read by admin only)
-- ============================================================
