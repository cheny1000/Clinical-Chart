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
  // Fluid IDs — these are IV fluids (N/S, G/S, R/L, G/W) that stay
  // in the "supplies" form category but get a special abbreviation
  // "F" (Fluids) in the patient sheet instead of "Sup".
  const FLUID_IDS = [
    "dextrose-saline",     // G/S
    "ringers-lactate",     // R/L
    "glucose-5",           // G/W
    "sodium-chloride-09",  // N/S 500ml
    "nacl-100ml"           // N/S 100ml
  ];
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

  // ===== DISABLED CATALOG =====
  // The old default catalog is kept here (disabled) so existing
  // patient prescriptions that reference these med IDs still have
  // a lookup entry. These meds will NOT appear in the med-selection
  // sheet (bottom-sheet) because the seed-merge logic only adds
  // DEFAULT_MEDICATIONS (below) — not this list.
  // When the user provides their new list, it will replace
  // DEFAULT_MEDICATIONS entirely.
  const DISABLED_MEDICATIONS = [
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

  // ===== NEW DEFAULT CATALOG =====
  // This will be replaced with the user's new med list when they
  // provide it. For now it's empty — the old meds are disabled
  // (moved to DISABLED_MEDICATIONS above) but still available as
  // lookup entries for existing patient prescriptions.
  // The disabled meds are merged into the user's local catalog
  // as "hidden" entries so existing patient meds still resolve
  // their names + forms for the chart + patient sheet printing.
  const DEFAULT_MEDICATIONS = [
  // Total: 235 medications
    { id: "acetylase-50mg-vial", nameTrade: "Acetylase 50mg/Vial", nameAr: "", nameEn: "Acetylase 50mg/Vial", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "actemra-200mg", nameTrade: "Actemra 200mg", nameAr: "", nameEn: "Actemra 200mg", form: "vial", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "acupan", nameTrade: "Acupan", nameAr: "", nameEn: "Acupan", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "adenosine-6mg", nameTrade: "Adenosine 6mg", nameAr: "", nameEn: "Adenosine 6mg", form: "ampule", defaultDose: "6mg", defaultFrequency: "1×1" },
    { id: "adrenaline-1mg", nameTrade: "Adrenaline 1mg", nameAr: "", nameEn: "Adrenaline 1mg", form: "ampule", defaultDose: "1mg", defaultFrequency: "1×1" },
    { id: "allermine-10mg", nameTrade: "Allermine 10mg", nameAr: "", nameEn: "Allermine 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "amaryl-2mg", nameTrade: "Amaryl 2mg", nameAr: "", nameEn: "Amaryl 2mg", form: "tablet", defaultDose: "2mg", defaultFrequency: "1×1" },
    { id: "ambisome-50mg", nameTrade: "AmBisome 50mg", nameAr: "", nameEn: "AmBisome 50mg", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "ambrisantanlet-10mg", nameTrade: "Ambrisantanlet 10mg", nameAr: "", nameEn: "Ambrisantanlet 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "amikacin-500mg", nameTrade: "Amikacin 500mg", nameAr: "", nameEn: "Amikacin 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "aminophylline-250mg", nameTrade: "Aminophylline 250mg", nameAr: "", nameEn: "Aminophylline 250mg", form: "ampule", defaultDose: "250mg", defaultFrequency: "1×1" },
    { id: "amitriptyline-25mg", nameTrade: "Amitriptyline 25mg", nameAr: "", nameEn: "Amitriptyline 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "amlodipine-5mg", nameTrade: "Amlodipine 5mg", nameAr: "", nameEn: "Amlodipine 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "amoxil-250mg-5ml", nameTrade: "Amoxil 250mg/5ml", nameAr: "", nameEn: "Amoxil 250mg/5ml", form: "syrup-and-oral-drop", defaultDose: "250mg", defaultFrequency: "1×1" },
    { id: "amoxil-500mg", nameTrade: "Amoxil 500mg", nameAr: "", nameEn: "Amoxil 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "amoxil-500mg-1", nameTrade: "Amoxil 500mg", nameAr: "", nameEn: "Amoxil 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "anafranil-25mg", nameTrade: "Anafranil 25mg", nameAr: "", nameEn: "Anafranil 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "angesid-0-5mg", nameTrade: "Angesid 0.5mg", nameAr: "", nameEn: "Angesid 0.5mg", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1×1" },
    { id: "angesid-10mgoule", nameTrade: "Angesid 10mgoule", nameAr: "", nameEn: "Angesid 10mgoule", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "angesid-25mgoule", nameTrade: "Angesid 25mgoule", nameAr: "", nameEn: "Angesid 25mgoule", form: "ampule", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "angisar-plus", nameTrade: "Angisar plus", nameAr: "", nameEn: "Angisar plus", form: "tablet", defaultDose: "", defaultFrequency: "1×1" },
    { id: "anti-d-1500-iu", nameTrade: "Anti D 1500 IU", nameAr: "", nameEn: "Anti D 1500 IU", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "apixaban-5mg", nameTrade: "Apixaban 5mg", nameAr: "", nameEn: "Apixaban 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "apresoline-20mg", nameTrade: "Apresoline 20mg", nameAr: "", nameEn: "Apresoline 20mg", form: "ampule", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "aransip-20mcg", nameTrade: "Aransip 20mcg", nameAr: "", nameEn: "Aransip 20mcg", form: "prefilled-syringe", defaultDose: "20mcg", defaultFrequency: "1×1" },
    { id: "aransip-40mcg", nameTrade: "Aransip 40mcg", nameAr: "", nameEn: "Aransip 40mcg", form: "prefilled-syringe", defaultDose: "40mcg", defaultFrequency: "1×1" },
    { id: "aspirin-100mg", nameTrade: "Aspirin 100mg", nameAr: "", nameEn: "Aspirin 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "atropine-1mg", nameTrade: "Atropine 1mg", nameAr: "", nameEn: "Atropine 1mg", form: "ampule", defaultDose: "1mg", defaultFrequency: "1×1" },
    { id: "augmentin-312-5mg", nameTrade: "Augmentin 312.5mg", nameAr: "", nameEn: "Augmentin 312.5mg", form: "syrup-and-oral-drop", defaultDose: "312.5mg", defaultFrequency: "1×1" },
    { id: "augmentin-625mglet", nameTrade: "Augmentin 625mglet", nameAr: "", nameEn: "Augmentin 625mglet", form: "tablet", defaultDose: "625mg", defaultFrequency: "1×1" },
    { id: "avas-20mg", nameTrade: "Avas 20mg", nameAr: "", nameEn: "Avas 20mg", form: "tablet", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "avas-40mg", nameTrade: "Avas 40mg", nameAr: "", nameEn: "Avas 40mg", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "azithromycin-500mg", nameTrade: "Azithromycin 500mg", nameAr: "", nameEn: "Azithromycin 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "blood-giving-set", nameTrade: "Blood giving set", nameAr: "", nameEn: "Blood giving set", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "bosentan-125mg", nameTrade: "Bosentan 125mg", nameAr: "", nameEn: "Bosentan 125mg", form: "tablet", defaultDose: "125mg", defaultFrequency: "1×1" },
    { id: "brilinta-90mg", nameTrade: "Brilinta 90mg", nameAr: "", nameEn: "Brilinta 90mg", form: "tablet", defaultDose: "90mg", defaultFrequency: "1×1" },
    { id: "brufen-200mg", nameTrade: "Brufen 200mg", nameAr: "", nameEn: "Brufen 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "buscopan-10mg", nameTrade: "Buscopan 10mg", nameAr: "", nameEn: "Buscopan 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "buscopan-10mg-1", nameTrade: "Buscopan 10mg", nameAr: "", nameEn: "Buscopan 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "caffeine", nameTrade: "Caffeine", nameAr: "", nameEn: "Caffeine", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "calcium-500mg", nameTrade: "Calcium 500mg", nameAr: "", nameEn: "Calcium 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "calcium", nameTrade: "Calcium", nameAr: "", nameEn: "Calcium", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "candesartan-8mg", nameTrade: "Candesartan 8mg", nameAr: "", nameEn: "Candesartan 8mg", form: "tablet", defaultDose: "8mg", defaultFrequency: "1×1" },
    { id: "capoten-25mg", nameTrade: "Capoten 25mg", nameAr: "", nameEn: "Capoten 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "carvedilol-6-25mg", nameTrade: "Carvedilol 6.25mg", nameAr: "", nameEn: "Carvedilol 6.25mg", form: "tablet", defaultDose: "6.25mg", defaultFrequency: "1×1" },
    { id: "caspofungin-50mg", nameTrade: "Caspofungin 50mg", nameAr: "", nameEn: "Caspofungin 50mg", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "cefotaxime-1g", nameTrade: "Cefotaxime 1g", nameAr: "", nameEn: "Cefotaxime 1g", form: "vial", defaultDose: "1g", defaultFrequency: "1×1" },
    { id: "ceftazidime-1g", nameTrade: "Ceftazidime 1g", nameAr: "", nameEn: "Ceftazidime 1g", form: "vial", defaultDose: "1g", defaultFrequency: "1×1" },
    { id: "ceftrixone-1g", nameTrade: "Ceftrixone 1g", nameAr: "", nameEn: "Ceftrixone 1g", form: "vial", defaultDose: "1g", defaultFrequency: "1×1" },
    { id: "ciprodar-200mg", nameTrade: "Ciprodar 200mg", nameAr: "", nameEn: "Ciprodar 200mg", form: "vial", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "ciprodar-500mg", nameTrade: "Ciprodar 500mg", nameAr: "", nameEn: "Ciprodar 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "clexane-syringe-4000-iu", nameTrade: "Clexane syringe 4000 IU", nameAr: "", nameEn: "Clexane syringe 4000 IU", form: "tablet", defaultDose: "", defaultFrequency: "1×1" },
    { id: "clexane-syringe-6000-iu", nameTrade: "Clexane syringe 6000 IU", nameAr: "", nameEn: "Clexane syringe 6000 IU", form: "tablet", defaultDose: "", defaultFrequency: "1×1" },
    { id: "colchicine-0-5mg", nameTrade: "Colchicine 0.5mg", nameAr: "", nameEn: "Colchicine 0.5mg", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1×1" },
    { id: "colistin-1000000-iu", nameTrade: "Colistin 1000000 IU", nameAr: "", nameEn: "Colistin 1000000 IU", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "concor-5mg", nameTrade: "Concor 5mg", nameAr: "", nameEn: "Concor 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "cordarone-150mg", nameTrade: "Cordarone 150mg", nameAr: "", nameEn: "Cordarone 150mg", form: "ampule", defaultDose: "150mg", defaultFrequency: "1×1" },
    { id: "cordarone-200mg", nameTrade: "Cordarone 200mg", nameAr: "", nameEn: "Cordarone 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "crestor-20mg", nameTrade: "Crestor 20mg", nameAr: "", nameEn: "Crestor 20mg", form: "tablet", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "crestor-40mg", nameTrade: "Crestor 40mg", nameAr: "", nameEn: "Crestor 40mg", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "cyclocapron-500mg", nameTrade: "Cyclocapron 500mg", nameAr: "", nameEn: "Cyclocapron 500mg", form: "ampule", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "daonil-5mg", nameTrade: "Daonil 5mg", nameAr: "", nameEn: "Daonil 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "decadrone-8mg", nameTrade: "Decadrone 8mg", nameAr: "", nameEn: "Decadrone 8mg", form: "ampule", defaultDose: "8mg", defaultFrequency: "1×1" },
    { id: "depakine-200mg", nameTrade: "Depakine 200mg", nameAr: "", nameEn: "Depakine 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "depomedrol-80mg", nameTrade: "Depomedrol 80mg", nameAr: "", nameEn: "Depomedrol 80mg", form: "vial", defaultDose: "80mg", defaultFrequency: "1×1" },
    { id: "digoxin-250mcg", nameTrade: "Digoxin 250mcg", nameAr: "", nameEn: "Digoxin 250mcg", form: "tablet", defaultDose: "250mcg", defaultFrequency: "1×1" },
    { id: "digoxin", nameTrade: "digoxin", nameAr: "", nameEn: "digoxin", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "diltiazem-60mg", nameTrade: "Diltiazem 60mg", nameAr: "", nameEn: "Diltiazem 60mg", form: "tablet", defaultDose: "60mg", defaultFrequency: "1×1" },
    { id: "dobutamine-250mg", nameTrade: "Dobutamine 250mg", nameAr: "", nameEn: "Dobutamine 250mg", form: "vial", defaultDose: "250mg", defaultFrequency: "1×1" },
    { id: "dopamine-200mg", nameTrade: "Dopamine 200mg", nameAr: "", nameEn: "Dopamine 200mg", form: "ampule", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "doxycycline-100mg", nameTrade: "Doxycycline 100mg", nameAr: "", nameEn: "Doxycycline 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "dusptalin-135mg", nameTrade: "Dusptalin 135mg", nameAr: "", nameEn: "Dusptalin 135mg", form: "tablet", defaultDose: "135mg", defaultFrequency: "1×1" },
    { id: "ebixa-10mg", nameTrade: "Ebixa 10mg", nameAr: "", nameEn: "Ebixa 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "empadil-10mg", nameTrade: "Empadil 10mg", nameAr: "", nameEn: "Empadil 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "endoxan-500mg", nameTrade: "Endoxan 500mg", nameAr: "", nameEn: "Endoxan 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "entero-stop", nameTrade: "Entero-stop", nameAr: "", nameEn: "Entero-stop", form: "tablet", defaultDose: "", defaultFrequency: "1×1" },
    { id: "entersto-50mg", nameTrade: "Entersto 50mg", nameAr: "", nameEn: "Entersto 50mg", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "entresto-100mg", nameTrade: "Entresto 100mg", nameAr: "", nameEn: "Entresto 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "entresto-50mg", nameTrade: "Entresto 50mg", nameAr: "", nameEn: "Entresto 50mg", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "eplerenone-25mg", nameTrade: "Eplerenone  25mg", nameAr: "", nameEn: "Eplerenone  25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "escitalopram-10mg", nameTrade: "Escitalopram 10mg", nameAr: "", nameEn: "Escitalopram 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "esmeron-50mg", nameTrade: "Esmeron 50mg", nameAr: "", nameEn: "Esmeron 50mg", form: "ampule", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "esomprazole-40mg", nameTrade: "Esomprazole 40mg", nameAr: "", nameEn: "Esomprazole 40mg", form: "vial", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "ferrofolic", nameTrade: "Ferrofolic", nameAr: "", nameEn: "Ferrofolic", form: "tablet", defaultDose: "", defaultFrequency: "1×1" },
    { id: "ferrosam-200mg", nameTrade: "Ferrosam 200mg", nameAr: "", nameEn: "Ferrosam 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "flagyl-500mg", nameTrade: "Flagyl 500mg", nameAr: "", nameEn: "Flagyl 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "flagyl-500mg-1", nameTrade: "Flagyl 500mg", nameAr: "", nameEn: "Flagyl 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "flamazine-1", nameTrade: "Flamazine 1%", nameAr: "", nameEn: "Flamazine 1%", form: "solution", defaultDose: "1%", defaultFrequency: "حسب الحاجة" },
    { id: "flucloxacillin-500mg", nameTrade: "Flucloxacillin 500mg", nameAr: "", nameEn: "Flucloxacillin 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "fluconazole-150mg", nameTrade: "Fluconazole 150mg", nameAr: "", nameEn: "Fluconazole 150mg", form: "tablet", defaultDose: "150mg", defaultFrequency: "1×1" },
    { id: "fluoxetine-20mg", nameTrade: "Fluoxetine 20mg", nameAr: "", nameEn: "Fluoxetine 20mg", form: "tablet", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "folic-acid-5mg", nameTrade: "Folic acid 5mg", nameAr: "", nameEn: "Folic acid 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "foly-catheter", nameTrade: "Foly catheter", nameAr: "", nameEn: "Foly catheter", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "forxiga-10mg", nameTrade: "Forxiga 10mg", nameAr: "", nameEn: "Forxiga 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "forxiga-5mg", nameTrade: "Forxiga 5mg", nameAr: "", nameEn: "Forxiga 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "fucidin", nameTrade: "Fucidin", nameAr: "", nameEn: "Fucidin", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "g-w-5-500ml", nameTrade: "G/W 5% 500ml", nameAr: "", nameEn: "G/W 5% 500ml", form: "supplies", defaultDose: "5%", defaultFrequency: "حسب الحاجة" },
    { id: "gabapentin-300mg", nameTrade: "Gabapentin 300mg", nameAr: "", nameEn: "Gabapentin 300mg", form: "tablet", defaultDose: "300mg", defaultFrequency: "1×1" },
    { id: "garamycin-80mg", nameTrade: "Garamycin 80mg", nameAr: "", nameEn: "Garamycin 80mg", form: "ampule", defaultDose: "80mg", defaultFrequency: "1×1" },
    { id: "gentamicin", nameTrade: "gentamicin", nameAr: "", nameEn: "gentamicin", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "glucophage-500mg", nameTrade: "Glucophage 500mg", nameAr: "", nameEn: "Glucophage 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "haloperidol-10mg", nameTrade: "Haloperidol 10mg", nameAr: "", nameEn: "Haloperidol 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "heparin", nameTrade: "Heparin", nameAr: "", nameEn: "Heparin", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "histadin-4mglet", nameTrade: "Histadin 4mglet", nameAr: "", nameEn: "Histadin 4mglet", form: "tablet", defaultDose: "4mg", defaultFrequency: "1×1" },
    { id: "human-albumin-20-i-v", nameTrade: "Human albumin 20% I.V", nameAr: "", nameEn: "Human albumin 20% I.V", form: "tablet", defaultDose: "20%", defaultFrequency: "1×1" },
    { id: "hydralazine", nameTrade: "Hydralazine", nameAr: "", nameEn: "Hydralazine", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "hydrocortisone-100mg", nameTrade: "Hydrocortisone 100mg", nameAr: "", nameEn: "Hydrocortisone 100mg", form: "vial", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "hyoscine-20mg", nameTrade: "Hyoscine 20mg", nameAr: "", nameEn: "Hyoscine 20mg", form: "ampule", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "hypertonic-glucose", nameTrade: "Hypertonic glucose", nameAr: "", nameEn: "Hypertonic glucose", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "ibandronic-acid-150mg", nameTrade: "Ibandronic acid 150mg", nameAr: "", nameEn: "Ibandronic acid 150mg", form: "tablet", defaultDose: "150mg", defaultFrequency: "1×1" },
    { id: "inderal-40mg", nameTrade: "Inderal 40mg", nameAr: "", nameEn: "Inderal 40mg", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "insulin-lente", nameTrade: "Insulin lente", nameAr: "", nameEn: "Insulin lente", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "insulin-mixtard", nameTrade: "Insulin mixtard", nameAr: "", nameEn: "Insulin mixtard", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "insulin-soluble", nameTrade: "Insulin soluble", nameAr: "", nameEn: "Insulin soluble", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "isoptin-5mg", nameTrade: "Isoptin 5mg", nameAr: "", nameEn: "Isoptin 5mg", form: "ampule", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "isordil-10mg", nameTrade: "Isordil 10mg", nameAr: "", nameEn: "Isordil 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "iv-set", nameTrade: "IV set", nameAr: "", nameEn: "IV set", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "ivig", nameTrade: "IVIG", nameAr: "", nameEn: "IVIG", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "kcl-15", nameTrade: "KCl 15%", nameAr: "", nameEn: "KCl 15%", form: "ampule", defaultDose: "15%", defaultFrequency: "1×1" },
    { id: "keflex-500mg", nameTrade: "Keflex 500mg", nameAr: "", nameEn: "Keflex 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "kemadrin-5mg", nameTrade: "Kemadrin 5mg", nameAr: "", nameEn: "Kemadrin 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "keppra-1000mg", nameTrade: "Keppra 1000mg", nameAr: "", nameEn: "Keppra 1000mg", form: "tablet", defaultDose: "1000mg", defaultFrequency: "1×1" },
    { id: "keppra-500mg", nameTrade: "Keppra 500mg", nameAr: "", nameEn: "Keppra 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "keppra-100mg-ml", nameTrade: "Keppra 100mg/ml", nameAr: "", nameEn: "Keppra 100mg/ml", form: "vial", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "ketamine-500mg", nameTrade: "Ketamine 500mg", nameAr: "", nameEn: "Ketamine 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "ketorolac-30mg", nameTrade: "Ketorolac 30mg", nameAr: "", nameEn: "Ketorolac 30mg", form: "ampule", defaultDose: "30mg", defaultFrequency: "1×1" },
    { id: "lacosmide-100mg", nameTrade: "Lacosmide 100mg", nameAr: "", nameEn: "Lacosmide 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "lactulose", nameTrade: "Lactulose", nameAr: "", nameEn: "Lactulose", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×1" },
    { id: "largactil-100mg", nameTrade: "Largactil 100mg", nameAr: "", nameEn: "Largactil 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "largactil-50mg", nameTrade: "Largactil 50mg", nameAr: "", nameEn: "Largactil 50mg", form: "ampule", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "lasix-20mg", nameTrade: "Lasix 20mg", nameAr: "", nameEn: "Lasix 20mg", form: "ampule", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "lasix-40mg", nameTrade: "Lasix 40mg", nameAr: "", nameEn: "Lasix 40mg", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "laxadyl", nameTrade: "Laxadyl", nameAr: "", nameEn: "Laxadyl", form: "suppository", defaultDose: "", defaultFrequency: "1×1" },
    { id: "librium-5mg", nameTrade: "Librium 5mg", nameAr: "", nameEn: "Librium 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "lidocaine", nameTrade: "Lidocaine", nameAr: "", nameEn: "Lidocaine", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "lidocaine-1", nameTrade: "Lidocaine", nameAr: "", nameEn: "Lidocaine", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "lisinopril-10mg", nameTrade: "Lisinopril 10mg", nameAr: "", nameEn: "Lisinopril 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "lorazepam-2mg", nameTrade: "Lorazepam 2mg", nameAr: "", nameEn: "Lorazepam 2mg", form: "tablet", defaultDose: "2mg", defaultFrequency: "1×1" },
    { id: "losartan-50mg", nameTrade: "Losartan 50mg", nameAr: "", nameEn: "Losartan 50mg", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "luminal-200mg", nameTrade: "Luminal 200mg", nameAr: "", nameEn: "Luminal 200mg", form: "ampule", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "mannitol-20", nameTrade: "Mannitol 20%", nameAr: "", nameEn: "Mannitol 20%", form: "supplies", defaultDose: "20%", defaultFrequency: "حسب الحاجة" },
    { id: "mebo", nameTrade: "Mebo", nameAr: "", nameEn: "Mebo", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "meronem-1g", nameTrade: "Meronem 1g", nameAr: "", nameEn: "Meronem 1g", form: "vial", defaultDose: "1g", defaultFrequency: "1×1" },
    { id: "meronem-500mg", nameTrade: "Meronem 500mg", nameAr: "", nameEn: "Meronem 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "mesna-400mg", nameTrade: "Mesna 400mg", nameAr: "", nameEn: "Mesna 400mg", form: "ampule", defaultDose: "400mg", defaultFrequency: "1×1" },
    { id: "methergin", nameTrade: "Methergin", nameAr: "", nameEn: "Methergin", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "methoprim-480mg", nameTrade: "Methoprim 480mg", nameAr: "", nameEn: "Methoprim 480mg", form: "tablet", defaultDose: "480mg", defaultFrequency: "1×1" },
    { id: "methotrexate-50mg", nameTrade: "Methotrexate 50mg", nameAr: "", nameEn: "Methotrexate 50mg", form: "vial", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "methyldopa-250mg", nameTrade: "Methyldopa 250mg", nameAr: "", nameEn: "Methyldopa 250mg", form: "tablet", defaultDose: "250mg", defaultFrequency: "1×1" },
    { id: "metoprolol-100mg", nameTrade: "Metoprolol 100mg", nameAr: "", nameEn: "Metoprolol 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "metoprolol-50mg", nameTrade: "Metoprolol 50mg", nameAr: "", nameEn: "Metoprolol 50mg", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "metoprolol", nameTrade: "Metoprolol", nameAr: "", nameEn: "Metoprolol", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "mgso4", nameTrade: "MgSO4", nameAr: "", nameEn: "MgSO4", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "mobic-7-5mg", nameTrade: "Mobic 7.5mg", nameAr: "", nameEn: "Mobic 7.5mg", form: "tablet", defaultDose: "7.5mg", defaultFrequency: "1×1" },
    { id: "moxifloxacin-400mg", nameTrade: "Moxifloxacin 400mg", nameAr: "", nameEn: "Moxifloxacin 400mg", form: "tablet", defaultDose: "400mg", defaultFrequency: "1×1" },
    { id: "mtx-50mg", nameTrade: "MTX 50mg", nameAr: "", nameEn: "MTX 50mg", form: "ampule", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "n-s-100ml", nameTrade: "N/S 100ml", nameAr: "", nameEn: "N/S 100ml", form: "supplies", defaultDose: "100ml", defaultFrequency: "حسب الحاجة" },
    { id: "n-s-500ml", nameTrade: "N/S 500ml", nameAr: "", nameEn: "N/S 500ml", form: "supplies", defaultDose: "500ml", defaultFrequency: "حسب الحاجة" },
    { id: "neostigmine-2-5mg", nameTrade: "Neostigmine 2.5mg", nameAr: "", nameEn: "Neostigmine 2.5mg", form: "ampule", defaultDose: "2.5mg", defaultFrequency: "1×1" },
    { id: "ng-tube", nameTrade: "NG Tube", nameAr: "", nameEn: "NG Tube", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "nimodipine-30mg", nameTrade: "Nimodipine 30mg", nameAr: "", nameEn: "Nimodipine 30mg", form: "tablet", defaultDose: "30mg", defaultFrequency: "1×1" },
    { id: "noradrenaline", nameTrade: "Noradrenaline", nameAr: "", nameEn: "Noradrenaline", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "nystacort", nameTrade: "Nystacort", nameAr: "", nameEn: "Nystacort", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "nystatin", nameTrade: "Nystatin", nameAr: "", nameEn: "Nystatin", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1×1" },
    { id: "octreotide", nameTrade: "Octreotide", nameAr: "", nameEn: "Octreotide", form: "ampule", defaultDose: "", defaultFrequency: "1×1" },
    { id: "olan-5mg", nameTrade: "Olan 5mg", nameAr: "", nameEn: "Olan 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "omeprazole-20mg", nameTrade: "Omeprazole 20mg", nameAr: "", nameEn: "Omeprazole 20mg", form: "tablet", defaultDose: "20mg", defaultFrequency: "1×1" },
    { id: "omeprazole-40mg", nameTrade: "Omeprazole 40mg", nameAr: "", nameEn: "Omeprazole 40mg", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "omeprazole-40mg-1", nameTrade: "Omeprazole 40mg", nameAr: "", nameEn: "Omeprazole 40mg", form: "vial", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "one-alpha-1mg", nameTrade: "One alpha 1mg", nameAr: "", nameEn: "One alpha 1mg", form: "tablet", defaultDose: "1mg", defaultFrequency: "1×1" },
    { id: "pantaprazole-40mg", nameTrade: "Pantaprazole 40mg", nameAr: "", nameEn: "Pantaprazole 40mg", form: "tablet", defaultDose: "40mg", defaultFrequency: "1×1" },
    { id: "paracetamol-1g", nameTrade: "Paracetamol 1g", nameAr: "", nameEn: "Paracetamol 1g", form: "vial", defaultDose: "1g", defaultFrequency: "1×1" },
    { id: "paracetamol-500mg", nameTrade: "Paracetamol 500mg", nameAr: "", nameEn: "Paracetamol 500mg", form: "tablet", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "phenytoin-250mg", nameTrade: "phenytoin 250mg", nameAr: "", nameEn: "phenytoin 250mg", form: "ampule", defaultDose: "250mg", defaultFrequency: "1×1" },
    { id: "pitocin-10units", nameTrade: "Pitocin 10units", nameAr: "", nameEn: "Pitocin 10units", form: "ampule", defaultDose: "10units", defaultFrequency: "1×1" },
    { id: "plasil-10mg", nameTrade: "Plasil 10mg", nameAr: "", nameEn: "Plasil 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "plasil-10mg-1", nameTrade: "Plasil 10mg", nameAr: "", nameEn: "Plasil 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "plavix-75mg", nameTrade: "Plavix 75mg", nameAr: "", nameEn: "Plavix 75mg", form: "tablet", defaultDose: "75mg", defaultFrequency: "1×1" },
    { id: "prednisolone-5mg", nameTrade: "Prednisolone 5mg", nameAr: "", nameEn: "Prednisolone 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "pregabalin-75mg", nameTrade: "Pregabalin 75mg", nameAr: "", nameEn: "Pregabalin 75mg", form: "tablet", defaultDose: "75mg", defaultFrequency: "1×1" },
    { id: "propofol-1", nameTrade: "Propofol 1%", nameAr: "", nameEn: "Propofol 1%", form: "ampule", defaultDose: "1%", defaultFrequency: "1×1" },
    { id: "protamine-10mg", nameTrade: "Protamine 10mg", nameAr: "", nameEn: "Protamine 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "pulmicort-0-5-mg", nameTrade: "Pulmicort 0.5 mg", nameAr: "", nameEn: "Pulmicort 0.5 mg", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "qantavir-0-5mglet", nameTrade: "Qantavir 0.5mglet", nameAr: "", nameEn: "Qantavir 0.5mglet", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1×1" },
    { id: "redepra-30mg", nameTrade: "Redepra 30mg", nameAr: "", nameEn: "Redepra 30mg", form: "tablet", defaultDose: "30mg", defaultFrequency: "1×1" },
    { id: "ringer-lactate", nameTrade: "Ringer Lactate", nameAr: "", nameEn: "Ringer Lactate", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "ringer-sol", nameTrade: "Ringer sol", nameAr: "", nameEn: "Ringer sol", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "risperidone-2mg", nameTrade: "Risperidone 2mg", nameAr: "", nameEn: "Risperidone 2mg", form: "tablet", defaultDose: "2mg", defaultFrequency: "1×1" },
    { id: "rivotrel-0-5mg", nameTrade: "Rivotrel 0.5mg", nameAr: "", nameEn: "Rivotrel 0.5mg", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1×1" },
    { id: "scolin-100mg", nameTrade: "Scolin 100mg", nameAr: "", nameEn: "Scolin 100mg", form: "ampule", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "sevelamer-800mg", nameTrade: "Sevelamer 800mg", nameAr: "", nameEn: "Sevelamer 800mg", form: "tablet", defaultDose: "800mg", defaultFrequency: "1×1" },
    { id: "sinemet", nameTrade: "Sinemet", nameAr: "", nameEn: "Sinemet", form: "tablet", defaultDose: "", defaultFrequency: "1×1" },
    { id: "singular-10mg", nameTrade: "Singular 10mg", nameAr: "", nameEn: "Singular 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "sitagliptin-100mg", nameTrade: "Sitagliptin 100mg", nameAr: "", nameEn: "Sitagliptin 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "solumedrol-500mg", nameTrade: "Solumedrol 500mg", nameAr: "", nameEn: "Solumedrol 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "solvodin-4mg-5ml", nameTrade: "Solvodin 4mg/5ml", nameAr: "", nameEn: "Solvodin 4mg/5ml", form: "syrup-and-oral-drop", defaultDose: "4mg", defaultFrequency: "1×1" },
    { id: "spironolactone-100mg", nameTrade: "spironolactone 100mg", nameAr: "", nameEn: "spironolactone 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "spironolactone-25mg", nameTrade: "spironolactone 25mg", nameAr: "", nameEn: "spironolactone 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "stugeron-25mg", nameTrade: "Stugeron 25mg", nameAr: "", nameEn: "Stugeron 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "survanta-25mg", nameTrade: "Survanta 25mg", nameAr: "", nameEn: "Survanta 25mg", form: "vial", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "symbicort", nameTrade: "Symbicort", nameAr: "", nameEn: "Symbicort", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-10cc", nameTrade: "Syringe 10cc", nameAr: "", nameEn: "Syringe 10cc", form: "supplies", defaultDose: "10cc", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-20cc", nameTrade: "Syringe 20cc", nameAr: "", nameEn: "Syringe 20cc", form: "supplies", defaultDose: "20cc", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-50cc", nameTrade: "Syringe 50cc", nameAr: "", nameEn: "Syringe 50cc", form: "supplies", defaultDose: "50cc", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-50cc-feeding", nameTrade: "Syringe 50cc feeding", nameAr: "", nameEn: "Syringe 50cc feeding", form: "supplies", defaultDose: "50cc", defaultFrequency: "حسب الحاجة" },
    { id: "tazocin", nameTrade: "Tazocin", nameAr: "", nameEn: "Tazocin", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "tegretol-200mg", nameTrade: "Tegretol 200mg", nameAr: "", nameEn: "Tegretol 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "tetrabenzine-12-5mg", nameTrade: "Tetrabenzine 12.5mg", nameAr: "", nameEn: "Tetrabenzine 12.5mg", form: "tablet", defaultDose: "12.5mg", defaultFrequency: "1×1" },
    { id: "thyroxine-100mg", nameTrade: "Thyroxine 100mg", nameAr: "", nameEn: "Thyroxine 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1×1" },
    { id: "thyroxine-50mg", nameTrade: "Thyroxine 50mg", nameAr: "", nameEn: "Thyroxine 50mg", form: "tablet", defaultDose: "50mg", defaultFrequency: "1×1" },
    { id: "tigecycline-500mg", nameTrade: "Tigecycline 500mg", nameAr: "", nameEn: "Tigecycline 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1×1" },
    { id: "tpn-i-v-infusion", nameTrade: "TPN I.V. infusion", nameAr: "", nameEn: "TPN I.V. infusion", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "tryptizole-25mg", nameTrade: "Tryptizole 25mg", nameAr: "", nameEn: "Tryptizole 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "tysabri-300mg", nameTrade: "Tysabri 300mg", nameAr: "", nameEn: "Tysabri 300mg", form: "vial", defaultDose: "300mg", defaultFrequency: "1×1" },
    { id: "urine-bag", nameTrade: "Urine bag", nameAr: "", nameEn: "Urine bag", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "urso-300mg", nameTrade: "Urso 300mg", nameAr: "", nameEn: "Urso 300mg", form: "tablet", defaultDose: "300mg", defaultFrequency: "1×1" },
    { id: "valium-10mg", nameTrade: "Valium 10mg", nameAr: "", nameEn: "Valium 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "valium-5mg", nameTrade: "Valium 5mg", nameAr: "", nameEn: "Valium 5mg", form: "tablet", defaultDose: "5mg", defaultFrequency: "1×1" },
    { id: "vancomycin-1g", nameTrade: "Vancomycin 1g", nameAr: "", nameEn: "Vancomycin 1g", form: "vial", defaultDose: "1g", defaultFrequency: "1×1" },
    { id: "vancomycin-500-mg", nameTrade: "Vancomycin 500 mg", nameAr: "", nameEn: "Vancomycin 500 mg", form: "vial", defaultDose: "", defaultFrequency: "1×1" },
    { id: "vastarel-35mg-mr", nameTrade: "Vastarel 35mg MR", nameAr: "", nameEn: "Vastarel 35mg MR", form: "tablet", defaultDose: "35mg", defaultFrequency: "1×1" },
    { id: "venofer-2", nameTrade: "Venofer 2%", nameAr: "", nameEn: "Venofer 2%", form: "ampule", defaultDose: "2%", defaultFrequency: "1×1" },
    { id: "ventolin", nameTrade: "Ventolin", nameAr: "", nameEn: "Ventolin", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "vit-k-10mg", nameTrade: "Vit. K 10mg", nameAr: "", nameEn: "Vit. K 10mg", form: "ampule", defaultDose: "10mg", defaultFrequency: "1×1" },
    { id: "vit-k-2mg", nameTrade: "Vit. K 2mg", nameAr: "", nameEn: "Vit. K 2mg", form: "ampule", defaultDose: "2mg", defaultFrequency: "1×1" },
    { id: "voltarin-25mg", nameTrade: "Voltarin 25mg", nameAr: "", nameEn: "Voltarin 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1×1" },
    { id: "voltarin-75mg", nameTrade: "Voltarin 75mg", nameAr: "", nameEn: "Voltarin 75mg", form: "ampule", defaultDose: "75mg", defaultFrequency: "1×1" },
    { id: "voriconazole-200mg", nameTrade: "Voriconazole 200mg", nameAr: "", nameEn: "Voriconazole 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "voriconazole-200mg-1", nameTrade: "Voriconazole 200mg", nameAr: "", nameEn: "Voriconazole 200mg", form: "vial", defaultDose: "200mg", defaultFrequency: "1×1" },
    { id: "xylocaine-2", nameTrade: "Xylocaine 2%", nameAr: "", nameEn: "Xylocaine 2%", form: "ampule", defaultDose: "2%", defaultFrequency: "1×1" },
    { id: "xylocaine-2-1", nameTrade: "Xylocaine 2%", nameAr: "", nameEn: "Xylocaine 2%", form: "solution", defaultDose: "2%", defaultFrequency: "حسب الحاجة" },
    { id: "xylocaine-5", nameTrade: "Xylocaine 5%", nameAr: "", nameEn: "Xylocaine 5%", form: "solution", defaultDose: "5%", defaultFrequency: "حسب الحاجة" },
    { id: "zinc-oxide", nameTrade: "Zinc oxide", nameAr: "", nameEn: "Zinc oxide", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "zofranoule-8mg", nameTrade: "Zofranoule 8mg", nameAr: "", nameEn: "Zofranoule 8mg", form: "ampule", defaultDose: "8mg", defaultFrequency: "1×1" },
    { id: "zovirax-250mg", nameTrade: "Zovirax 250mg", nameAr: "", nameEn: "Zovirax 250mg", form: "vial", defaultDose: "250mg", defaultFrequency: "1×1" },
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
  //   v5 = replaced entire catalog with user's full 235-med list
  //        (vials, ampules, tablets, PFS, syrups, solutions,
  //         supplies + fluids). All old meds moved to DISABLED list.
  const DEFAULT_MEDICATIONS_VERSION = 5;

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
    FLUID_IDS,
    FORM_ORDER,
    FORM_ICONS,
    DEFAULT_MEDICATIONS,
    DEFAULT_MEDICATIONS_VERSION,
    DISABLED_MEDICATIONS,
    NON_DAILY_INTERVALS,
    getFrequencyInterval,
    isMedDueToday
  };
})(window);
