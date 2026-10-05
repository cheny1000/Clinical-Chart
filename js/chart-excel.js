// Chart Excel exporter (تصدير الجارت كـ Excel)
// =========================================================
// Exports the chart data as a downloadable .xlsx file using
// SheetJS (xlsx@0.18.5). The Excel file contains:
//   - One row per occupied patient
//   - One column per prescribed medication + supplies
//   - Frequency count (the integer from "1×3") in each cell
//   - Patient name column on the RIGHT (RTL sheet view)
//   - Room number column for context
//   - Header row with med names
//   - Totals row at the bottom
//
// Same data-collection logic as chart-image.js: iterates Ward.ROOMS,
// injects supply distribution if provided, builds ordered med list
// (prescribed + priority supplies).

(function (global) {
  "use strict";

  // ---- Main entry point ----
  // @param state — { patients: bedKey→patient, medications: catalog[],
  //                  supplyDistribution: optional }
  // Generates a .xlsx file and downloads it.
  async function generateChartExcel(state) {
    if (!state || !state.patients || !state.medications) {
      return { error: "لا توجد بيانات" };
    }
    const XLSX = global.XLSX;
    if (!XLSX) {
      return { error: "تعذّر تحميل مكتبة Excel — تحقق من الإنترنت" };
    }

    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS) {
      return { error: "بيانات الغرف غير متوفرة" };
    }

    // ---- Step 1: build occupied rows (deep copy, drop legacy 5cc) ----
    const occupiedRows = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (p && p.name && p.name.trim()) {
          const medsCopy = (Array.isArray(p.medications) ? p.medications : [])
            .filter(pm => pm && pm.id !== "syringe-5cc")
            .map(pm => pm && typeof pm === "object" ? Object.assign({}, pm) : pm);
          occupiedRows.push({
            bedKey: key,
            name: p.name.trim(),
            roomNumber: room.id,
            medications: medsCopy
          });
        }
      });
    });

    if (occupiedRows.length === 0) {
      return { error: "لا يوجد مرضى مشغولون" };
    }

    // ---- Step 2: inject supplies from state.supplyDistribution ----
    // (or _lastSupplyDistribution if state doesn't have one — this
    // matches the chart-image.js behavior)
    const supplyDistribution = state.supplyDistribution || null;
    const supplyDefaults = {
      "dextrose-saline":   { nameTrade: "G/S" },
      "ringers-lactate":    { nameTrade: "R/L" },
      "glucose-5":          { nameTrade: "G/W" },
      "sodium-chloride-09": { nameTrade: "N/S" },
      "nacl-100ml":         { nameTrade: "N/S 100ml" },
      "iv-set":             { nameTrade: "I.V. Set" },
      "blood-iv-set":       { nameTrade: "Blood I.V. Set" },
      "cannula":            { nameTrade: "Cannula" },
      "syringe-5cc":        { nameTrade: "5cc Syringe" },
      "syringe-1cc":        { nameTrade: "1cc Syringe" },
      "syringe-10cc":       { nameTrade: "10cc Syringe" },
      "syringe-20cc":       { nameTrade: "20cc Syringe" },
      "syringe-50cc":       { nameTrade: "50cc Syringe" },
      "urine-bag":          { nameTrade: "Urine Bag" },
      "ng-tube-14":         { nameTrade: "NG Tube 14" },
      "floy-14":            { nameTrade: "Foley 14" }
    };
    if (supplyDistribution && typeof supplyDistribution === "object") {
      Object.keys(supplyDistribution).forEach(supplyId => {
        const dist = supplyDistribution[supplyId];
        if (!dist || typeof dist !== "object") return;
        const defaults = supplyDefaults[supplyId] || { nameTrade: supplyId };
        const med = (state.medications || []).find(x => x && x.id === supplyId) || defaults;
        occupiedRows.forEach(row => {
          const freq = dist[row.bedKey];
          if (freq && freq > 0) {
            row.medications.push({
              id: supplyId,
              nameTrade: med.nameTrade || defaults.nameTrade,
              nameAr:    med.nameAr    || "",
              nameEn:    med.nameEn    || "",
              form:      "supplies",
              dose:      (med.defaultDose || "") || "",
              frequency: "1×" + freq
            });
          }
        });
      });
    }

    // ---- Step 3: build ordered med list ----
    // Same as chart-image.js: prescribed meds + priority supplies at end
    const prescribedIds = new Set();
    occupiedRows.forEach(p => {
      (p.medications || []).forEach(pm => { if (pm && pm.id) prescribedIds.add(pm.id); });
    });
    const catalogIds = new Set((state.medications || []).map(m => m && m.id).filter(Boolean));
    const prescribedMeds = (state.medications || []).filter(m => prescribedIds.has(m.id));
    const missingFromCatalog = [];
    prescribedIds.forEach(id => {
      if (!catalogIds.has(id)) {
        for (const row of occupiedRows) {
          const found = (row.medications || []).find(pm => pm && pm.id === id);
          if (found) {
            missingFromCatalog.push({
              id: found.id, nameTrade: found.nameTrade,
              nameAr: found.nameAr || "", nameEn: found.nameEn || "",
              form: found.form || "supplies"
            });
            break;
          }
        }
      }
    });
    const allPrescribedMeds = prescribedMeds.concat(missingFromCatalog);

    const PRIORITY_SUPPLY_IDS = [
      "dextrose-saline", "ringers-lactate", "glucose-5", "sodium-chloride-09",
      "nacl-100ml", "iv-set", "blood-iv-set", "cannula",
      "syringe-5cc", "syringe-1cc", "syringe-10cc", "syringe-20cc", "syringe-50cc",
      "urine-bag", "ng-tube-14", "floy-14"
    ];
    const priorityBucket = [];
    const restBucket = [];
    allPrescribedMeds.forEach(m => {
      if (m && PRIORITY_SUPPLY_IDS.indexOf(m.id) !== -1) priorityBucket.push(m);
      else restBucket.push(m);
    });
    priorityBucket.sort((a, b) =>
      PRIORITY_SUPPLY_IDS.indexOf(a.id) - PRIORITY_SUPPLY_IDS.indexOf(b.id));

    // All meds in one flat list (no 50-column limit in Excel — Excel
    // can hold thousands of columns)
    const orderedMeds = restBucket.concat(priorityBucket);

    // ---- Step 4: build the worksheet data (as a 2D array) ----
    // SIMPLIFIED LAYOUT (per user request):
    //   - Two columns only:
    //     Col A (rightmost in RTL): اسم المريض (patient name)
    //     Col B:                    التكرار (total daily frequency)
    //   - No medication names as headers
    //   - No per-med columns
    //   - Just the patient name + the SUM of all their medications'
    //     daily frequencies (e.g. if patient has paracetamol 1×3 +
    //     fucidin 1×2 → total = 5).
    //   - Custom frequencies (like "حسب القياس") are skipped in the
    //     sum (can't be added numerically).

    function parseFreqCount(freq) {
      if (!freq) return 0;
      const m = freq.match(/×\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
      const n = parseInt(freq, 10);
      return (!isNaN(n) && n > 0) ? n : 0;
    }

    // Header row
    const header = ["اسم المريض", "التكرار"];

    // Data rows
    const rows = [header];
    let grandTotal = 0;
    occupiedRows.forEach(patient => {
      // Sum all daily frequencies across the patient's meds + supplies
      let total = 0;
      (patient.medications || []).forEach(pm => {
        if (!pm || !pm.id) return;
        const freq = pm.frequency || "";
        total += parseFreqCount(freq);
      });
      grandTotal += total;
      rows.push([patient.name, total]);
    });

    // Totals row at the bottom
    rows.push(["الإجمالي", grandTotal]);

    // ---- Step 5: create workbook + worksheet ----
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths — wider for the name column
    ws["!cols"] = [
      { wch: 22 },  // اسم المريض (col A)
      { wch: 12 }   // التكرار (col B)
    ];

    // Set RTL view (sheet shows right-to-left)
    const wb = XLSX.utils.book_new();
    wb.Workbook = {
      Views: [{ RTL: true }]
    };
    XLSX.utils.book_append_sheet(wb, ws, "الجارت");

    // ---- Step 6: download as .xlsx ----
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `chart-${stamp}.xlsx`;
    XLSX.writeFile(wb, filename);

    return {
      ok: true,
      count: occupiedRows.length,
      medCount: orderedMeds.length,
      filename: filename
    };
  }

  // Helper: look up a patient's frequency for a medId (returns the
  // string value, or "" if not given)
  function counts_lookup(patient, medId) {
    if (!patient || !patient.medications) return "";
    const pm = patient.medications.find(x => x && x.id === medId);
    if (!pm) return "";
    const freq = pm.frequency || "";
    const match = freq.match(/×\s*(\d+)/);
    if (match) return match[1];
    return freq;  // custom text
  }

  // ---- Exports ----
  global.PharmacyChartExcel = {
    generateChartExcel
  };

})(window);
