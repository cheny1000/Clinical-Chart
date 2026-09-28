/* ============================================================
   medications.js
   Default (DEMO) medication catalog.
   NOTE: Doses/frequencies here are PLACEHOLDERS, not clinical
   recommendations. The hospital/pharmacy administrator is
   responsible for configuring the actual defaults.
   ============================================================ */

(function (global) {
  "use strict";

  // Frequency shorthand options used across the app
  const FREQUENCIES = ["1×1", "1×2", "1×3", "1×4"];

  // Form / dosage-form categories. Each medication has a `form` value:
  //   "tablet" → الحبوب (oral tablets / capsules / oral solutions)
  //   "vial"   → الفيالات (injectable / IV / IM / SC vials, nebules)
  // The bottom-sheet selector groups medications by this field.
  // The admin panel can change a med's `form` at any time.
  const FORM_LABELS = {
    tablet: "حبوب",
    vial:   "فيالات"
  };

  // Demo medication catalog — editable by administrator
  // Each medication has THREE name fields + a `form` field:
  //   nameTrade  : Trade / brand name (shown as the PRIMARY name in the UI)
  //   nameAr     : Arabic generic name (kept for backward compat; hidden if nameTrade exists)
  //   nameEn     : Scientific / generic Latin name (shown as secondary under nameTrade)
  //   form       : "tablet" | "vial" (used to group the bottom-sheet list)
  // If nameTrade is empty, the UI falls back to nameAr.
  const DEFAULT_MEDICATIONS = [
    { id: "paracetamol",    nameTrade: "تايفينول / بانادول",   nameAr: "باراسيتامول",          nameEn: "Paracetamol",              form: "tablet", defaultDose: "1 g",       defaultFrequency: "1×3" },
    { id: "pantoprazole",   nameTrade: "كونترولوك",              nameAr: "بانتوبرازول",          nameEn: "Pantoprazole",             form: "vial",   defaultDose: "40 mg",     defaultFrequency: "1×1" },
    { id: "ceftriaxone",    nameTrade: "سيفترياكسون فايزر",      nameAr: "سيفترياكسون",          nameEn: "Ceftriaxone",              form: "vial",   defaultDose: "1 g",       defaultFrequency: "1×2" },
    { id: "enoxaparin",     nameTrade: "كليكسان",                nameAr: "إينوكسابارين",          nameEn: "Enoxaparin",               form: "vial",   defaultDose: "40 mg",     defaultFrequency: "1×1" },
    { id: "metoclopramide", nameTrade: "بريمبران",               nameAr: "ميتوكلوبراميد",        nameEn: "Metoclopramide",           form: "vial",   defaultDose: "10 mg",     defaultFrequency: "1×3" },
    { id: "ondansetron",    nameTrade: "زوفران",                 nameAr: "أوندانسيترون",          nameEn: "Ondansetron",              form: "vial",   defaultDose: "4 mg",      defaultFrequency: "1×3" },
    { id: "furosemide",     nameTrade: "لازكس",                  nameAr: "فيوروسيميد",            nameEn: "Furosemide",               form: "vial",   defaultDose: "20 mg",     defaultFrequency: "1×1" },
    { id: "amoxclav",       nameTrade: "أوغمنتين",                nameAr: "أموكسيسيلين/كلافيولانات", nameEn: "Amoxicillin/Clavulanate", form: "tablet", defaultDose: "1.2 g",     defaultFrequency: "1×3" },
    { id: "insulin",        nameTrade: "إنسولين بشري",            nameAr: "إنسولين",               nameEn: "Insulin",                  form: "vial",   defaultDose: "حسب الخطة",    defaultFrequency: "حسب القياس" },
    { id: "salbutamol",     nameTrade: "فنتولين",                nameAr: "سالبوتامول",            nameEn: "Salbutamol",               form: "vial",   defaultDose: "2.5 mg",    defaultFrequency: "1×4" },
    { id: "vancomycin",     nameTrade: "فانكوساين",              nameAr: "فانكومايسين",           nameEn: "Vancomycin",               form: "vial",   defaultDose: "حسب البروتوكول", defaultFrequency: "حسب البروتوكول" },
    { id: "meropenem",      nameTrade: "ميرونيم",                nameAr: "ميروبينيم",             nameEn: "Meropenem",                form: "vial",   defaultDose: "1 g",       defaultFrequency: "1×3" }
  ];

  global.PharmacyMedications = {
    FREQUENCIES,
    FORM_LABELS,
    DEFAULT_MEDICATIONS
  };
})(window);
