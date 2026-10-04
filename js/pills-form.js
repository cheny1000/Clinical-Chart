// Pills form overlay generator (استمارة الحبوب)
// =========================================================
// Generates "استمارة اعطاء الحبوب" (Pill Dispensing Form) as PNG:
//
// 1. PharmacyPillsForm.generatePillsForm() — generates ONE blank form
//    (for reference / printing as a master copy)
//
// 2. PharmacyPillsForm.generateAllPatientPillsForms(state) — iterates
//    all patients, finds those with at least one medication from the
//    "tablet" form category, and generates a personalized form for
//    each. The form contains:
//      - Static header: مستشفى بغداد التعليمي / الصيدلية السريرية /
//        استمارة اعطاء الحبوب
//      - Row 1 of the table: patient name (col 1, rightmost) +
//        room number "غرفة N" (col 2)
//      - Row 2 of the table: column labels (العلاج / blank /
//        وقت الجرعة / طريقة الاستخدام) — static
//      - Rows 3-10: the patient's tablet-form medications
//        (med name in col 1, freq in col 3, dose in col 4)
//      - Footer: "الصيدلي السريري" — static
//
// Layout (measured from the blank form, 1654×2339 px @ 300 DPI = A4):
//   - Page header area: y=130-310 (3 lines, 48px font)
//   - Table row 1 (patient info): y=322-388 (63px tall)
//   - Table row 2 (column labels): y=388-454 (63px tall)
//   - Table rows 3-10 (medication rows): y=454-1958 (185px each, 8 rows)
//   - Footer: y=2150 (left side)
//
// Vertical grid lines (X coords, left→right):
//   V_LINES = [133, 778, 981, 1206, 1529]
//   → Col 1 (rightmost, RTL first) = V_LINES[3..4] (x=1206-1529, w=323)
//   → Col 2                          = V_LINES[2..3] (x=981-1206,  w=225)
//   → Col 3                          = V_LINES[1..2] (x=778-981,   w=203)
//   → Col 4 (leftmost, RTL last)    = V_LINES[0..1] (x=133-778,   w=645)

