// Chart image overlay generator (Reference Image method)
// =========================================================
// Uses the scanned blank "warqat gart" template
// (img/chart-reference.png, 1100×778 px, compressed from 1491×1055)
// and overlays patient names + med names + frequencies using
// HTML5 Canvas. Output is a downloadable PNG — NO printing.
//
// Layout (measured pixel-accurately from the source image):
//   - Outer double border, landscape orientation
//   - Header row: 63 px tall (top of grid)
//   - 35 patient rows × 16 px tall each
//   - Patient name column on RIGHT (102 px wide)
//   - 50 medication columns × ~17 px wide each
//   - Document is RTL, so patient-col (rightmost) = first cell in row
//
// The function is called the same way as UI.buildChartReport but
// instead of building an HTML table, it draws onto a canvas and
// downloads the PNG.

(function (global) {
  "use strict";

  const TEMPLATE_URL = "img/chart-reference.png";

  // Grid geometry — measured from the original 1491×1055 image
  // and scaled to the compressed 1100×778 web image (SCALE=0.7378).
  const G = {
    IMG_W: 1100, IMG_H: 778,
    // Outer grid border (header top edge and bottom edge)
    HEADER_TOP: 60,        // y of header's top line
    HEADER_BOTTOM: 123,    // y of header's bottom line (first patient row top)
    // 37 horizontal grid lines (from top to bottom of grid)
    // H_LINES[0] = header top, H_LINES[1] = header bottom / first row top,
    // H_LINES[i] for i≥1 = top of row i-1, H_LINES[i+1] = bottom of row i-1
    H_LINES: [60, 123, 139, 156, 173, 189, 206, 222, 238, 255, 271, 288,
              304, 321, 337, 353, 370, 387, 404, 420, 436, 452, 469, 485,
              502, 519, 535, 551, 568, 584, 601, 618, 634, 650, 667, 684, 700],
    // 52 vertical grid lines (left → right)
    // V_LINES[0..50] = med col lines (50 med columns)
    // V_LINES[50..51] = patient name col lines (rightmost, widest)
    V_LINES: [55, 72, 90, 108, 125, 143, 162, 179, 197, 215, 232, 251,
              269, 287, 305, 322, 341, 359, 376, 395, 412, 430, 449, 466,
              484, 502, 520, 538, 556, 574, 592, 609, 627, 645, 663, 681,
              699, 717, 735, 752, 770, 788, 806, 824, 843, 860, 878, 896,
              914, 933, 949, 1051],
    NUM_ROWS: 35,
    NUM_COLS: 50,
    HEADER_HEIGHT: 63,
    PATIENT_COL_WIDTH: 102,
    ROW_HEIGHT: 16,
    COL_WIDTH: 17
  };

  // Helper: load an image
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // Helper: trigger download of a Blob
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

  // Main entry — generate a chart PNG and download it
  // @param state — { patients: bedKey→patient, meds: catalog[], supplyDistribution: optional }
  async function generateChartImage(state) {
    if (!state || !state.patients || !state.meds) {
      alert("لا توجد بيانات للطباعة");
      return;
    }

    const Ward = global.PharmacyWard;
    const occupiedRows = [];

    // Build occupied rows from state.patients (in bed order)
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (p && p.name && p.name.trim()) {
          // Deep-copy patient meds and drop legacy 5cc entries
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

    if (occupiedRows.length === 0) {
      alert("لا يوجد مرضى مشغولون");
      return;
    }

    // Inject supply distribution (same as the HTML chart)
    if (state.supplyDistribution && typeof state.supplyDistribution === "object") {
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
      Object.keys(state.supplyDistribution).forEach(supplyId => {
        const dist = state.supplyDistribution[supplyId];
        if (!dist || typeof dist !== "object") return;
        const defaults = supplyDefaults[supplyId] || { nameTrade: supplyId };
        const med = (state.meds || []).find(x => x && x.id === supplyId) || defaults;
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
    const catalogIds = new Set((state.meds || []).map(m => m && m.id).filter(Boolean));
    const prescribedMeds = (state.meds || []).filter(m => prescribedIds.has(m.id));
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

    // Priority supplies at the end (same as HTML chart)
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
    const orderedMeds = regularToFit.concat(priorityBucket);

    // ---- Pagination: 35 patients × 50 meds per page ----
    const PATIENTS_PER_PAGE = G.NUM_ROWS;
    const numPages = Math.max(1, Math.ceil(occupiedRows.length / PATIENTS_PER_PAGE));

    console.log(`[chart-image] patients=${occupiedRows.length}, meds=${orderedMeds.length}, pages=${numPages}`);

    // ---- Load the reference template image ----
    const templateImg = await loadImage(TEMPLATE_URL);

    // ---- Generate each page ----
    const pages = [];
    for (let page = 0; page < numPages; page++) {
      const startIdx = page * PATIENTS_PER_PAGE;
      const pagePatients = occupiedRows.slice(startIdx, startIdx + PATIENTS_PER_PAGE);

      const canvas = document.createElement("canvas");
      canvas.width = G.IMG_W;
      canvas.height = G.IMG_H;
      const ctx = canvas.getContext("2d");

      // Draw the template
      ctx.drawImage(templateImg, 0, 0, G.IMG_W, G.IMG_H);

      // Set up text rendering defaults
      ctx.fillStyle = "#000";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      // ---- Build med id → col index map ----
      // Med col 0 (orderedMeds[0]) is placed at the RIGHTMOST med
      // column (next to patient name col), reading right-to-left
      // (Arabic reading order). visualCol = NUM_COLS - 1 - colIdx.
      // So orderedMeds[0] → visualCol 49 (rightmost, V_LINES[49..50])
      //    orderedMeds[1] → visualCol 48 (V_LINES[48..49])
      //    orderedMeds[49] → visualCol 0 (leftmost, V_LINES[0..1])
      const medCol = {};
      orderedMeds.forEach((m, i) => {
        if (m && m.id) medCol[m.id] = i;
      });

      // ---- Draw medication names in the header row (vertical text) ----
      // Med names start from the RIGHT (near patient col) and go LEFT.
      orderedMeds.forEach((m, colIdx) => {
        if (!m) return;
        const label = m.nameTrade || m.nameAr || m.nameEn || m.id;
        // Flip to visual column: col 0 → rightmost (NUM_COLS-1)
        const visualCol = G.NUM_COLS - 1 - colIdx;
        drawVerticalText(ctx, label, visualCol);
      });

      // ---- Draw patient names + frequency cells ----
      const nameFont = `bold ${Math.round(G.ROW_HEIGHT * 0.7)}px Tajawal, Cairo, Arial, sans-serif`;
      const freqFont = `bold ${Math.round(G.ROW_HEIGHT * 0.85)}px Tajawal, Arial, sans-serif`;

      pagePatients.forEach((patient, rowIdx) => {
        const name = (patient && patient.name) ? patient.name : "";
        if (!name) return;

        // Patient name in the rightmost column (patient name col)
        // Patient col spans V_LINES[50] → V_LINES[51]
        const cellCx = (G.V_LINES[50] + G.V_LINES[51]) / 2;
        // Row Y calculation: row i (0-indexed) spans H_LINES[i+1] → H_LINES[i+2]
        // (H_LINES[0]=header top, H_LINES[1]=header bottom=row 0 top,
        //  H_LINES[2]=row 0 bottom=row 1 top, ...)
        const rowTop = G.H_LINES[rowIdx + 1];
        const rowBot = G.H_LINES[rowIdx + 2];
        const cellCy = (rowTop + rowBot) / 2;

        ctx.font = nameFont;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Note: do NOT set ctx.direction = "rtl" — modern browsers
        // shape Arabic correctly without it, and setting it can
        // cause alignment quirks in some browsers.
        ctx.fillText(name, cellCx, cellCy);

        // Frequency cells in med columns
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

          // Flip to visual column: col 0 → rightmost (NUM_COLS-1)
          const visualCol = G.NUM_COLS - 1 - colIdx;
          // Cell boundaries (using actual grid line positions)
          const cellLeft = G.V_LINES[visualCol];
          const cellRight = G.V_LINES[visualCol + 1];
          const cellCx = (cellLeft + cellRight) / 2;
          // Row Y: row i (0-indexed) spans H_LINES[i+1] → H_LINES[i+2]
          const rowTop = G.H_LINES[rowIdx + 1];
          const rowBot = G.H_LINES[rowIdx + 2];
          const cy = (rowTop + rowBot) / 2;

          // Precise centering: measure the actual text width and
          // position it manually so the GLYPH's visual center (not the
          // bounding-box center) lands on the cell's center.
          // Latin digits in Tajawal have a left-side bearing slightly
          // larger than the right-side bearing, so textAlign="center"
          // leaves the glyph ~2-3px left of the cell center. We use
          // textAlign="left" + measureText to compute the exact X.
          ctx.textAlign = "left";
          const metrics = ctx.measureText(cellText);
          const textW = metrics.width;
          // Bounding-box center should be at cellCx, so left edge at
          // cellCx - textW/2. Then add +2px rightward nudge to shift
          // the visual glyph center onto the cell center.
          const x = cellCx - textW / 2 + 2;
          ctx.fillText(cellText, x, cy);
        });
      });

      // ---- Convert to PNG blob and queue for download ----
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      pages.push({ blob, page: page + 1, total: numPages });
    }

    // ---- Download each page ----
    const stamp = new Date().toISOString().slice(0, 10);
    pages.forEach((p, i) => {
      const name = numPages === 1
        ? `chart-${stamp}.png`
        : `chart-${stamp}-page${p.page}-of-${p.total}.png`;
      // Stagger downloads slightly so the browser doesn't block them
      setTimeout(() => downloadBlob(p.blob, name), i * 200);
    });

    return pages;
  }

  // Draw vertical text in a header column.
  // Text is rotated 90° CW so it reads TOP-TO-BOTTOM, with each
  // character's head pointing to the RIGHT (i.e., the text appears
  // "lying on its right side"). This matches the Arabic reading flow
  // for vertical column headers on the chart paper.
  //
  // Anchor: top-center of the header cell. After rotation, text grows
  // downward from the top, with characters' visual centers on the
  // column's horizontal midline.
  function drawVerticalText(ctx, text, colIdx) {
    const cellLeft = G.V_LINES[colIdx];
    const cellRight = G.V_LINES[colIdx + 1];
    const cx = (cellLeft + cellRight) / 2;
    const cyTop = G.HEADER_TOP + 2;  // top of header, with small inset

    ctx.save();
    ctx.translate(cx, cyTop);
    ctx.rotate(Math.PI / 2);  // 90° CW — text reads top-to-bottom

    ctx.textAlign = "left";       // text grows in local +X (visually DOWN)
    ctx.textBaseline = "middle";  // middle of text height on local Y=0
    ctx.direction = "ltr";
    // Smaller font (COL_WIDTH × 0.65 = ~11px) so the rotated glyphs
    // (~15-16px tall with ascenders/descenders) fit comfortably inside
    // the 17px-wide column without overlapping the vertical grid lines.
    ctx.font = `bold ${Math.round(G.COL_WIDTH * 0.65)}px Tajawal, Cairo, Arial, sans-serif`;
    ctx.fillStyle = "#000";

    // Cap text length to fit header height (text grows downward).
    const maxHeight = G.HEADER_HEIGHT - 4;
    let displayText = text;
    const metrics = ctx.measureText(displayText);
    if (metrics.width > maxHeight) {
      const charWidth = metrics.width / displayText.length;
      const maxChars = Math.floor(maxHeight / charWidth) - 1;
      displayText = displayText.slice(0, maxChars) + "…";
    }

    ctx.fillText(displayText, 0, 0);
    ctx.restore();
  }

  // ---- Public API ----
  global.PharmacyChartImage = {
    generateChartImage,
    downloadBlob  // exposed for tests
  };

})(window);
