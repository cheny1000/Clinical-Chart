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
  // Daily frequencies: "1×1" = once/day, "1×2" = twice/day, etc.
  // Non-daily frequencies: "كل يومين" = every 2 days, "كل 3 أيام" = every 3 days,
  // "كل أسبوع" = every week. These are for meds like Vancomycin in
  // renal failure where dosing interval depends on kidney function
  // and the med is NOT given every day.
  const FREQUENCIES = ["1×1", "1×2", "1×3", "1×4", "كل يومين", "كل 3 أيام", "كل أسبوع"];

  // Form / dosage-form categories. Each medication has a `form` value.
  // Eight forms are supported (ordered as they appear in the UI):
  //   "vial"              → Vial (حقن وريدية / عضلية - مسحوق يُحل)
  //   "ampule"            → Ampule (أمبول - سائل جاهز للحقن)
  //   "prefilled-syringe" → Prefilled Syringe (سرنجة جاهزة - مثل Enoxaparin)
  //   "tablet"            → Tablet (أقراص / كبسولات)
  //   "syrup-and-oral-drop" → OSD (Ointment, Syrup, Drops)
  //   "suppository"       → Suppository (تحاميل)
  //   "solution"          → Solution (محلول للاستنشاق/ال topical)
  //   "supplies"          → Supplies (مستلزمات طبية)
  const FORM_LABELS = {
    vial:              "Vial",
    ampule:            "Ampule",
    "prefilled-syringe":"Prefilled Syringe",
    tablet:            "Tablet",
    "syrup-and-oral-drop": "OSD",
    suppository:       "Suppository",
    solution:          "Solution",
    supplies:          "Supplies"
  };
  // Short abbreviations for each form — used in the patient sheet
  // print view (left of each med line). These are simple text labels
  // (not images) so they render correctly in the print window which
  // doesn't have access to the app's image files.
  const FORM_ABBR = {
    vial:                  "V",
    ampule:                "A",
    "prefilled-syringe":   "PS",
    tablet:                "T",
    "syrup-and-oral-drop": "OSD",
    suppository:           "S",
    solution:              "Sol",
    supplies:              "Sup"
  };
  // Display order — determines tab order in the bottom-sheet
  const FORM_ORDER = ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
  // Icons for each form — emoji strings or special image markers
  // 'img:vial-icon.png' means render an <img> instead of emoji text
  const FORM_ICONS = {
    vial:                "img:img/vial-icon.png",
    ampule:              "img:img/ampule-icon.png",
    "prefilled-syringe": "💉",
    tablet:              "img:img/tablet-icon.png",
    "syrup-and-oral-drop":  "img:img/syrup-icon.png",
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
    { id: "vancomycin",     nameTrade: "Vancocin",            nameAr: "فانكومايسين",           nameEn: "Vancomycin",               form: "vial",   defaultDose: "1 g",       defaultFrequency: "1×2" },
    { id: "meropenem",      nameTrade: "Meronem",             nameAr: "ميروبينيم",             nameEn: "Meropenem",                form: "vial",   defaultDose: "1 g",       defaultFrequency: "1×3" },
    // أدوية إضافية (vials)
    { id: "amoxycillin-500",     nameTrade: "Amoxycillin 500mg",    nameAr: "أموكسيسيلين 500 ملغ",  nameEn: "Amoxycillin 500mg",    form: "vial",   defaultDose: "500 mg",   defaultFrequency: "1×2" },
    { id: "ceftazidime-1g",      nameTrade: "Ceftazidime 1g",       nameAr: "سيفازيديم 1 جم",       nameEn: "Ceftazidime 1g",       form: "vial",   defaultDose: "1 g",      defaultFrequency: "1×2" },
    { id: "ciprofloxacin-200",   nameTrade: "Ciprofloxacin 200mg",  nameAr: "سيبروفلوكساسين 200 ملغ", nameEn: "Ciprofloxacin 200mg", form: "vial",   defaultDose: "200 mg",   defaultFrequency: "1×2" },
    { id: "human-albumin-20",    nameTrade: "Human Albumin 20%",    nameAr: "ألبومين بشري 20%",     nameEn: "Human Albumin 20%",    form: "vial",   defaultDose: "حسب الحالة", defaultFrequency: "حسب الحاجة" },
    { id: "insulin-lente",       nameTrade: "Insulin Lente",         nameAr: "إنسولين لنت",          nameEn: "Insulin Lente",        form: "vial",   defaultDose: "حسب الخطة", defaultFrequency: "حسب القياس" },
    { id: "insulin-mixtard",     nameTrade: "Insulin Human Mixtard", nameAr: "إنسولين ميكستارد",    nameEn: "Insulin Human Mixtard", form: "vial",   defaultDose: "حسب الخطة", defaultFrequency: "حسب القياس" },
    { id: "insulin-soluble",     nameTrade: "Insulin Soluble",      nameAr: "إنسولين سوليوبل",      nameEn: "Insulin Soluble",      form: "vial",   defaultDose: "حسب الخطة", defaultFrequency: "حسب القياس" },
    { id: "methylprednisolone",  nameTrade: "Methylprednisolone",    nameAr: "ميثيل بريدنيزولون",    nameEn: "Methylprednisolone",   form: "vial",   defaultDose: "40 mg",    defaultFrequency: "1×2" },
    { id: "fucidin",             nameTrade: "Fucidin",              nameAr: "فيوسيدين",             nameEn: "Fucidin",             form: "tablet", defaultDose: "500 mg",   defaultFrequency: "1×3" },
    // أدوية إضافية (ampules)
    { id: "angesid",             nameTrade: "Angesid",              nameAr: "أنجيزيد",              nameEn: "Angesid",              form: "ampule", defaultDose: "10 mg",    defaultFrequency: "حسب الحاجة" },
    { id: "calcium-gluconate",   nameTrade: "Calcium Gluconate",    nameAr: "جلوكونات الكالسيوم",   nameEn: "Calcium Gluconate",    form: "ampule", defaultDose: "10%",      defaultFrequency: "حسب الحاجة" },
    { id: "buscopan",            nameTrade: "Buscopan",            nameAr: "بوسكوبان",              nameEn: "Buscopan",             form: "ampule", defaultDose: "20 mg",    defaultFrequency: "1×3" },
    { id: "venofer",             nameTrade: "Venofer",             nameAr: "فينوفر",                nameEn: "Venofer",              form: "ampule", defaultDose: "100 mg",   defaultFrequency: "حسب الحاجة" },
    { id: "acupan",              nameTrade: "Acupan",              nameAr: "أكوبان",                nameEn: "Acupan",               form: "ampule", defaultDose: "20 mg",    defaultFrequency: "1×3" },
    { id: "cyklokapron",         nameTrade: "Cyklokapron",          nameAr: "سيكلوكابرون",           nameEn: "Cyklokapron",          form: "ampule", defaultDose: "500 mg",   defaultFrequency: "1×3" },
    { id: "vitamin-b12",         nameTrade: "Vitamin B12",          nameAr: "فيتامين ب12",          nameEn: "Vitamin B12",          form: "ampule", defaultDose: "1000 mcg", defaultFrequency: "1×1" },
    { id: "vitamin-b6",          nameTrade: "Vitamin B6",           nameAr: "فيتامين ب6",           nameEn: "Vitamin B6",           form: "ampule", defaultDose: "100 mg",   defaultFrequency: "1×1" },
    { id: "vitamin-k",           nameTrade: "Vitamin K",            nameAr: "فيتامين ك",             nameEn: "Vitamin K",            form: "ampule", defaultDose: "10 mg",    defaultFrequency: "حسب الحاجة" },
    { id: "aminophylline-250",   nameTrade: "Aminophylline 250mg",  nameAr: "أمينوفيلين 250 ملغ",   nameEn: "Aminophylline 250mg",  form: "ampule", defaultDose: "250 mg",   defaultFrequency: "1×3" },
    // أدوية إضافية (tablets)
    { id: "flagyl-500",          nameTrade: "Flagyl 500 mg",        nameAr: "فلاجيل 500 ملغ",        nameEn: "Metronidazole 500mg",  form: "tablet", defaultDose: "500 mg",   defaultFrequency: "1×3" },
    { id: "amlodipine-5",        nameTrade: "Amlodipine 5mg",       nameAr: "أملوديبين 5 ملغ",       nameEn: "Amlodipine 5mg",       form: "tablet", defaultDose: "5 mg",     defaultFrequency: "1×1" },
    { id: "apixaban-5",          nameTrade: "Apixaban 5mg",         nameAr: "أبيكسابان 5 ملغ",       nameEn: "Apixaban 5mg",         form: "tablet", defaultDose: "5 mg",     defaultFrequency: "1×2" },
    { id: "calcium-carbonate-500", nameTrade: "Calcium Carbonate 500mg", nameAr: "كربونات الكالسيوم 500 ملغ", nameEn: "Calcium Carbonate 500mg", form: "tablet", defaultDose: "500 mg", defaultFrequency: "1×2" },
    // أدوية إضافية (solutions)
    { id: "nystatin-oral",        nameTrade: "Nystatin Oral Drop",   nameAr: "نيستاتين نقط للفم",    nameEn: "Nystatin Oral Drop",   form: "syrup-and-oral-drop", defaultDose: "1 مل",  defaultFrequency: "1×4" },
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

  // Bump this number whenever you add new medications to
  // DEFAULT_MEDICATIONS and want existing users to receive them on
  // their next app open. The storage layer compares this version to
  // the user's `pharma.catalog.seed.v1` localStorage key; if the
  // version is higher, missing meds are merged into the user's
  // saved catalog (one-time, then the stamp is updated).
  //
  // History:
  //   v1 = added 24 new meds (Amoxycillin, Ceftazidime, etc.) +
  //        NaCl 100ml + 5cc Syringe auto-add rule + 14 supplies
  //   v2 = added non-daily frequencies (كل يومين, كل 3 أيام, كل أسبوع) +
  //        changed vancomycin default frequency to 'كل يومين' +
  //        changed vancomycin default dose to 'حسب البروتوكول'
  //   v3 = changed vancomycin default to dose='1 g' + frequency='1×2'
  //        (user confirmed: default is daily twice, not every-2-days.
  //         The non-daily frequencies are available for renal-failure
  //         patients but Vancomycin's DEFAULT is 1×2 daily.)
  const DEFAULT_MEDICATIONS_VERSION = 3;

  // ---- Non-daily frequency helpers ----
  // Maps a non-daily frequency string to the number of days between
  // doses. Returns 0 for daily frequencies (1×N) and custom text.
  const NON_DAILY_INTERVALS = {
    "كل يومين":  2,   // every 2 days
    "كل 3 أيام": 3,   // every 3 days
    "كل أسبوع":  7    // every week
  };

  // Returns the interval (in days) for a frequency string.
  //   "1×3"       → 0 (daily, 3 times per day)
  //   "كل يومين"  → 2 (every 2 days)
  //   "كل أسبوع"  → 7 (every week)
  //   "حسب القياس" → 0 (custom — treat as daily for chart purposes)
  function getFrequencyInterval(freq) {
    if (!freq) return 0;
    if (NON_DAILY_INTERVALS[freq]) return NON_DAILY_INTERVALS[freq];
    // "1×N" or plain "N" → daily (interval = 0)
    if (/×\s*\d+/.test(freq) || /^\d+$/.test(freq)) return 0;
    return 0; // custom → treat as daily
  }

  // Returns true if the med is "due today" — i.e. the patient should
  // receive this medication today based on the dosing interval + the
  // date the med was first prescribed.
  //
  // For daily meds (interval = 0): always due → returns true.
  // For non-daily meds (interval > 0): calculates the day number
  // since firstMedDate. If (dayNumber % interval) === 0 → due today.
  //
  // Parameters:
  //   freq        — the frequency string (e.g. "1×3", "كل يومين")
  //   firstMedDate — ISO date string of when the med was first prescribed
  //                  (optional — if missing, defaults to "always due")
  function isMedDueToday(freq, firstMedDate) {
    const interval = getFrequencyInterval(freq);
    if (interval === 0) return true;  // daily med → always due
    if (!firstMedDate) return true;    // no start date → assume due
    try {
      const start = new Date(firstMedDate);
      start.setHours(0, 0, 0, 0);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const daysSinceStart = Math.floor((now - start) / 86400000);
      if (daysSinceStart < 0) return false; // med hasn't started yet
      return (daysSinceStart % interval) === 0;
    } catch (e) {
      return true;  // date parse error → assume due
    }
  }

  global.PharmacyMedications = {
    FREQUENCIES,
    FORM_LABELS,
    FORM_ABBR,
    FORM_ORDER,
    FORM_ICONS,
    DEFAULT_MEDICATIONS,
    DEFAULT_MEDICATIONS_VERSION,
    NON_DAILY_INTERVALS,
    getFrequencyInterval,
    isMedDueToday
  };
})(window);
