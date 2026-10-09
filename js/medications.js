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
  const DISABLED_MEDICATIONS = [];
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
    { id: "acetylase-50mg-vial", nameTrade: "Acetylase 50mg/Vial", nameAr: "", nameEn: "Acetylase 50mg/Vial", form: "vial", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "actemra-vial-200mg", nameTrade: "Actemra vial 200mg", nameAr: "", nameEn: "Actemra vial 200mg", form: "vial", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "acupan-amp", nameTrade: "Acupan amp", nameAr: "", nameEn: "Acupan amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "adenosine-6mg-amp", nameTrade: "Adenosine 6mg Amp", nameAr: "", nameEn: "Adenosine 6mg Amp", form: "ampule", defaultDose: "6mg", defaultFrequency: "1x1" },
    { id: "adrenaline-amp-1mg", nameTrade: "Adrenaline amp 1mg", nameAr: "", nameEn: "Adrenaline amp 1mg", form: "ampule", defaultDose: "1mg", defaultFrequency: "1x1" },
    { id: "allermine-10mg-amp", nameTrade: "Allermine 10mg Amp", nameAr: "", nameEn: "Allermine 10mg Amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "amaryl-2mg-tab", nameTrade: "Amaryl 2mg Tab", nameAr: "", nameEn: "Amaryl 2mg Tab", form: "tablet", defaultDose: "2mg", defaultFrequency: "1x1" },
    { id: "ambisome-50mg-vial", nameTrade: "AmBisome 50mg vial", nameAr: "", nameEn: "AmBisome 50mg vial", form: "vial", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "ambrisantan-tablet-10mg", nameTrade: "Ambrisantan tablet 10mg", nameAr: "", nameEn: "Ambrisantan tablet 10mg", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "amikacin-500mg-vial", nameTrade: "Amikacin 500mg Vial", nameAr: "", nameEn: "Amikacin 500mg Vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "aminophylline-250mg-amp", nameTrade: "Aminophylline 250mg amp", nameAr: "", nameEn: "Aminophylline 250mg amp", form: "ampule", defaultDose: "250mg", defaultFrequency: "1x1" },
    { id: "amitriptyline-25mg-tab", nameTrade: "Amitriptyline 25mg tab", nameAr: "", nameEn: "Amitriptyline 25mg tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "amlodipine-5mg-tab", nameTrade: "Amlodipine 5mg tab", nameAr: "", nameEn: "Amlodipine 5mg tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "amoxil-250mg-5ml-susp", nameTrade: "Amoxil 250mg/5ml Susp", nameAr: "", nameEn: "Amoxil 250mg/5ml Susp", form: "syrup-and-oral-drop", defaultDose: "250mg", defaultFrequency: "1x1" },
    { id: "amoxil-500mg-cap", nameTrade: "Amoxil 500mg Cap", nameAr: "", nameEn: "Amoxil 500mg Cap", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "amoxil-500mg-vial", nameTrade: "Amoxil 500mg vial", nameAr: "", nameEn: "Amoxil 500mg vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "anafranil-25mg-tab", nameTrade: "Anafranil 25mg tab", nameAr: "", nameEn: "Anafranil 25mg tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "angesid-0-5mg-tab", nameTrade: "Angesid 0.5mg Tab", nameAr: "", nameEn: "Angesid 0.5mg Tab", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1x1" },
    { id: "angesid-10mg-ampoule", nameTrade: "Angesid 10mg ampoule", nameAr: "", nameEn: "Angesid 10mg ampoule", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "angesid-25mg-ampoule", nameTrade: "Angesid 25mg ampoule", nameAr: "", nameEn: "Angesid 25mg ampoule", form: "ampule", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "angisar-plus-tab", nameTrade: "Angisar plus tab", nameAr: "", nameEn: "Angisar plus tab", form: "tablet", defaultDose: "", defaultFrequency: "1x1" },
    { id: "anti-d-1500-iu-inj", nameTrade: "Anti D 1500 IU Inj", nameAr: "", nameEn: "Anti D 1500 IU Inj", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "apixaban-5mg-tab", nameTrade: "Apixaban 5mg tab", nameAr: "", nameEn: "Apixaban 5mg tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "apresoline-20mg-amp", nameTrade: "Apresoline 20mg Amp", nameAr: "", nameEn: "Apresoline 20mg Amp", form: "ampule", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "aransip-20mcg-pfs", nameTrade: "Aransip 20mcg PFS", nameAr: "", nameEn: "Aransip 20mcg PFS", form: "prefilled-syringe", defaultDose: "20mcg", defaultFrequency: "1x1" },
    { id: "aransip-40mcg-pfs", nameTrade: "Aransip 40mcg PFS", nameAr: "", nameEn: "Aransip 40mcg PFS", form: "prefilled-syringe", defaultDose: "40mcg", defaultFrequency: "1x1" },
    { id: "aspirin-100mg-tab", nameTrade: "Aspirin 100mg Tab", nameAr: "", nameEn: "Aspirin 100mg Tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "atropine-1mg-amp", nameTrade: "Atropine 1mg amp", nameAr: "", nameEn: "Atropine 1mg amp", form: "ampule", defaultDose: "1mg", defaultFrequency: "1x1" },
    { id: "augmentin-312-5mg-susp", nameTrade: "Augmentin 312.5mg Susp", nameAr: "", nameEn: "Augmentin 312.5mg Susp", form: "syrup-and-oral-drop", defaultDose: "312.5mg", defaultFrequency: "1x1" },
    { id: "augmentin-625mg-tablet", nameTrade: "Augmentin 625mg tablet", nameAr: "", nameEn: "Augmentin 625mg tablet", form: "tablet", defaultDose: "625mg", defaultFrequency: "1x1" },
    { id: "avas-20mg-tab", nameTrade: "Avas 20mg Tab", nameAr: "", nameEn: "Avas 20mg Tab", form: "tablet", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "avas-40mg-tab", nameTrade: "Avas 40mg Tab", nameAr: "", nameEn: "Avas 40mg Tab", form: "tablet", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "azithromycin-500mg-tab", nameTrade: "Azithromycin 500mg tab", nameAr: "", nameEn: "Azithromycin 500mg tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "blood-giving-set", nameTrade: "Blood giving set", nameAr: "", nameEn: "Blood giving set", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "bosentan-125mg-tab", nameTrade: "Bosentan 125mg tab", nameAr: "", nameEn: "Bosentan 125mg tab", form: "tablet", defaultDose: "125mg", defaultFrequency: "1x1" },
    { id: "brilinta-90mg-tab", nameTrade: "Brilinta 90mg tab", nameAr: "", nameEn: "Brilinta 90mg tab", form: "tablet", defaultDose: "90mg", defaultFrequency: "1x1" },
    { id: "brufen-200mg-tab", nameTrade: "Brufen 200mg Tab", nameAr: "", nameEn: "Brufen 200mg Tab", form: "tablet", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "buscopan-10mg-amp", nameTrade: "Buscopan 10mg amp", nameAr: "", nameEn: "Buscopan 10mg amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "buscopan-10mg-tab", nameTrade: "Buscopan 10mg Tab", nameAr: "", nameEn: "Buscopan 10mg Tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "caffeine-amp", nameTrade: "Caffeine amp", nameAr: "", nameEn: "Caffeine amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "calcium-500mg-tab", nameTrade: "Calcium 500mg Tab", nameAr: "", nameEn: "Calcium 500mg Tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "calcium-amp", nameTrade: "Calcium amp", nameAr: "", nameEn: "Calcium amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "candesartan-8mg-tab", nameTrade: "Candesartan 8mg tab", nameAr: "", nameEn: "Candesartan 8mg tab", form: "tablet", defaultDose: "8mg", defaultFrequency: "1x1" },
    { id: "capoten-25mg-tab", nameTrade: "Capoten 25mg Tab", nameAr: "", nameEn: "Capoten 25mg Tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "carvedilol-6-25mg-tab", nameTrade: "Carvedilol 6.25mg Tab", nameAr: "", nameEn: "Carvedilol 6.25mg Tab", form: "tablet", defaultDose: "6.25mg", defaultFrequency: "1x1" },
    { id: "caspofungin-50mg-vial", nameTrade: "Caspofungin 50mg vial", nameAr: "", nameEn: "Caspofungin 50mg vial", form: "vial", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "cefotaxime-1g-vial", nameTrade: "Cefotaxime 1g vial", nameAr: "", nameEn: "Cefotaxime 1g vial", form: "vial", defaultDose: "1g", defaultFrequency: "1x1" },
    { id: "ceftazidime-1g-vial", nameTrade: "Ceftazidime 1g vial", nameAr: "", nameEn: "Ceftazidime 1g vial", form: "vial", defaultDose: "1g", defaultFrequency: "1x1" },
    { id: "ceftrixone-1g-vial", nameTrade: "Ceftrixone 1g vial", nameAr: "", nameEn: "Ceftrixone 1g vial", form: "vial", defaultDose: "1g", defaultFrequency: "1x1" },
    { id: "ciprodar-200mg-vial", nameTrade: "Ciprodar 200mg vial", nameAr: "", nameEn: "Ciprodar 200mg vial", form: "vial", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "ciprodar-500mg-tab", nameTrade: "Ciprodar 500mg Tab", nameAr: "", nameEn: "Ciprodar 500mg Tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "clexane-syringe-4000-iu", nameTrade: "Clexane syringe 4000 IU", nameAr: "", nameEn: "Clexane syringe 4000 IU", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "clexane-syringe-6000-iu", nameTrade: "Clexane syringe 6000 IU", nameAr: "", nameEn: "Clexane syringe 6000 IU", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "colchicine-0-5mg-tab", nameTrade: "Colchicine 0.5mg tab", nameAr: "", nameEn: "Colchicine 0.5mg tab", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1x1" },
    { id: "colistin-1000000-iu-vial", nameTrade: "Colistin 1000000 IU vial", nameAr: "", nameEn: "Colistin 1000000 IU vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "concor-5mg-tab", nameTrade: "Concor 5mg tab", nameAr: "", nameEn: "Concor 5mg tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "cordarone-150mg-amp", nameTrade: "Cordarone 150mg amp", nameAr: "", nameEn: "Cordarone 150mg amp", form: "ampule", defaultDose: "150mg", defaultFrequency: "1x1" },
    { id: "cordarone-200mg-tab", nameTrade: "Cordarone 200mg tab", nameAr: "", nameEn: "Cordarone 200mg tab", form: "tablet", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "crestor-20mg-tab", nameTrade: "Crestor 20mg tab", nameAr: "", nameEn: "Crestor 20mg tab", form: "tablet", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "crestor-40mg-tab", nameTrade: "Crestor 40mg tab", nameAr: "", nameEn: "Crestor 40mg tab", form: "tablet", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "cyclocapron-500mg-amp", nameTrade: "Cyclocapron 500mg Amp", nameAr: "", nameEn: "Cyclocapron 500mg Amp", form: "ampule", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "daonil-5mg-tab", nameTrade: "Daonil 5mg Tab", nameAr: "", nameEn: "Daonil 5mg Tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "decadrone-8mg-amp", nameTrade: "Decadrone 8mg Amp", nameAr: "", nameEn: "Decadrone 8mg Amp", form: "ampule", defaultDose: "8mg", defaultFrequency: "1x1" },
    { id: "depakine-200mg-tab", nameTrade: "Depakine 200mg tab", nameAr: "", nameEn: "Depakine 200mg tab", form: "tablet", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "depomedrol-80mg-vial", nameTrade: "Depomedrol 80mg Vial", nameAr: "", nameEn: "Depomedrol 80mg Vial", form: "vial", defaultDose: "80mg", defaultFrequency: "1x1" },
    { id: "digoxin-250mcg-tab", nameTrade: "Digoxin 250mcg Tab", nameAr: "", nameEn: "Digoxin 250mcg Tab", form: "tablet", defaultDose: "250mcg", defaultFrequency: "1x1" },
    { id: "digoxin-amp", nameTrade: "digoxin amp", nameAr: "", nameEn: "digoxin amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "diltiazem-60mg-tab", nameTrade: "Diltiazem 60mg tab", nameAr: "", nameEn: "Diltiazem 60mg tab", form: "tablet", defaultDose: "60mg", defaultFrequency: "1x1" },
    { id: "dobutamine-vial-250mg", nameTrade: "Dobutamine vial 250mg", nameAr: "", nameEn: "Dobutamine vial 250mg", form: "vial", defaultDose: "250mg", defaultFrequency: "1x1" },
    { id: "dopamine-200mg-amp", nameTrade: "Dopamine 200mg Amp", nameAr: "", nameEn: "Dopamine 200mg Amp", form: "ampule", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "doxycycline-100mg-cap", nameTrade: "Doxycycline 100mg cap", nameAr: "", nameEn: "Doxycycline 100mg cap", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "dusptalin-135mg-tab", nameTrade: "Dusptalin 135mg Tab", nameAr: "", nameEn: "Dusptalin 135mg Tab", form: "tablet", defaultDose: "135mg", defaultFrequency: "1x1" },
    { id: "ebixa-10mg-tab", nameTrade: "Ebixa 10mg Tab", nameAr: "", nameEn: "Ebixa 10mg Tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "empadil-10mg-tab", nameTrade: "Empadil 10mg tab", nameAr: "", nameEn: "Empadil 10mg tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "endoxan-500mg-vial", nameTrade: "Endoxan 500mg vial", nameAr: "", nameEn: "Endoxan 500mg vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "entero-stop-tab", nameTrade: "Entero-stop tab", nameAr: "", nameEn: "Entero-stop tab", form: "tablet", defaultDose: "", defaultFrequency: "1x1" },
    { id: "entersto-50mg-tab", nameTrade: "Entersto 50mg tab", nameAr: "", nameEn: "Entersto 50mg tab", form: "tablet", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "entresto-100mg-tab", nameTrade: "Entresto 100mg tab", nameAr: "", nameEn: "Entresto 100mg tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "entresto-50mg-tab", nameTrade: "Entresto 50mg tab", nameAr: "", nameEn: "Entresto 50mg tab", form: "tablet", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "eplerenone-25mg-tab", nameTrade: "Eplerenone  25mg tab", nameAr: "", nameEn: "Eplerenone  25mg tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "escitalopram-10mg-tab", nameTrade: "Escitalopram 10mg tab", nameAr: "", nameEn: "Escitalopram 10mg tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "esmeron-50mg-amp", nameTrade: "Esmeron 50mg Amp", nameAr: "", nameEn: "Esmeron 50mg Amp", form: "ampule", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "esomprazole-40mg-vial", nameTrade: "Esomprazole 40mg vial", nameAr: "", nameEn: "Esomprazole 40mg vial", form: "vial", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "ferrofolic-cap", nameTrade: "Ferrofolic cap", nameAr: "", nameEn: "Ferrofolic cap", form: "tablet", defaultDose: "", defaultFrequency: "1x1" },
    { id: "ferrosam-tab-200mg", nameTrade: "Ferrosam tab 200mg", nameAr: "", nameEn: "Ferrosam tab 200mg", form: "tablet", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "flagyl-500mg-tab", nameTrade: "Flagyl 500mg Tab", nameAr: "", nameEn: "Flagyl 500mg Tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "flagyl-500mg-vial", nameTrade: "Flagyl 500mg Vial", nameAr: "", nameEn: "Flagyl 500mg Vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "flamazine-1-cream", nameTrade: "Flamazine 1% Cream", nameAr: "", nameEn: "Flamazine 1% Cream", form: "solution", defaultDose: "1%", defaultFrequency: "حسب الحاجة" },
    { id: "flucloxacillin-500mg-vial", nameTrade: "Flucloxacillin 500mg vial", nameAr: "", nameEn: "Flucloxacillin 500mg vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "fluconazole-150mg-cap", nameTrade: "Fluconazole 150mg cap", nameAr: "", nameEn: "Fluconazole 150mg cap", form: "tablet", defaultDose: "150mg", defaultFrequency: "1x1" },
    { id: "fluoxetine-20mg-cap", nameTrade: "Fluoxetine 20mg cap", nameAr: "", nameEn: "Fluoxetine 20mg cap", form: "tablet", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "folic-acid-5mg-tab", nameTrade: "Folic acid 5mg tab", nameAr: "", nameEn: "Folic acid 5mg tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "foly-catheter", nameTrade: "Foly catheter", nameAr: "", nameEn: "Foly catheter", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "forxiga-10mg-tab", nameTrade: "Forxiga 10mg tab", nameAr: "", nameEn: "Forxiga 10mg tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "forxiga-5mg-tab", nameTrade: "Forxiga 5mg tab", nameAr: "", nameEn: "Forxiga 5mg tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "fucidin-cream", nameTrade: "Fucidin cream", nameAr: "", nameEn: "Fucidin cream", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "g-w-5-500ml", nameTrade: "G/W 5% 500ml", nameAr: "", nameEn: "G/W 5% 500ml", form: "supplies", defaultDose: "5%", defaultFrequency: "حسب الحاجة" },
    { id: "gabapentin-300mg-cap", nameTrade: "Gabapentin 300mg cap", nameAr: "", nameEn: "Gabapentin 300mg cap", form: "tablet", defaultDose: "300mg", defaultFrequency: "1x1" },
    { id: "garamycin-80mg-amp", nameTrade: "Garamycin 80mg Amp", nameAr: "", nameEn: "Garamycin 80mg Amp", form: "ampule", defaultDose: "80mg", defaultFrequency: "1x1" },
    { id: "gentamicin-drop", nameTrade: "gentamicin drop", nameAr: "", nameEn: "gentamicin drop", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "glucophage-500mg-tab", nameTrade: "Glucophage 500mg Tab", nameAr: "", nameEn: "Glucophage 500mg Tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "haloperidol-10mg-amp", nameTrade: "Haloperidol 10mg amp", nameAr: "", nameEn: "Haloperidol 10mg amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "heparin-vial", nameTrade: "Heparin vial", nameAr: "", nameEn: "Heparin vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "histadin-4mg-tablet", nameTrade: "Histadin 4mg tablet", nameAr: "", nameEn: "Histadin 4mg tablet", form: "tablet", defaultDose: "4mg", defaultFrequency: "1x1" },
    { id: "human-albumin-20-i-v", nameTrade: "Human albumin 20% I.V", nameAr: "", nameEn: "Human albumin 20% I.V", form: "tablet", defaultDose: "20%", defaultFrequency: "1x1" },
    { id: "hydralazine-amp", nameTrade: "Hydralazine amp", nameAr: "", nameEn: "Hydralazine amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "hydrocortisone-100mg-vial", nameTrade: "Hydrocortisone 100mg vial", nameAr: "", nameEn: "Hydrocortisone 100mg vial", form: "vial", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "hyoscine-20mg-amp", nameTrade: "Hyoscine 20mg Amp", nameAr: "", nameEn: "Hyoscine 20mg Amp", form: "ampule", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "hypertonic-glucose-vial", nameTrade: "Hypertonic glucose vial", nameAr: "", nameEn: "Hypertonic glucose vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "ibandronic-acid-150mg", nameTrade: "Ibandronic acid 150mg", nameAr: "", nameEn: "Ibandronic acid 150mg", form: "tablet", defaultDose: "150mg", defaultFrequency: "1x1" },
    { id: "inderal-40mg-tab", nameTrade: "Inderal 40mg Tab", nameAr: "", nameEn: "Inderal 40mg Tab", form: "tablet", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "insulin-lente-vial", nameTrade: "Insulin lente vial", nameAr: "", nameEn: "Insulin lente vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "insulin-mixtard-vial", nameTrade: "Insulin mixtard vial", nameAr: "", nameEn: "Insulin mixtard vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "insulin-soluble-vial", nameTrade: "Insulin soluble vial", nameAr: "", nameEn: "Insulin soluble vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "isoptin-5mg-amp", nameTrade: "Isoptin 5mg Amp", nameAr: "", nameEn: "Isoptin 5mg Amp", form: "ampule", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "isordil-10mg-tab", nameTrade: "Isordil 10mg tab", nameAr: "", nameEn: "Isordil 10mg tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "iv-set", nameTrade: "IV set", nameAr: "", nameEn: "IV set", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "ivig-vial", nameTrade: "IVIG vial", nameAr: "", nameEn: "IVIG vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "kcl-15-amp", nameTrade: "KCl 15% amp", nameAr: "", nameEn: "KCl 15% amp", form: "ampule", defaultDose: "15%", defaultFrequency: "1x1" },
    { id: "keflex-500mg-cap", nameTrade: "Keflex 500mg cap", nameAr: "", nameEn: "Keflex 500mg cap", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "kemadrin-5mg-tab", nameTrade: "Kemadrin 5mg Tab", nameAr: "", nameEn: "Kemadrin 5mg Tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "keppra-1000mg-tab", nameTrade: "Keppra 1000mg tab", nameAr: "", nameEn: "Keppra 1000mg tab", form: "tablet", defaultDose: "1000mg", defaultFrequency: "1x1" },
    { id: "keppra-500mg-tab", nameTrade: "Keppra 500mg tab", nameAr: "", nameEn: "Keppra 500mg tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "keppra-vial-100mg-ml", nameTrade: "Keppra vial 100mg/ml", nameAr: "", nameEn: "Keppra vial 100mg/ml", form: "vial", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "ketamine-500mg-vial", nameTrade: "Ketamine 500mg Vial", nameAr: "", nameEn: "Ketamine 500mg Vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "ketorolac-30mg-amp", nameTrade: "Ketorolac 30mg amp", nameAr: "", nameEn: "Ketorolac 30mg amp", form: "ampule", defaultDose: "30mg", defaultFrequency: "1x1" },
    { id: "lacosmide-100mg-tab", nameTrade: "Lacosmide 100mg tab", nameAr: "", nameEn: "Lacosmide 100mg tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "lactulose-syp", nameTrade: "Lactulose Syp", nameAr: "", nameEn: "Lactulose Syp", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1x1" },
    { id: "largactil-100mg-tab", nameTrade: "Largactil 100mg Tab", nameAr: "", nameEn: "Largactil 100mg Tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "largactil-50mg-amp", nameTrade: "Largactil 50mg Amp", nameAr: "", nameEn: "Largactil 50mg Amp", form: "ampule", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "lasix-20mg-amp", nameTrade: "Lasix 20mg Amp", nameAr: "", nameEn: "Lasix 20mg Amp", form: "ampule", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "lasix-40mg-tab", nameTrade: "Lasix 40mg Tab", nameAr: "", nameEn: "Lasix 40mg Tab", form: "tablet", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "laxadyl-supp", nameTrade: "Laxadyl supp", nameAr: "", nameEn: "Laxadyl supp", form: "suppository", defaultDose: "", defaultFrequency: "1x1" },
    { id: "librium-5mg-tab", nameTrade: "Librium 5mg Tab", nameAr: "", nameEn: "Librium 5mg Tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "lidocaine-amp", nameTrade: "Lidocaine amp", nameAr: "", nameEn: "Lidocaine amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "lidocaine-oint", nameTrade: "Lidocaine oint", nameAr: "", nameEn: "Lidocaine oint", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "lisinopril-10mg-tab", nameTrade: "Lisinopril 10mg tab", nameAr: "", nameEn: "Lisinopril 10mg tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "lorazepam-2mg-tab", nameTrade: "Lorazepam 2mg tab", nameAr: "", nameEn: "Lorazepam 2mg tab", form: "tablet", defaultDose: "2mg", defaultFrequency: "1x1" },
    { id: "losartan-50mg-tab", nameTrade: "Losartan 50mg Tab", nameAr: "", nameEn: "Losartan 50mg Tab", form: "tablet", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "luminal-200mg-amp", nameTrade: "Luminal 200mg Amp", nameAr: "", nameEn: "Luminal 200mg Amp", form: "ampule", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "mannitol-20", nameTrade: "Mannitol 20%", nameAr: "", nameEn: "Mannitol 20%", form: "supplies", defaultDose: "20%", defaultFrequency: "حسب الحاجة" },
    { id: "mebo-oint", nameTrade: "Mebo oint", nameAr: "", nameEn: "Mebo oint", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "meronem-1g-vial", nameTrade: "Meronem 1g Vial", nameAr: "", nameEn: "Meronem 1g Vial", form: "vial", defaultDose: "1g", defaultFrequency: "1x1" },
    { id: "meronem-500mg-vial", nameTrade: "Meronem 500mg Vial", nameAr: "", nameEn: "Meronem 500mg Vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "mesna-400mg-amp", nameTrade: "Mesna 400mg amp", nameAr: "", nameEn: "Mesna 400mg amp", form: "ampule", defaultDose: "400mg", defaultFrequency: "1x1" },
    { id: "methergin-amp", nameTrade: "Methergin amp", nameAr: "", nameEn: "Methergin amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "methoprim-480mg-tab", nameTrade: "Methoprim 480mg Tab", nameAr: "", nameEn: "Methoprim 480mg Tab", form: "tablet", defaultDose: "480mg", defaultFrequency: "1x1" },
    { id: "methotrexate-50mg-vial", nameTrade: "Methotrexate 50mg vial", nameAr: "", nameEn: "Methotrexate 50mg vial", form: "vial", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "methyldopa-250mg-tab", nameTrade: "Methyldopa 250mg Tab", nameAr: "", nameEn: "Methyldopa 250mg Tab", form: "tablet", defaultDose: "250mg", defaultFrequency: "1x1" },
    { id: "metoprolol-100mg-tab", nameTrade: "Metoprolol 100mg tab", nameAr: "", nameEn: "Metoprolol 100mg tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "metoprolol-50mg-tab", nameTrade: "Metoprolol 50mg tab", nameAr: "", nameEn: "Metoprolol 50mg tab", form: "tablet", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "metoprolol-amp", nameTrade: "Metoprolol amp", nameAr: "", nameEn: "Metoprolol amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "mgso4-amp", nameTrade: "MgSO4 amp", nameAr: "", nameEn: "MgSO4 amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "mobic-7-5mg-tab", nameTrade: "Mobic 7.5mg Tab", nameAr: "", nameEn: "Mobic 7.5mg Tab", form: "tablet", defaultDose: "7.5mg", defaultFrequency: "1x1" },
    { id: "moxifloxacin-400mg-tab", nameTrade: "Moxifloxacin 400mg tab", nameAr: "", nameEn: "Moxifloxacin 400mg tab", form: "tablet", defaultDose: "400mg", defaultFrequency: "1x1" },
    { id: "mtx-50mg-amp", nameTrade: "MTX 50mg amp", nameAr: "", nameEn: "MTX 50mg amp", form: "ampule", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "n-s-100ml", nameTrade: "N/S 100ml", nameAr: "", nameEn: "N/S 100ml", form: "supplies", defaultDose: "100ml", defaultFrequency: "حسب الحاجة" },
    { id: "n-s-500ml", nameTrade: "N/S 500ml", nameAr: "", nameEn: "N/S 500ml", form: "supplies", defaultDose: "500ml", defaultFrequency: "حسب الحاجة" },
    { id: "neostigmine-2-5mg-amp", nameTrade: "Neostigmine 2.5mg Amp", nameAr: "", nameEn: "Neostigmine 2.5mg Amp", form: "ampule", defaultDose: "2.5mg", defaultFrequency: "1x1" },
    { id: "ng-tube", nameTrade: "NG Tube", nameAr: "", nameEn: "NG Tube", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "nimodipine-30mg-tab", nameTrade: "Nimodipine 30mg Tab", nameAr: "", nameEn: "Nimodipine 30mg Tab", form: "tablet", defaultDose: "30mg", defaultFrequency: "1x1" },
    { id: "noradrenaline-amp", nameTrade: "Noradrenaline amp", nameAr: "", nameEn: "Noradrenaline amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "nystacort-oint", nameTrade: "Nystacort Oint", nameAr: "", nameEn: "Nystacort Oint", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "nystatin-susp", nameTrade: "Nystatin Susp", nameAr: "", nameEn: "Nystatin Susp", form: "syrup-and-oral-drop", defaultDose: "", defaultFrequency: "1x1" },
    { id: "octreotide-amp", nameTrade: "Octreotide amp", nameAr: "", nameEn: "Octreotide amp", form: "ampule", defaultDose: "", defaultFrequency: "1x1" },
    { id: "olan-5mg-tab", nameTrade: "Olan 5mg tab", nameAr: "", nameEn: "Olan 5mg tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "omeprazole-20mg-cap", nameTrade: "Omeprazole 20mg cap", nameAr: "", nameEn: "Omeprazole 20mg cap", form: "tablet", defaultDose: "20mg", defaultFrequency: "1x1" },
    { id: "omeprazole-40mg-cap", nameTrade: "Omeprazole 40mg cap", nameAr: "", nameEn: "Omeprazole 40mg cap", form: "tablet", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "omeprazole-40mg-vial", nameTrade: "Omeprazole 40mg vial", nameAr: "", nameEn: "Omeprazole 40mg vial", form: "vial", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "one-alpha-1mg-cap", nameTrade: "One alpha 1mg cap", nameAr: "", nameEn: "One alpha 1mg cap", form: "tablet", defaultDose: "1mg", defaultFrequency: "1x1" },
    { id: "pantaprazole-40mg-cap", nameTrade: "Pantaprazole 40mg cap", nameAr: "", nameEn: "Pantaprazole 40mg cap", form: "tablet", defaultDose: "40mg", defaultFrequency: "1x1" },
    { id: "paracetamol-1g-vial", nameTrade: "Paracetamol 1g vial", nameAr: "", nameEn: "Paracetamol 1g vial", form: "vial", defaultDose: "1g", defaultFrequency: "1x1" },
    { id: "paracetamol-500mg-tab", nameTrade: "Paracetamol 500mg Tab", nameAr: "", nameEn: "Paracetamol 500mg Tab", form: "tablet", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "phenytoin-250mg-amp", nameTrade: "phenytoin 250mg amp", nameAr: "", nameEn: "phenytoin 250mg amp", form: "ampule", defaultDose: "250mg", defaultFrequency: "1x1" },
    { id: "pitocin-10units-amp", nameTrade: "Pitocin 10units Amp", nameAr: "", nameEn: "Pitocin 10units Amp", form: "ampule", defaultDose: "10units", defaultFrequency: "1x1" },
    { id: "plasil-10mg-amp", nameTrade: "Plasil 10mg Amp", nameAr: "", nameEn: "Plasil 10mg Amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "plasil-10mg-tab", nameTrade: "Plasil 10mg tab", nameAr: "", nameEn: "Plasil 10mg tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "plavix-75mg-tab", nameTrade: "Plavix 75mg tab", nameAr: "", nameEn: "Plavix 75mg tab", form: "tablet", defaultDose: "75mg", defaultFrequency: "1x1" },
    { id: "prednisolone-5mg-tab", nameTrade: "Prednisolone 5mg Tab", nameAr: "", nameEn: "Prednisolone 5mg Tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "pregabalin-75mg-cap", nameTrade: "Pregabalin 75mg cap", nameAr: "", nameEn: "Pregabalin 75mg cap", form: "tablet", defaultDose: "75mg", defaultFrequency: "1x1" },
    { id: "propofol-1-amp", nameTrade: "Propofol 1% amp", nameAr: "", nameEn: "Propofol 1% amp", form: "ampule", defaultDose: "1%", defaultFrequency: "1x1" },
    { id: "protamine-10mg-amp", nameTrade: "Protamine 10mg Amp", nameAr: "", nameEn: "Protamine 10mg Amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "pulmicort-0-5-mg-nebulizer", nameTrade: "Pulmicort 0.5 mg nebulizer", nameAr: "", nameEn: "Pulmicort 0.5 mg nebulizer", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "qantavir-0-5mg-tablet", nameTrade: "Qantavir 0.5mg tablet", nameAr: "", nameEn: "Qantavir 0.5mg tablet", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1x1" },
    { id: "redepra-30mg-tab", nameTrade: "Redepra 30mg Tab", nameAr: "", nameEn: "Redepra 30mg Tab", form: "tablet", defaultDose: "30mg", defaultFrequency: "1x1" },
    { id: "ringer-lactate", nameTrade: "Ringer Lactate", nameAr: "", nameEn: "Ringer Lactate", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "ringer-sol", nameTrade: "Ringer sol", nameAr: "", nameEn: "Ringer sol", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "risperidone-2mg-tab", nameTrade: "Risperidone 2mg tab", nameAr: "", nameEn: "Risperidone 2mg tab", form: "tablet", defaultDose: "2mg", defaultFrequency: "1x1" },
    { id: "rivotrel-0-5mg-tab", nameTrade: "Rivotrel 0.5mg Tab", nameAr: "", nameEn: "Rivotrel 0.5mg Tab", form: "tablet", defaultDose: "0.5mg", defaultFrequency: "1x1" },
    { id: "scolin-100mg-amp", nameTrade: "Scolin 100mg Amp", nameAr: "", nameEn: "Scolin 100mg Amp", form: "ampule", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "sevelamer-800mg-tab", nameTrade: "Sevelamer 800mg Tab", nameAr: "", nameEn: "Sevelamer 800mg Tab", form: "tablet", defaultDose: "800mg", defaultFrequency: "1x1" },
    { id: "sinemet-tab", nameTrade: "Sinemet Tab", nameAr: "", nameEn: "Sinemet Tab", form: "tablet", defaultDose: "", defaultFrequency: "1x1" },
    { id: "singular-10mg-tab", nameTrade: "Singular 10mg Tab", nameAr: "", nameEn: "Singular 10mg Tab", form: "tablet", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "sitagliptin-100mg-tab", nameTrade: "Sitagliptin 100mg tab", nameAr: "", nameEn: "Sitagliptin 100mg tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "solumedrol-500mg-vial", nameTrade: "Solumedrol 500mg vial", nameAr: "", nameEn: "Solumedrol 500mg vial", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "solvodin-4mg-5ml-syp", nameTrade: "Solvodin 4mg/5ml Syp", nameAr: "", nameEn: "Solvodin 4mg/5ml Syp", form: "syrup-and-oral-drop", defaultDose: "4mg", defaultFrequency: "1x1" },
    { id: "spironolactone-tab-100mg", nameTrade: "spironolactone tab 100mg", nameAr: "", nameEn: "spironolactone tab 100mg", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "spironolactone-tab-25mg", nameTrade: "spironolactone tab 25mg", nameAr: "", nameEn: "spironolactone tab 25mg", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "stugeron-25mg-tab", nameTrade: "Stugeron 25mg Tab", nameAr: "", nameEn: "Stugeron 25mg Tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "survanta-25mg-vial", nameTrade: "Survanta 25mg vial", nameAr: "", nameEn: "Survanta 25mg vial", form: "vial", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "symbicort-turbuhaler", nameTrade: "Symbicort turbuhaler", nameAr: "", nameEn: "Symbicort turbuhaler", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-10cc", nameTrade: "Syringe 10cc", nameAr: "", nameEn: "Syringe 10cc", form: "supplies", defaultDose: "10cc", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-20cc", nameTrade: "Syringe 20cc", nameAr: "", nameEn: "Syringe 20cc", form: "supplies", defaultDose: "20cc", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-50cc", nameTrade: "Syringe 50cc", nameAr: "", nameEn: "Syringe 50cc", form: "supplies", defaultDose: "50cc", defaultFrequency: "حسب الحاجة" },
    { id: "syringe-50cc-feeding", nameTrade: "Syringe 50cc feeding", nameAr: "", nameEn: "Syringe 50cc feeding", form: "supplies", defaultDose: "50cc", defaultFrequency: "حسب الحاجة" },
    { id: "tazocin-vial", nameTrade: "Tazocin vial", nameAr: "", nameEn: "Tazocin vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "tegretol-200mg-tab", nameTrade: "Tegretol 200mg Tab", nameAr: "", nameEn: "Tegretol 200mg Tab", form: "tablet", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "tetrabenzine-12-5mg-tab", nameTrade: "Tetrabenzine 12.5mg tab", nameAr: "", nameEn: "Tetrabenzine 12.5mg tab", form: "tablet", defaultDose: "12.5mg", defaultFrequency: "1x1" },
    { id: "thyroxine-100mg-tab", nameTrade: "Thyroxine 100mg tab", nameAr: "", nameEn: "Thyroxine 100mg tab", form: "tablet", defaultDose: "100mg", defaultFrequency: "1x1" },
    { id: "thyroxine-50mg-tab", nameTrade: "Thyroxine 50mg tab", nameAr: "", nameEn: "Thyroxine 50mg tab", form: "tablet", defaultDose: "50mg", defaultFrequency: "1x1" },
    { id: "tigecycline-vial-500mg", nameTrade: "Tigecycline vial 500mg", nameAr: "", nameEn: "Tigecycline vial 500mg", form: "vial", defaultDose: "500mg", defaultFrequency: "1x1" },
    { id: "tpn-i-v-infusion", nameTrade: "TPN I.V. infusion", nameAr: "", nameEn: "TPN I.V. infusion", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "tryptizole-25mg-tab", nameTrade: "Tryptizole 25mg Tab", nameAr: "", nameEn: "Tryptizole 25mg Tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "tysabri-300mg-vial", nameTrade: "Tysabri 300mg vial", nameAr: "", nameEn: "Tysabri 300mg vial", form: "vial", defaultDose: "300mg", defaultFrequency: "1x1" },
    { id: "urine-bag", nameTrade: "Urine bag", nameAr: "", nameEn: "Urine bag", form: "supplies", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "urso-300mg-cap", nameTrade: "Urso 300mg cap", nameAr: "", nameEn: "Urso 300mg cap", form: "tablet", defaultDose: "300mg", defaultFrequency: "1x1" },
    { id: "valium-10mg-amp", nameTrade: "Valium 10mg amp", nameAr: "", nameEn: "Valium 10mg amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "valium-5mg-tab", nameTrade: "Valium 5mg Tab", nameAr: "", nameEn: "Valium 5mg Tab", form: "tablet", defaultDose: "5mg", defaultFrequency: "1x1" },
    { id: "vancomycin-1g-vial", nameTrade: "Vancomycin 1g vial", nameAr: "", nameEn: "Vancomycin 1g vial", form: "vial", defaultDose: "1g", defaultFrequency: "1x1" },
    { id: "vancomycin-500-mg-vial", nameTrade: "Vancomycin 500 mg vial", nameAr: "", nameEn: "Vancomycin 500 mg vial", form: "vial", defaultDose: "", defaultFrequency: "1x1" },
    { id: "vastarel-35mg-mr", nameTrade: "Vastarel 35mg MR", nameAr: "", nameEn: "Vastarel 35mg MR", form: "tablet", defaultDose: "35mg", defaultFrequency: "1x1" },
    { id: "venofer-2-amp", nameTrade: "Venofer 2% Amp", nameAr: "", nameEn: "Venofer 2% Amp", form: "ampule", defaultDose: "2%", defaultFrequency: "1x1" },
    { id: "ventolin-inhalation", nameTrade: "Ventolin inhalation", nameAr: "", nameEn: "Ventolin inhalation", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "vit-k-10mg-amp", nameTrade: "Vit. K 10mg Amp", nameAr: "", nameEn: "Vit. K 10mg Amp", form: "ampule", defaultDose: "10mg", defaultFrequency: "1x1" },
    { id: "vit-k-2mg-amp", nameTrade: "Vit. K 2mg Amp", nameAr: "", nameEn: "Vit. K 2mg Amp", form: "ampule", defaultDose: "2mg", defaultFrequency: "1x1" },
    { id: "voltarin-25mg-tab", nameTrade: "Voltarin 25mg Tab", nameAr: "", nameEn: "Voltarin 25mg Tab", form: "tablet", defaultDose: "25mg", defaultFrequency: "1x1" },
    { id: "voltarin-75mg-amp", nameTrade: "Voltarin 75mg Amp", nameAr: "", nameEn: "Voltarin 75mg Amp", form: "ampule", defaultDose: "75mg", defaultFrequency: "1x1" },
    { id: "voriconazole-200mg-tab", nameTrade: "Voriconazole 200mg tab", nameAr: "", nameEn: "Voriconazole 200mg tab", form: "tablet", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "voriconazole-vial-200mg", nameTrade: "Voriconazole vial 200mg", nameAr: "", nameEn: "Voriconazole vial 200mg", form: "vial", defaultDose: "200mg", defaultFrequency: "1x1" },
    { id: "xylocaine-2-amp", nameTrade: "Xylocaine 2% Amp", nameAr: "", nameEn: "Xylocaine 2% Amp", form: "ampule", defaultDose: "2%", defaultFrequency: "1x1" },
    { id: "xylocaine-2-gel", nameTrade: "Xylocaine 2% gel", nameAr: "", nameEn: "Xylocaine 2% gel", form: "solution", defaultDose: "2%", defaultFrequency: "حسب الحاجة" },
    { id: "xylocaine-5-oint", nameTrade: "Xylocaine 5% oint", nameAr: "", nameEn: "Xylocaine 5% oint", form: "solution", defaultDose: "5%", defaultFrequency: "حسب الحاجة" },
    { id: "zinc-oxide-oint", nameTrade: "Zinc oxide oint", nameAr: "", nameEn: "Zinc oxide oint", form: "solution", defaultDose: "", defaultFrequency: "حسب الحاجة" },
    { id: "zofran-ampoule-8mg", nameTrade: "Zofran ampoule 8mg", nameAr: "", nameEn: "Zofran ampoule 8mg", form: "ampule", defaultDose: "8mg", defaultFrequency: "1x1" },
    { id: "zovirax-vial-250mg", nameTrade: "Zovirax vial 250mg", nameAr: "", nameEn: "Zovirax vial 250mg", form: "vial", defaultDose: "250mg", defaultFrequency: "1x1" },
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
  //   v8 = user's full 235-med list re-added with full names (form kept)
  const DEFAULT_MEDICATIONS_VERSION = 9;

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
