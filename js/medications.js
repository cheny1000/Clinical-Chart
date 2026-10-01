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
  // Eight forms are supported (ordered as they appear in the UI):
  //   "vial"              → Vial (حقن وريدية / عضلية - مسحوق يُحل)
  //   "ampule"            → Ampule (أمبول - سائل جاهز للحقن)
  //   "prefilled-syringe" → Prefilled Syringe (سرنجة جاهزة - مثل Enoxaparin)
  //   "tablet"            → Tablet (أقراص / كبسولات)
  //   "syrup"             → Syrup (شراب فموي)
  //   "suppository"       → Suppository (تحاميل)
  //   "solution"          → Solution (محلول للاستنشاق/ال topical)
  //   "supplies"          → Supplies (مستلزمات طبية)
  const FORM_LABELS = {
    vial:              "Vial",
    ampule:            "Ampule",
    "prefilled-syringe":"Prefilled Syringe",
    tablet:            "Tablet",
    syrup:             "Syrup",
    suppository:       "Suppository",
    solution:          "Solution",
    supplies:          "Supplies"
  };
  // Display order — determines tab order in the bottom-sheet
  const FORM_ORDER = ["vial", "ampule", "prefilled-syringe", "tablet", "syrup", "suppository", "solution", "supplies"];
  // Icons for each form — emoji strings or special image markers
  // 'img:vial-icon.png' means render an <img> instead of emoji text
  const FORM_ICONS = {
    vial:                "img:img/vial-icon.png",
    ampule:              "img:img/ampule-icon.png",
    "prefilled-syringe": "💉",
    tablet:              "img:img/tablet-icon.png",
    syrup:               "img:img/syrup-icon.png",
    suppository:         "img:img/suppository-icon.png",
    solution:            "img:img/solution-icon.png",
    supplies:            "img:img/supplies-icon.png"
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
    { id: "syringe-5cc",          nameTrade: "5cc Syringe",     nameAr: "سرنجة 5 سي سي", nameEn: "5cc Syringe",            form: "supplies", defaultDose: "1 سرنجة", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-1cc",          nameTrade: "1cc Syringe",     nameAr: "سرنجة 1 سي سي", nameEn: "1cc Syringe",            form: "supplies", defaultDose: "1 سرنجة", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-10cc",         nameTrade: "10cc Syringe",    nameAr: "سرنجة 10 سي سي", nameEn: "10cc Syringe",          form: "supplies", defaultDose: "1 سرنجة", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-20cc",         nameTrade: "20cc Syringe",    nameAr: "سرنجة 20 سي سي", nameEn: "20cc Syringe",          form: "supplies", defaultDose: "1 سرنجة", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-50cc",         nameTrade: "50cc Syringe",    nameAr: "سرنجة 50 سي سي", nameEn: "50cc Syringe",          form: "supplies", defaultDose: "1 سرنجة", defaultFrequency: "حسب الحاجة" },
    { id: "iv-set",               nameTrade: "I.V. Set",       nameAr: "خط وريدي", nameEn: "I.V. Set",                 form: "supplies", defaultDose: "1 خط",   defaultFrequency: "حسب الحاجة" },
    { id: "blood-iv-set",         nameTrade: "Blood I.V. Set", nameAr: "خط دم", nameEn: "Blood I.V. Set",              form: "supplies", defaultDose: "1 خط",   defaultFrequency: "حسب الحاجة" },
    { id: "urine-bag",            nameTrade: "Urine Bag",      nameAr: "كيس بول", nameEn: "Urine Bag",                 form: "supplies", defaultDose: "1 كيس",   defaultFrequency: "حسب الحاجة" },
    { id: "floy-14",              nameTrade: "Floy size 14",   nameAr: "فولي 14", nameEn: "Foley Catheter 14",         form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "floy-16",              nameTrade: "Floy size 16",   nameAr: "فولي 16", nameEn: "Foley Catheter 16",         form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "floy-18",              nameTrade: "Floy size 18",   nameAr: "فولي 18", nameEn: "Foley Catheter 18",         form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "ng-tube-14",           nameTrade: "NG Tube size 14", nameAr: "أنبوب معدي 14", nameEn: "NG Tube 14",         form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "ng-tube-16",           nameTrade: "NG Tube size 16", nameAr: "أنبوب معدي 16", nameEn: "NG Tube 16",         form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "ng-tube-18",           nameTrade: "NG Tube size 18", nameAr: "أنبوب معدي 18", nameEn: "NG Tube 18",         form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "cannula",              nameTrade: "Cannula",        nameAr: "كانيولا", nameEn: "Cannula",                  form: "supplies", defaultDose: "1 قطعة", defaultFrequency: "حسب الحاجة" },
    { id: "dextrose-saline",      nameTrade: "Dextrose Saline 0.9% / 5%", nameAr: "ديكستروز سالين", nameEn: "Dextrose Saline 0.9% / 5%", form: "supplies", defaultDose: "500 ml", defaultFrequency: "حسب الحاجة" },
    { id: "nacl-100ml",           nameTrade: "NaCl 0.9% 100 ml", nameAr: "مغذي ملح 100 مل", nameEn: "Sodium Chloride 0.9% 100 ml", form: "supplies", defaultDose: "100 ml", defaultFrequency: "حسب الحاجة" },
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