(function (global) {
  "use strict";

  const TEMPLATE_URL = "img/pills-form-template.png";

  // Grid geometry — measured from the uploaded blank form (1654×2339px)
  const G = {
    IMG_W: 1654, IMG_H: 2339,
    V_LINES: [133, 778, 981, 1206, 1529],
    H_LINES: [322, 388, 454, 642, 830, 1018, 1206, 1394, 1582, 1770, 1958]
  };

  // Number of medication rows available (rows 3-10, 8 rows × 185px each)
  const MAX_MED_ROWS = 8;

  // ---- Helpers ----
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Draw Arabic text centered on (cx, cy)
  function drawArabicLine(ctx, text, cx, cy, fontPx, bold = true) {
    ctx.font = `${bold ? "bold " : ""}${fontPx}px Tajawal, Cairo, Arial, sans-serif`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // Alphabetic baseline + Y offset = (fontSize × 0.35) for proper
    // glyph vertical centering (matches the chart-image.js approach).
    ctx.fillText(text, cx, cy + fontPx * 0.35);
  }

  // Draw Arabic text left-aligned at (x, y)
  function drawArabicLeft(ctx, text, x, y, fontPx, bold = true) {
    ctx.font = `${bold ? "bold " : ""}${fontPx}px Tajawal, Cairo, Arial, sans-serif`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + fontPx * 0.35);
  }

  // Get the best display name for a med (matches UI.primaryName logic)
  function primaryName(m) {
    if (!m) return "";
    return m.nameTrade || m.nameAr || m.nameEn || m.name || m.id || "";
  }

  // ---- Section drawing helpers ----

  function drawPageHeader(ctx) {
    const page_cx = G.IMG_W / 2;
    const lines = [
      "مستشفى بغداد التعليمي",
      "الصيدلية السريرية",
      "استمارة اعطاء الحبوب"
    ];
    const fontPx = 48;
    const line_h = 60;
    const top_y = 130;
    lines.forEach((line, i) => {
      drawArabicLine(ctx, line, page_cx, top_y + i * line_h, fontPx);
    });
  }

  function drawColumnLabels(ctx) {
    // Row 2 of the table (y=388-454)
    const row_top = G.H_LINES[1];  // 388
    const row_bot = G.H_LINES[2];  // 454
    const row_cy = (row_top + row_bot) / 2;  // 421
    const fontPx = 32;

    // Col 1 (rightmost, V_LINES[3..4]): BLANK (per user request —
    // العلاج moved from col 1 to col 2)

    // Col 2 (V_LINES[2..3]): "العلاج" (was blank, moved here per user)
    const col2_cx = (G.V_LINES[2] + G.V_LINES[3]) / 2;
    drawArabicLine(ctx, "العلاج", col2_cx, row_cy, fontPx);

    // Col 3 (V_LINES[1..2]): "وقت الجرعة"
    const col3_cx = (G.V_LINES[1] + G.V_LINES[2]) / 2;
    drawArabicLine(ctx, "وقت الجرعة", col3_cx, row_cy, fontPx);

    // Col 4 (leftmost, V_LINES[0..1]): "طريقة الاستخدام"
    const col4_cx = (G.V_LINES[0] + G.V_LINES[1]) / 2;
    drawArabicLine(ctx, "طريقة الاستخدام", col4_cx, row_cy, fontPx);
  }

  function drawFooter(ctx) {
    // "الصيدلي السريري" at bottom-left of the page
    const text = "الصيدلي السريري";
    const fontPx = 36;
    drawArabicLeft(ctx, text, 200, 2150, fontPx);
  }

  // Draw patient info in row 1 of the table (y=322-388, 63px tall)
  //   Col 1 (rightmost): patient name
  //   Col 2: room number like "غرفة 3"
  function drawPatientInfo(ctx, patientName, roomNumber) {
    const row_top = G.H_LINES[0];  // 322
    const row_bot = G.H_LINES[1];  // 388
    const row_cy = (row_top + row_bot) / 2;  // 355
    const fontPx = 28;  // smaller than labels so the name fits

    // Col 1 (rightmost, V_LINES[3..4]): patient name
    const col1_cx = (G.V_LINES[3] + G.V_LINES[4]) / 2;
    drawArabicLine(ctx, patientName, col1_cx, row_cy, fontPx);

    // Col 2 (V_LINES[2..3]): room number "غرفة N"
    const col2_cx = (G.V_LINES[2] + G.V_LINES[3]) / 2;
    drawArabicLine(ctx, "غرفة " + roomNumber, col2_cx, row_cy, fontPx);
  }

  // Convert a frequency string like "1×2" or "×3" or "2" to a
  // human-readable Arabic time interval. Math: hours = 24 / N where N
  // is the daily frequency. Arabic plural rules: 3-10 use "ساعات",
  // others (1, 2, 11+) use "ساعة".
  //   "1×1" → "كل 24 ساعة"
  //   "1×2" → "كل 12 ساعة"
  //   "1×3" → "كل 8 ساعات"
  //   "1×4" → "كل 6 ساعات"
  //   "1×6" → "كل 4 ساعات"
  // Non-parseable frequencies (e.g. "حسب القياس") return as-is.
  function freqToTimeInterval(freq) {
    if (!freq) return "";
    // Try to extract N from "×N" or "1×N" or just "N"
    let n = null;
    const m = freq.match(/×\s*(\d+)/);
    if (m) {
      n = parseInt(m[1], 10);
    } else {
      const plainNum = parseInt(freq, 10);
      if (!isNaN(plainNum) && plainNum > 0) n = plainNum;
    }
    if (n === null || n === 0) return freq;  // can't parse, return raw

    const hours = 24 / n;
    let hoursStr;
    if (Number.isInteger(hours)) {
      hoursStr = String(hours);
    } else {
      hoursStr = hours.toFixed(1);
    }
    // Arabic plural: 3-10 use "ساعات", others use "ساعة".
    // For non-integer hours (like 4.8), use "ساعة".
    let unit;
    if (Number.isInteger(hours) && hours >= 3 && hours <= 10) {
      unit = "ساعات";
    } else {
      unit = "ساعة";
    }
    return `كل ${hoursStr} ${unit}`;
  }

  // Draw two Arabic lines stacked vertically in the same column.
  // topText appears in the upper half, bottomText in the lower half.
  // Used for the medication column where the dose is written below the
  // medication name.
  function drawArabicLineStacked(ctx, topText, bottomText, cx, cellTop, cellBot, topFontPx, bottomFontPx) {
    const cellCy = (cellTop + cellBot) / 2;
    // Position: top text 16px above center, bottom text 18px below center.
    // (16 + 18 = 34px gap between the two lines, fits in 185px row easily)
    const topY = cellCy - 18;
    const botY = cellCy + 18;
    drawArabicLine(ctx, topText, cx, topY, topFontPx);
    drawArabicLine(ctx, bottomText, cx, botY, bottomFontPx);
  }

  // Draw medications in rows 3-10 (y=454-1958, 185px each, max 8 rows).
  // For each med (per user request):
  //   Col 1 (rightmost): BLANK (was med name; med column moved to col 2)
  //   Col 2 (العلاج):    med name (top) + dose (below) — stacked
  //   Col 3 (وقت الجرعة):  human-readable time interval (e.g. "كل 12 ساعة")
  //   Col 4 (طريقة الاستخدام): BLANK (pharmacist fills by hand)
  function drawMedications(ctx, tabletMeds) {
    const nameFontPx = 28;
    const doseFontPx = 22;  // slightly smaller than name
    const timeFontPx = 28;
    const maxRows = Math.min(MAX_MED_ROWS, tabletMeds.length);

    for (let i = 0; i < maxRows; i++) {
      const entry = tabletMeds[i];
      const pm = entry.pm;
      const catalog = entry.catalog;

      // Row i (0-indexed) maps to table row 3+i.
      const row_top = G.H_LINES[2 + i];
      const row_bot = G.H_LINES[2 + i + 1];

      // Col 1 (rightmost, V_LINES[3..4]): BLANK

      // Col 2 (V_LINES[2..3]): med name (top) + dose (below) — stacked
      const col2_cx = (G.V_LINES[2] + G.V_LINES[3]) / 2;
      const medName = primaryName(catalog);
      const dose = pm.dose || catalog.defaultDose || "";
      drawArabicLineStacked(ctx, medName, dose, col2_cx, row_top, row_bot,
                            nameFontPx, doseFontPx);

      // Col 3 (V_LINES[1..2]): time interval (converted from frequency)
      const col3_cx = (G.V_LINES[1] + G.V_LINES[2]) / 2;
      const row_cy = (row_top + row_bot) / 2;
      const freq = pm.frequency || catalog.defaultFrequency || "";
      const timeText = freqToTimeInterval(freq);
      drawArabicLine(ctx, timeText, col3_cx, row_cy, timeFontPx);

      // Col 4 (leftmost, V_LINES[0..1]): BLANK (was dose)
      // Per user request: dose moved to col 2 under the med name.
      // طريقة الاستخدام column left blank for pharmacist to fill in.
    }
  }

  // ---- Build a complete pills form canvas (used by both blank and
  //      per-patient variants) ----
  async function buildPillsFormCanvas(templateImg, patient, tabletMeds) {
    const canvas = document.createElement("canvas");
    canvas.width = G.IMG_W;
    canvas.height = G.IMG_H;
    const ctx = canvas.getContext("2d");

    // 1. Draw the template (grid lines + outer border)
    ctx.drawImage(templateImg, 0, 0, G.IMG_W, G.IMG_H);

    // 2. Static page header (hospital / dept / title)
    drawPageHeader(ctx);

    // 3. Patient info in row 1 (only if patient data is provided)
    if (patient) {
      drawPatientInfo(ctx, patient.name, patient.roomNumber);
    }

    // 4. Static column labels in row 2
    drawColumnLabels(ctx);

    // 5. Medications in rows 3+ (only if tabletMeds is provided)
    if (tabletMeds && tabletMeds.length > 0) {
      drawMedications(ctx, tabletMeds);
    }

    // 6. Static footer
    drawFooter(ctx);

    return canvas;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  // Generate a BLANK pills form (no patient data, just the static
  // template). Useful as a master copy or for manual filling.
  async function generatePillsForm() {
    const templateImg = await loadImage(TEMPLATE_URL);
    const canvas = await buildPillsFormCanvas(templateImg, null, null);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `pills-form-${stamp}.png`;
    downloadBlob(blob, filename);
    return { blob, filename };
  }

  // Generate ONE pills form for a specific patient (returns the Blob,
  // does NOT auto-download — caller handles downloading).
  async function generatePatientPillsForm(patient, tabletMeds) {
    const templateImg = await loadImage(TEMPLATE_URL);
    const canvas = await buildPillsFormCanvas(templateImg, patient, tabletMeds);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return blob;
  }

  // Generate pills forms for ALL patients who have at least one tablet-
  // form medication. Auto-downloads each as a separate PNG.
  // @param state — { patients: bedKey→patient, medications: catalog[] }
  //   NOTE: the state field name is `medications` (not `meds`) to
  //   match the rest of the app's state shape.
  async function generateAllPatientPillsForms(state) {
    if (!state || !state.patients || !state.medications) {
      return { error: "لا توجد بيانات" };
    }

    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS) {
      return { error: "تعذّر الوصول إلى بيانات الغرف" };
    }

    // Find all patients with at least one tablet-form medication
    const tabletPatients = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;

        // Filter patient's meds to tablet-form only
        const tabletMeds = (Array.isArray(p.medications) ? p.medications : [])
          .filter(pm => pm && pm.id)
          .map(pm => {
            const catalog = (state.medications || []).find(m => m && m.id === pm.id);
            if (!catalog || catalog.form !== "tablet") return null;
            return { pm: pm, catalog: catalog };
          })
          .filter(x => x !== null);

        if (tabletMeds.length === 0) return;

        tabletPatients.push({
          bedKey: key,
          name: p.name.trim(),
          roomNumber: room.id,
          tabletMeds: tabletMeds
        });
      });
    });

    if (tabletPatients.length === 0) {
      return { error: "لا يوجد مرضى لديهم أدوية من قسم الحبوب (tablets)" };
    }

    // Load template once (reused for all patient forms)
    const templateImg = await loadImage(TEMPLATE_URL);

    // Generate a form for each patient
    const pages = [];
    for (let i = 0; i < tabletPatients.length; i++) {
      const patient = tabletPatients[i];
      const canvas = await buildPillsFormCanvas(
        templateImg, patient, patient.tabletMeds
      );
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      pages.push({ blob, patient });
    }

    // Download each (stagger to avoid browser blocking multiple
    // simultaneous downloads)
    const stamp = new Date().toISOString().slice(0, 10);
    pages.forEach((p, i) => {
      // Sanitize patient name for filename (replace path-unsafe chars)
      const safeName = p.patient.name.replace(/[\\/:*?"<>|]/g, "_");
      const filename = `pills-form-${safeName}-${stamp}.png`;
      setTimeout(() => downloadBlob(p.blob, filename), i * 300);
    });

    return { count: pages.length, pages: pages };
  }

  // ---- Exports ----
  global.PharmacyPillsForm = {
    generatePillsForm,
    generatePatientPillsForm,
    generateAllPatientPillsForms
  };

})(window);
