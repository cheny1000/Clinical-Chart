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

  // Demo medication catalog — editable by administrator
  const DEFAULT_MEDICATIONS = [
    { id: "paracetamol",    nameAr: "باراسيتامول",          nameEn: "Paracetamol",              defaultDose: "1 g",       defaultFrequency: "1×3" },
    { id: "pantoprazole",   nameAr: "بانتوبرازول",          nameEn: "Pantoprazole",             defaultDose: "40 mg",     defaultFrequency: "1×1" },
    { id: "ceftriaxone",    nameAr: "سيفترياكسون",          nameEn: "Ceftriaxone",              defaultDose: "1 g",       defaultFrequency: "1×2" },
    { id: "enoxaparin",     nameAr: "إينوكسابارين",          nameEn: "Enoxaparin",               defaultDose: "40 mg",     defaultFrequency: "1×1" },
    { id: "metoclopramide", nameAr: "ميتوكلوبراميد",        nameEn: "Metoclopramide",           defaultDose: "10 mg",     defaultFrequency: "1×3" },
    { id: "ondansetron",    nameAr: "أوندانسيترون",          nameEn: "Ondansetron",              defaultDose: "4 mg",      defaultFrequency: "1×3" },
    { id: "furosemide",     nameAr: "فيوروسيميد",            nameEn: "Furosemide",               defaultDose: "20 mg",     defaultFrequency: "1×1" },
    { id: "amoxclav",       nameAr: "أموكسيسيلين/كلافيولانات", nameEn: "Amoxicillin/Clavulanate", defaultDose: "1.2 g",     defaultFrequency: "1×3" },
    { id: "insulin",        nameAr: "إنسولين",               nameEn: "Insulin",                  defaultDose: "حسب الخطة",    defaultFrequency: "حسب القياس" },
    { id: "salbutamol",     nameAr: "سالبوتامول",            nameEn: "Salbutamol",               defaultDose: "2.5 mg",    defaultFrequency: "1×4" },
    { id: "vancomycin",     nameAr: "فانكومايسين",           nameEn: "Vancomycin",               defaultDose: "حسب البروتوكول", defaultFrequency: "حسب البروتوكول" },
    { id: "meropenem",      nameAr: "ميروبينيم",             nameEn: "Meropenem",                defaultDose: "1 g",       defaultFrequency: "1×3" }
  ];

  global.PharmacyMedications = {
    FREQUENCIES,
    DEFAULT_MEDICATIONS
  };
})(window);
