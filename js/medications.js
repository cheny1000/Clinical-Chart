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
  const DEFAULT_MEDICATIONS = [];

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
  //   v7 = deleted ALL medications from both DEFAULT + DISABLED lists.
  //        The app now starts with an empty catalog. The user will
  //        add medications manually via the admin panel or via the
  //        doctor's "request new medication" workflow.
  const DEFAULT_MEDICATIONS_VERSION = 7;

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
