// Chart image overlay generator
// --------------------------------
// Uses the scanned "warqat gart" template image as a base and overlays
// patient names + medication names + frequency numbers using the
// HTML5 Canvas API. Output is a high-resolution PNG (and optionally
// PDF) ready to print at the original paper size.
//
// The chart template structure was measured pixel-accurately from the
// uploaded scan (1487x2200px web-optimized, original 2370x3506):
//   - Outer border (double-line)
//   - Header row: 305px tall (originally) for vertical medication names
//   - 50 data rows × 57px each for patients
//   - Patient name column on LEFT (197px wide)
//   - 35 medication columns × ~52-53px each
// All measurements are scaled to the web-optimized image dimensions.

(function (global) {
  "use strict";

  // ---- Template image path ----
  const TEMPLATE_URL = "img/chart-template.jpg";

  // ---- Grid geometry (in TEMPLATE IMAGE coordinates, 1487×2200px) ----
  // Scale factor: original (2370x3506) → web (1487x2200)
  // scale_x = 1487/2370 = 0.6274
  // scale_y = 2200/3506 = 0.6274
  // All measurements below use the SCALED coordinates.
  const SCALE = 1487 / 2370;  // 0.6274

  // Original measurements (from scripts/detect_grid3.py)
  const ORIG = {
    IMG_W: 2370, IMG_H: 3506,
    BORDER_TOP_INNER: 165,
    HEADER_BOTTOM: 470,
    PATIENT_COL_LEFT: 149,
    PATIENT_COL_RIGHT: 346,
    V_LINE_CENTERS: [346, 398, 451, 504, 557, 609, 662, 715, 768, 821, 873,
                     926, 979, 1032, 1084, 1137, 1190, 1243, 1296, 1348, 1401,
                     1454, 1507, 1560, 1612, 1665, 1718, 1771, 1824, 1876, 1929,
                     1982, 2035, 2087, 2140],
    H_LINE_CENTERS: [470, 528, 585, 642, 699, 756, 814, 871, 928, 985, 1043,
                     1100, 1157, 1215, 1272, 1329, 1386, 1443, 1500, 1558, 1615,
                     1672, 1729, 1786, 1844, 1901, 1959, 2016, 2073, 2130, 2187,
                     2245, 2302, 2359, 2417, 2474, 2531, 2589, 2646, 2703, 2760,
                     2817, 2875, 2932, 2989, 3047, 3104, 3161, 3219, 3276],
    NUM_ROWS: 50,
    NUM_COLS: 35,
    HEADER_HEIGHT: 305,  // 165 → 470
    PATIENT_COL_WIDTH: 197,  // 149 → 346
    ROW_HEIGHT: 57,
    COL_WIDTH: 53
  };

  // Scaled to web image
  const G = {
    IMG_W: ORIG.IMG_W * SCALE,   // 1487
    IMG_H: ORIG.IMG_H * SCALE,   // 2200
    HEADER_TOP: ORIG.BORDER_TOP_INNER * SCALE,   // ~103
    HEADER_BOTTOM: ORIG.HEADER_BOTTOM * SCALE,   // ~295
    PATIENT_COL_LEFT: ORIG.PATIENT_COL_LEFT * SCALE,   // ~93
    PATIENT_COL_RIGHT: ORIG.PATIENT_COL_RIGHT * SCALE,  // ~217
    V_LINES: ORIG.V_LINE_CENTERS.map(x => x * SCALE),
    H_LINES: ORIG.H_LINE_CENTERS.map(y => y * SCALE),
    NUM_ROWS: ORIG.NUM_ROWS,
    NUM_COLS: ORIG.NUM_COLS,
    HEADER_HEIGHT: ORIG.HEADER_HEIGHT * SCALE,   // ~191
    PATIENT_COL_WIDTH: ORIG.PATIENT_COL_WIDTH * SCALE,  // ~123
    ROW_HEIGHT: ORIG.ROW_HEIGHT * SCALE,   // ~35.7
    COL_WIDTH: ORIG.COL_WIDTH * SCALE   // ~33.3
  };

  // ---- Arabic text shaping ----
  // Modern browsers handle Arabic RTL natively in Canvas when
  // ctx.direction = 'rtl' and ctx.textAlign = 'center'.
  // No need for arabic_reshaper/bidi in JS.

  // ---- Main entry point ----
  // @param patientsMap - { bedKey: {name, medications: [...]} }
  // @param meds - catalog array of {id, nameTrade, nameAr, nameEn, ...}
  // @param supplyDistribution - optional supplyId → { bedKey: freq }
  // @returns Promise<{png: Blob, pdfUrl: string}>
  async function generateChartImage(patientsMap, meds, supplyDistribution) {
    // Build the same data structure as buildChartReport
    const Ward = global.PharmacyWard;
    const occupiedRows = [];
    if (patientsMap && typeof patientsMap === "object") {
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = patientsMap[key];
          if (p && p.name && p.name.trim()) {
            const medsCopy = (Array.isArray(p.medications) ? p.medications : [])
              .filter(pm => pm && pm.id !== "syringe-5cc")
              .map(pm => pm && typeof pm === "object" ? Object.assign({}, pm) : pm);
            occupiedRows.push({
              bedKey: key,
              name: p.name.trim(),
              medications: medsCopy
            });
          }
        });
      });
    }

    // Inject supplies from supplyDistribution (same as HTML chart)
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
        const med = (meds || []).find(x => x && x.id === supplyId) || defaults;
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

    // Determine which meds to include (prescribed + injected supplies)
    const prescribedIds = new Set();
    occupiedRows.forEach(p => {
      (p.medications || []).forEach(pm => { if (pm && pm.id) prescribedIds.add(pm.id); });
    });
    const catalogIds = new Set((meds || []).map(m => m && m.id).filter(Boolean));
    const prescribedMeds = (meds || []).filter(m => prescribedIds.has(m.id));
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

    // Priority supplies at the end
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

    const numPriority = priorityBucket.length;
    const maxRegular = Math.max(0, G.NUM_COLS - numPriority);
    const regularToFit = restBucket.slice(0, maxRegular);
    const ordered = regularToFit.concat(priorityBucket);

    // ---- Pagination: chart holds 50 patients × 35 meds per page ----
    // For >50 patients OR >35 meds, generate multiple pages.
    // For now, generate ONE page per chunk of 50 patients, with the
    // first 35 meds on page 1, next 35 on page 2, etc.
    const PATIENTS_PER_PAGE = 50;
    const MEDS_PER_PAGE = G.NUM_COLS;
    const numPatientPages = Math.max(1, Math.ceil(occupiedRows.length / PATIENTS_PER_PAGE));
    const numMedPages = Math.max(1, Math.ceil(ordered.length / MEDS_PER_PAGE));
    const totalPages = numPatientPages * numMedPages;

    console.log(`[chart-image] Patients: ${occupiedRows.length} (pages: ${numPatientPages}), ` +
                `Meds: ${ordered.length} (pages: ${numMedPages}), Total pages: ${totalPages}`);

    // ---- Load template image ----
    const templateImg = await loadImage(TEMPLATE_URL);

    // ---- Generate each page ----
    const pages = [];
    for (let pp = 0; pp < numPatientPages; pp++) {
      const patientStart = pp * PATIENTS_PER_PAGE;
      const pagePatients = occupiedRows.slice(patientStart, patientStart + PATIENTS_PER_PAGE);

      for (let mp = 0; mp < numMedPages; mp++) {
        const medStart = mp * MEDS_PER_PAGE;
        const pageMeds = ordered.slice(medStart, medStart + MEDS_PER_PAGE);

        const canvas = document.createElement("canvas");
        canvas.width = G.IMG_W;
        canvas.height = G.IMG_H;
        const ctx = canvas.getContext("2d");

        // Draw the template
        ctx.drawImage(templateImg, 0, 0, G.IMG_W, G.IMG_H);

        // Set default text rendering
        ctx.fillStyle = "#000";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        // Use a font that supports Arabic; browser will fall back to
        // Tajawal/Cairo if specified in CSS, or use system Arabic font
        ctx.font = `bold ${Math.round(G.ROW_HEIGHT * 0.55)}px Tajawal, Cairo, Arial, sans-serif`;

        // ---- Draw medication names in the header (vertical) ----
        ctx.save();
        pageMeds.forEach((m, colIdx) => {
          if (!m) return;
          const label = m.nameTrade || m.nameAr || m.nameEn || m.id;
          drawVerticalText(ctx, label, colIdx);
        });
        ctx.restore();

        // ---- Build med id → col index map ----
        const medCol = {};
        pageMeds.forEach((m, i) => { if (m && m.id) medCol[m.id] = i; });

        // ---- Draw patient names + frequency cells ----
        // Patient name font (slightly larger)
        const nameFont = `bold ${Math.round(G.ROW_HEIGHT * 0.6)}px Tajawal, Cairo, Arial, sans-serif`;
        const freqFont = `bold ${Math.round(G.ROW_HEIGHT * 0.7)}px Tajawal, Arial, sans-serif`;

        pagePatients.forEach((patient, rowIdx) => {
          const name = (patient && patient.name) ? patient.name : "";
          if (!name) return;

          // Patient name in leftmost column
          const cellCx = (G.PATIENT_COL_LEFT + G.PATIENT_COL_RIGHT) / 2;
          const cellCy = rowIdx === 0
            ? (G.HEADER_BOTTOM + G.H_LINES[0]) / 2
            : (G.H_LINES[rowIdx - 1] + G.H_LINES[rowIdx]) / 2;
          ctx.font = nameFont;
          ctx.direction = "rtl";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(name, cellCx, cellCy);

          // Frequency cells
          ctx.font = freqFont;
          ctx.direction = "ltr";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          const myMedCounts = {};
          (patient.medications || []).forEach(pm => {
            if (!pm || !pm.id) return;
            const freq = pm.frequency || "";
            const match = freq.match(/×\s*(\d+)/);
            let n;
            if (match) n = parseInt(match[1], 10);
            else {
              const plainNum = parseInt(freq, 10);
              n = isNaN(plainNum) ? 0 : plainNum;
            }
            myMedCounts[pm.id] = { count: n, freq: freq };
          });

          Object.keys(myMedCounts).forEach(medId => {
            if (!(medId in medCol)) return;
            const colIdx = medCol[medId];
            const entry = myMedCounts[medId];
            let cellText = "";
            if (entry.count > 0) cellText = String(entry.count);
            else cellText = entry.freq || "؟";

            const cx = colIdx === 0
              ? (G.PATIENT_COL_RIGHT + G.V_LINES[0]) / 2
              : (G.V_LINES[colIdx - 1] + G.V_LINES[colIdx]) / 2;
            const cy = rowIdx === 0
              ? (G.HEADER_BOTTOM + G.H_LINES[0]) / 2
              : (G.H_LINES[rowIdx - 1] + G.H_LINES[rowIdx]) / 2;
            ctx.fillText(cellText, cx, cy);
          });
        });

        // ---- Save page as PNG blob ----
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        pages.push({ blob, page: pp * numMedPages + mp + 1, total: totalPages });
      }
    }

    return pages;
  }

  // ---- Helper: load an image ----
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // ---- Helper: draw vertical text in a header column ----
  // The chart's header row uses vertical text (writing-mode: vertical-rl).
  // We rotate the canvas 90° and draw the text, then restore.
  function drawVerticalText(ctx, text, colIdx) {
    const cellLeft = colIdx === 0 ? G.PATIENT_COL_RIGHT : G.V_LINES[colIdx - 1];
    const cellRight = G.V_LINES[colIdx];
    const cx = (cellLeft + cellRight) / 2;
    const cyBottom = G.HEADER_BOTTOM - 4;

    // Save context, translate to bottom-center of column, rotate -90°
    ctx.save();
    ctx.translate(cx, cyBottom);
    ctx.rotate(-Math.PI / 2);

    // Now text drawn at (0,0) appears vertically reading top→bottom
    // of the column. textBaseline='bottom' anchors the bottom of the
    // text at y=0 (which is at the bottom of the cell after rotation).
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.direction = "ltr";  // English med names are LTR
    ctx.font = `bold ${Math.round(G.COL_WIDTH * 0.85)}px Tajawal, Cairo, Arial, sans-serif`;
    ctx.fillStyle = "#000";

    // Cap text length to fit in the header height
    const maxHeight = G.HEADER_HEIGHT - 8;
    let displayText = text;
    // Measure width (which becomes height after rotation)
    const metrics = ctx.measureText(displayText);
    if (metrics.width > maxHeight) {
      // Truncate with ellipsis
      const charWidth = metrics.width / displayText.length;
      const maxChars = Math.floor(maxHeight / charWidth) - 1;
      displayText = displayText.slice(0, maxChars) + "…";
    }

    ctx.fillText(displayText, 0, 0);
    ctx.restore();
  }

  // ---- Trigger download for a single PNG blob ----
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

  // ---- Generate + auto-download chart pages ----
  // Called by the UI button. Uses the same data as the existing
  // HTML chart (state.patients + state.meds + state.supplyDistribution).
  async function printChartImage(state) {
    if (!state) {
      alert("لا توجد بيانات للطباعة");
      return;
    }
    const pages = await generateChartImage(
      state.patients, state.meds, state.supplyDistribution
    );
    pages.forEach((p, i) => {
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `chart-${stamp}-page${p.page}-of-${p.total}.png`;
      downloadBlob(p.blob, name);
    });
  }

  // ---- Exports ----
  global.PharmacyChartImage = {
    generateChartImage,
    printChartImage
  };

})(window);
