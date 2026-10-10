// Medication Summary generator (إحصاء الأدوية)
// =========================================================
// Iterates all occupied patients, sums up the daily frequency of
// each medication across the ward, and generates a PDF report
// listing each medication with:
//   - Arabic name (preferred) or English trade name (fallback)
//   - Form category (Vial / Ampule / Tablet / Supplies / …)
//   - Total daily count across all patients
//
// Output: a single PDF (multi-page if needed), one row per medication,
// grouped by form category. Sorted by total count descending within
// each group, so the most-used meds appear first.

(function (global) {
  "use strict";

  // ---- Helpers ----

  function getDisplayLabel(m) {
    if (!m) return "";
    return m.nameAr || m.nameTrade || m.nameEn || m.name || m.id || "";
  }

  // Parse a frequency string like "1×3" or "×3" or "3" → returns the
  // daily count as a number. Non-parseable strings (e.g. "حسب القياس")
  // return 0 — they can't be summed numerically.
  function parseFreqCount(freq) {
    if (!freq) return 0;
    const m = freq.match(/×\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    const plain = parseInt(freq, 10);
    if (!isNaN(plain) && plain > 0) return plain;
    return 0;
  }

  // ---- Main entry point ----
  // @param state — { patients: bedKey→patient, medications: catalog[] }
  // Generates a PDF medication summary and downloads it.
  async function generateMedSummary(state) {
    if (!state || !state.patients || !state.medications) {
      return { error: "لا توجد بيانات" };
    }
    const meds = state.medications || [];
    if (!Array.isArray(meds) || meds.length === 0) {
      return { error: "لا توجد أدوية في الكتالوج" };
    }

    // Build a map: medId → { med, total count, patient count }
    const Meds = global.PharmacyMedications || {};
    const FORM_LABELS = Meds.FORM_LABELS || {};
    const FORM_ORDER = Meds.FORM_ORDER || ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

    // Find med by id (for catalog lookup)
    const medById = {};
    meds.forEach(m => { if (m && m.id) medById[m.id] = m; });

    // Tally counts: medId → { total: number, patients: number, custom: boolean }
    const tally = {};
    Object.values(state.patients).forEach(p => {
      if (!p || !p.name || !p.name.trim()) return;  // skip empty beds
      const seenInThisPatient = new Set();
      (p.medications || []).forEach(pm => {
        if (!pm || !pm.id) return;
        const catalog = medById[pm.id];
        if (!catalog) return;  // med no longer in catalog (deleted)
        if (!tally[pm.id]) {
          tally[pm.id] = {
            catalog: catalog,
            total: 0,
            patients: 0,
            custom: false  // true if freq is non-numeric (e.g. "حسب القياس")
          };
        }
        const freq = pm.frequency || catalog.defaultFrequency || "";
        const count = parseFreqCount(freq);
        if (count === 0 && freq) {
          tally[pm.id].custom = true;
        }
        tally[pm.id].total += count;
        // Count distinct patients (a med given multiple times to the
        // same patient only counts once)
        if (!seenInThisPatient.has(pm.id)) {
          seenInThisPatient.add(pm.id);
          tally[pm.id].patients++;
        }
      });
    });

    // Group by form category
    const groups = {};
    FORM_ORDER.forEach(form => { groups[form] = []; });
    Object.values(tally).forEach(t => {
      const formKey = (t.catalog.form && FORM_ORDER.indexOf(t.catalog.form) !== -1)
        ? t.catalog.form
        : "supplies";
      if (!groups[formKey]) groups[formKey] = [];
      groups[formKey].push(t);
    });

    // Sort each group: numeric-count meds first (descending), then
    // custom-freq meds at the end of their group (no meaningful number)
    Object.values(groups).forEach(arr => {
      arr.sort((a, b) => {
        // Custom freq (no count) goes to the end
        if (a.custom && !b.custom) return 1;
        if (!a.custom && b.custom) return -1;
        // Both numeric: descending count
        if (!a.custom && !b.custom) return b.total - a.total;
        // Both custom: alphabetical by name
        return getDisplayLabel(a.catalog).localeCompare(getDisplayLabel(b.catalog));
      });
    });

    // ---- Build the PDF ----
    const JsPDF =
      (global.jspdf && global.jspdf.jsPDF) ||
      global.jsPDF ||
      (global.jspdf && typeof global.jspdf === "function" ? global.jspdf : null);
    if (!JsPDF) {
      return { error: "تعذّر تحميل مكتبة jsPDF — تحقق من اتصال الإنترنت" };
    }

    const pdf = new JsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    // Page geometry (A4 portrait: 210×297 mm)
    const PAGE_W = 210, PAGE_H = 297;
    const MARGIN_L = 15, MARGIN_R = 15;
    const MARGIN_T = 18, MARGIN_B = 18;
    const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;  // 180mm
    let y = MARGIN_T;

    // ---- Page header (right-aligned for RTL) ----
    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    pdf.text("إحصاء الأدوية", PAGE_W - MARGIN_R, y, { align: "right" });
    y += 8;
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
    pdf.text(`التاريخ: ${dateStr}`, PAGE_W - MARGIN_R, y, { align: "right" });
    y += 6;
    pdf.text("الصيدلية السريرية", PAGE_W - MARGIN_R, y, { align: "right" });
    y += 10;

    // ---- Table header row ----
    function drawTableHeader() {
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      // Columns (right-to-left in RTL):
      //   العدد | القسم | اسم الدواء
      // Widths: 25mm / 35mm / 120mm
      pdf.setFillColor(240, 240, 240);
      pdf.rect(MARGIN_L, y - 4, CONTENT_W, 7, "F");
      pdf.text("العدد", PAGE_W - MARGIN_R, y, { align: "right" });
      pdf.text("القسم", PAGE_W - MARGIN_R - 25, y, { align: "right" });
      pdf.text("اسم الدواء", PAGE_W - MARGIN_R - 25 - 35, y, { align: "right" });
      y += 7;
    }
    drawTableHeader();

    // ---- Iterate form groups in order ----
    pdf.setFontSize(10);
    let firstGroup = true;

    FORM_ORDER.forEach(form => {
      const groupArr = groups[form] || [];
      if (groupArr.length === 0) return;  // skip empty groups

      // Section header for this form
      // Check page space — start new page if needed
      if (y > PAGE_H - MARGIN_B - 15) {
        pdf.addPage();
        y = MARGIN_T;
        drawTableHeader();
      }
      if (!firstGroup) y += 3;  // small gap between groups
      firstGroup = false;

      const formLabel = FORM_LABELS[form] || form;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(50, 50, 50);
      pdf.text(`${formLabel} (${groupArr.length})`, PAGE_W - MARGIN_R, y, { align: "right" });
      y += 6;
      pdf.setTextColor(0, 0, 0);

      // List meds in this group
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      groupArr.forEach(entry => {
        // Check page space
        if (y > PAGE_H - MARGIN_B - 5) {
          pdf.addPage();
          y = MARGIN_T;
          drawTableHeader();
        }
        const name = getDisplayLabel(entry.catalog);
        const countText = entry.custom ? "—" : String(entry.total);

        pdf.text(countText, PAGE_W - MARGIN_R, y, { align: "right" });
        pdf.text(formLabel, PAGE_W - MARGIN_R - 25, y, { align: "right" });
        pdf.text(name, PAGE_W - MARGIN_R - 25 - 35, y, { align: "right" });
        y += 5.5;
      });
    });

    // ---- Footer ----
    if (y > PAGE_H - MARGIN_B - 10) {
      pdf.addPage();
      y = MARGIN_T;
    }
    y += 8;
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    const totalCount = Object.values(tally).reduce((s, t) => s + (t.custom ? 0 : t.total), 0);
    pdf.text(`إجمالي التكرارات اليومية لجميع الأدوية: ${totalCount}`,
             PAGE_W - MARGIN_R, y, { align: "right" });
    y += 5;
    const totalMeds = Object.keys(tally).length;
    const totalPatients = Object.values(state.patients)
      .filter(p => p && p.name && p.name.trim()).length;
    pdf.text(`عدد الأدوية الموصوفة: ${totalMeds}  |  عدد المرضى: ${totalPatients}`,
             PAGE_W - MARGIN_R, y, { align: "right" });

    // ---- Save PDF ----
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `med-summary-${stamp}.pdf`;
    pdf.save(filename);

    return { count: totalMeds, total: totalCount, filename: filename };
  }

  // ---- Exports ----
  global.PharmacyMedSummary = {
    generateMedSummary
  };

})(window);
