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
    // Each row captures: patient name, plate number (الطبلة), bed
    // number (سرير), and a deep copy of their medications (so the
    // supply injection below doesn't mutate the stored patient data).
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
            plateNumber: p.plateNumber || "",
            bedNumber: bed.number,
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
    // LAYOUT (per user request):
    //   - One row per occupied patient
    //   - First column:  اسم المريض (patient name only)
    //   - Second column: رقم الطبلة (plate number — empty if not set)
    //   - Subsequent columns: each column is a medication's frequency
    //     number, in the same order across all patients.
    //   - No medication names as column headers (the user wants just
    //     numbers — the pharmacist can recognize the meds by position
    //     since they're in the same order as the chart/Excel).
    //   - Column headers for the med columns are blank ("").
    //
    // Example:
    //   اسم المريض  | رقم الطبلة |     |     |     |
    //   محمد أحمد   | 5          | 3   | 2   |     |
    //   فاطمة حسن   |            | 1   |     | 3   |
    //   عبدالله     | 2          | 2   | 1   | 1   |

    function parseFreqCount(freq) {
      if (!freq) return "";
      const m = freq.match(/×\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
      const n = parseInt(freq, 10);
      if (!isNaN(n) && n > 0) return n;
      return freq;  // custom text like "حسب القياس"
    }

    // Header row: اسم المريض + رقم الطبلة + one blank cell per med column
    const maxMedCount = occupiedRows.reduce((m, p) =>
      Math.max(m, (p.medications || []).length), 0);
    const header = ["اسم المريض", "رقم الطبلة"];
    for (let i = 0; i < maxMedCount; i++) header.push("");

    // Data rows — one row per patient, columns = each med's frequency
    const rows = [header];
    occupiedRows.forEach(patient => {
      const row = [patient.name, patient.plateNumber || ""];
      (patient.medications || []).forEach(pm => {
        if (!pm || !pm.id) return;
        const freq = pm.frequency || "";
        row.push(parseFreqCount(freq));
      });
      // Pad with empty strings to align columns (Excel needs rectangular)
      while (row.length < header.length) row.push("");
      rows.push(row);
    });

    // ---- Step 5: create workbook + worksheet ----
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths: wider for name + plate, narrower for med cols
    ws["!cols"] = [
      { wch: 22 },  // اسم المريض
      { wch: 12 }   // رقم الطبلة
    ];
    for (let i = 0; i < maxMedCount; i++) ws["!cols"].push({ wch: 6 });

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
