// Pills form overlay generator
// =========================================================
// Generates the "استمارة اعطاء الحبوب" (Pill Dispensing Form) as a
// downloadable PNG. Uses a scanned blank form template
// (img/pills-form-template.png) and overlays the hospital/department
// title + 3 column labels.
//
// Layout (measured from the blank form, 1654×2339px @ 300 DPI = A4):
//   - Page header area: y=0-322 (above the table)
//       Three lines centered on the page:
//         "مستشفى بغداد التعليمي"
//         "الصيدلية السريرية"
//         "استمارة اعطاء الحبوب"
//   - Table first row: y=322-388 (63px tall) — column labels row
//       Col 1 (rightmost, V_LINES[0..1] = 133-778, 645px wide): "العلاج"
//       Col 2 (V_LINES[1..2] = 778-981, 203px wide): "الجرعة"
//       Col 3 (V_LINES[2..3] = 981-1206, 225px wide): "طريقة الاستخدام"
//       Col 4 (V_LINES[3..4] = 1206-1529, 323px wide): left blank
//         (signature/notes column)
//   - Data rows: y=388-1958 (8 rows of 185px each — left blank for
//     the pharmacist to fill in)

(function (global) {
  "use strict";

  const TEMPLATE_URL = "img/pills-form-template.png";

  // Grid geometry — measured from the uploaded blank form (1654×2339px)
  const G = {
    IMG_W: 1654, IMG_H: 2339,
    // Vertical grid lines (X coordinates of line centers, left → right)
    V_LINES: [133, 778, 981, 1206, 1529],
    // Horizontal grid lines (Y coordinates, top → bottom)
    H_LINES: [322, 388, 454, 642, 830, 1018, 1206, 1394, 1582, 1770, 1958]
  };

  // Helper: load image
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // Helper: trigger download
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

  // Draw a single Arabic text line centered on (cx, cy).
  // Arabic text is shaped correctly by the browser when drawn with
  // ctx.fillText — no need for arabic_reshaper/bidi in JS.
  function drawArabicLine(ctx, text, cx, cy, fontPx, bold = true) {
    ctx.font = `${bold ? "bold " : ""}${fontPx}px Tajawal, Cairo, Arial, sans-serif`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Note: do NOT set ctx.direction = "rtl" — modern browsers shape
    // Arabic correctly without it, and the property can cause alignment
    // quirks. textAlign="center" + the page's RTL direction handles
    // proper Arabic rendering.
    ctx.fillText(text, cx, cy);
  }

  // Main entry — generate the pills form PNG and download it.
  // No data inputs needed — the form is a fixed template with fixed
  // labels (no patient-specific content).
  async function generatePillsForm() {
    // Load template
    const templateImg = await loadImage(TEMPLATE_URL);

    // Create canvas at template's native resolution
    const canvas = document.createElement("canvas");
    canvas.width = G.IMG_W;
    canvas.height = G.IMG_H;
    const ctx = canvas.getContext("2d");

    // Draw the blank template
    ctx.drawImage(templateImg, 0, 0, G.IMG_W, G.IMG_H);

    // ---- 1. Page header: 3 lines centered horizontally ----
    // The user requested the header text be moved down a bit from the
    // top of the page (was at y=80, now at y=130).
    const page_cx = G.IMG_W / 2;
    const header_lines = [
      "مستشفى بغداد التعليمي",
      "الصيدلية السريرية",
      "استمارة اعطاء الحبوب"
    ];
    const header_font_px = 48;
    const line_h = 60;  // 48px font + 12px gap
    const header_top_y = 130;  // moved down from 80 per user request

    header_lines.forEach((line, i) => {
      drawArabicLine(ctx, line, page_cx, header_top_y + i * line_h, header_font_px);
    });

    // ---- 2. Column labels in the SECOND table row (y=388-454, 63px) ----
    // The user said "في الصف الثاني" — the SECOND row of the table, not
    // the first. The first row (y=322-388) is left blank (it may be
    // used by the pharmacist for header info or notes); the labels
    // go in the second row (y=388-454).
    //
    // RTL layout: V_LINES[0]=133 is the LEFT edge of the page (in pixel
    // coordinates), and V_LINES[4]=1529 is the RIGHT edge. So:
    //   - Rightmost column (RTL "first")  = V_LINES[3..4] = x=1206..1529
    //   - Middle-right column             = V_LINES[2..3] = x=981..1206
    //   - Middle-left column               = V_LINES[1..2] = x=778..981
    //   - Leftmost column                  = V_LINES[0..1] = x=133..778
    //
    // User's mapping (RTL Arabic reading order, rightmost = first):
    //   العامود الأول (rightmost): "العلاج"          → V_LINES[3..4]
    //   العامود الثاني:           blank              → V_LINES[2..3]
    //   العامود الثالث:           "الجرعة"           → V_LINES[1..2]
    //   العامود الرابع (leftmost): "طريقة الاستخدام" → V_LINES[0..1]
    const row_top = G.H_LINES[1];  // 388 — top of the SECOND row
    const row_bot = G.H_LINES[2];  // 454 — bottom of the SECOND row
    const row_cy = (row_top + row_bot) / 2;  // 421
    const label_font_px = 32;

    // Col 1 (RIGHTMOST in RTL, V_LINES[3..4]): "العلاج" (medication name)
    const col1_cx = (G.V_LINES[3] + G.V_LINES[4]) / 2;
    drawArabicLine(ctx, "العلاج", col1_cx, row_cy, label_font_px);

    // Col 2 (V_LINES[2..3]): LEFT BLANK (per user request — was "الجرعة"
    // before, now moved to col 3)

    // Col 3 (V_LINES[1..2]): "الجرعة" (dose)
    const col3_cx = (G.V_LINES[1] + G.V_LINES[2]) / 2;
    drawArabicLine(ctx, "الجرعة", col3_cx, row_cy, label_font_px);

    // Col 4 (LEFTMOST, V_LINES[0..1]): "طريقة الاستخدام" (usage method)
    const col4_cx = (G.V_LINES[0] + G.V_LINES[1]) / 2;
    drawArabicLine(ctx, "طريقة الاستخدام", col4_cx, row_cy, label_font_px);

    // ---- Convert to PNG blob and download ----
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `pills-form-${stamp}.png`;
    downloadBlob(blob, filename);
    return { blob, filename };
  }

  // ---- Public API ----
  global.PharmacyPillsForm = {
    generatePillsForm
  };

})(window);
