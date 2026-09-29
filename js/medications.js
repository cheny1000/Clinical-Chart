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

  // Form / dosage-form categories. Each medication has a `form` value.
  // Five forms are supported (ordered as they appear in the UI):
  //   "vial"             → Vial (حقن وريدية / عضلية - مسحوق يُحل)
  //   "ampule"           → Ampule (أمبول - سائل جاهز للحقن)
  //   "prefilled-syringe"→ Prefilled Syringe (سرنجة جاهزة - مثل Enoxaparin)
  //   "tablet"           → حبوب (أشكال فموية: أقراص، كبسولات، شراب)
  //   "supplies"         → مستلزمات طبية (محاليل، سرنجات، قساطر، إلخ)
  const FORM_LABELS = {
    vial:              "Vial",
    ampule:            "Ampule",
    "prefilled-syringe":"Prefilled Syringe",
    tablet:            "حبوب",
    supplies:          "مستلزمات طبية"
  };
  // Display order — determines tab order in the bottom-sheet
  const FORM_ORDER = ["vial", "ampule", "prefilled-syringe", "tablet", "supplies"];
  // Icons (emoji) for each form
  const FORM_ICONS = {
    vial:                "💉",
    ampule:              "🔵",
    "prefilled-syringe": "💉",
    tablet:              "💊",
    supplies:            "🧰"
  };

  // Demo medication catalog — editable by administrator
  // Each medication has THREE name fields + a `form` field:
  //   nameTrade  : Trade / brand name (shown as the PRIMARY name in the UI)
  //   nameAr     : Arabic generic name (kept for backward compat; hidden if nameTrade exists)
  //   nameEn     : Scientific / generic Latin name (shown as secondary under nameTrade)
  //   form       : one of "vial", "ampule", "prefilled-syringe", "tablet", "supplies"
  // If nameTrade is empty, the UI falls back to nameAr.
  const DEFAULT_MEDICATIONS = [
    { id: "paracetamol",    nameTrade: "Tylenol / Panadol",  nameAr: "باراسيتامول",          nameEn: "Paracetamol",              form: "tablet", defaultDose: "1 g",       defaultFrequency: "1×3" },
    { id: "pantoprazole",   nameTrade: "Controloc",           nameAr: "بانتوبرازول",          nameEn: "Pantoprazole",             form: "vial",   defaultDose: "40 mg",     defaultFrequency: "1×1" },
    { id: "ceftriaxone",    nameTrade: "Ceftriaxone Pfizer",  nameAr: "سيفترياكسون",          nameEn: "Ceftriaxone",              form: "vial",   defaultDose: "1 g",       defaultFrequency: "1×2" },
    { id: "enoxaparin",     nameTrade: "Clexane",             nameAr: "إينوكسابارين",          nameEn: "Enoxaparin",               form: "prefilled-syringe", defaultDose: "40 mg", defaultFrequency: "1×1" },
    { id: "metoclopramide", nameTrade: "Primperan",          nameAr: "ميتوكلوبراميد",        nameEn: "Metoclopramide",           form: "ampule", defaultDose: "10 mg",     defaultFrequency: "1×3" },
    { id: "ondansetron",    nameTrade: "Zofran",              nameAr: "أوندانسيترون",          nameEn: "Ondansetron",              form: "ampule", defaultDose: "4 mg",      defaultFrequency: "1×3" },
    { id: "furosemide",     nameTrade: "Lasix",               nameAr: "فيوروسيميد",            nameEn: "Furosemide",               form: "ampule", defaultDose: "20 mg",     defaultFrequency: "1×1" },
    { id: "amoxclav",       nameTrade: "Augmentin",           nameAr: "أموكسيسيلين/كلافيولانات", nameEn: "Amoxicillin/Clavulanate", form: "tablet", defaultDose: "1.2 g",     defaultFrequency: "1×3" },
    { id: "insulin",        nameTrade: "Human Insulin",       nameAr: "إنسولين",               nameEn: "Insulin",                  form: "vial",   defaultDose: "حسب الخطة",    defaultFrequency: "حسب القياس" },
    { id: "salbutamol",     nameTrade: "Ventolin",            nameAr: "سالبوتامول",            nameEn: "Salbutamol",               form: "vial",   defaultDose: "2.5 mg",    defaultFrequency: "1×4" },
    { id: "vancomycin",     nameTrade: "Vancocin",            nameAr: "فانكومايسين",           nameEn: "Vancomycin",               form: "vial",   defaultDose: "حسب البروتوكول", defaultFrequency: "حسب البروتوكول" },
    { id: "meropenem",      nameTrade: "Meronem",             nameAr: "ميروبينيم",             nameEn: "Meropenem",                form: "vial",   defaultDose: "1 g",       defaultFrequency: "1×3" },
    // مستلزمات طبية
    { id: "sodium-chloride-09",  nameTrade: "NaCl 0.9%",      nameAr: "", nameEn: "Sodium Chloride 0.9%", form: "supplies", defaultDose: "500 ml", defaultFrequency: "حسب الحاجة" },
    { id: "glucose-5",           nameTrade: "Glucose 5%",     nameAr: "", nameEn: "Glucose 5%",            form: "supplies", defaultDose: "500 ml", defaultFrequency: "حسب الحاجة" },
    { id: "ringers-lactate",     nameTrade: "Ringer Lactate", nameAr: "", nameEn: "Ringer's Lactate",     form: "supplies", defaultDose: "500 ml", defaultFrequency: "حسب الحاجة" }
  ];

  global.PharmacyMedications = {
    FREQUENCIES,
    FORM_LABELS,
    FORM_ORDER,
    FORM_ICONS,
    DEFAULT_MEDICATIONS
  };
})(window);
