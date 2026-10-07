// Chart Bridge — sends patient data to the external "جارت الجارت" app
// ============================================================
// Based on the user's snippet — collects occupied patients from the
// app's state (same data the chart-print button uses), builds a TSV
// table (med names as columns, patients as rows, doses as cells),
// and opens the external جارت الجارت URL with the TSV encoded in the
// hash fragment. The جارت الجارت app reads the hash, decodes the
// TSV, and auto-fills its grid.
//
// NOTE: CHART_URL is currently a placeholder. Replace it with the
// actual URL you use daily to open جارت الجارت.

(function (global) {
  "use strict";

  /* ================= جسر الجارت ================= */
  const CHART_URL = "https://clinical-pharmacy-app.onrender.com/";

  /* ⚠️ collectPatientsFromApp() — جمع المرضى من بيانات التطبيق
     نستخدم نفس البيانات التي يمر عليها زر الطباعة عندنا:
     - نمر على كل غرف الـ Ward.ROOMS وكل سرير فيها
     - لو السرير مشغول (له اسم) نجمعه + أدويته
     - نحول كل دواء إلى {name, freq} باستخدام getLabel للأسماء الإنجليزية

     Optionally accepts a `supplyDistribution` map (supplyId →
     { bedKey: freq }) so the supplies the user just distributed via
     the supply-order modal are injected into each patient's meds
     list — same way the med-summary modal does it. */
  function collectPatientsFromApp(state, supplyDistribution) {
    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS || !state || !state.patients) return [];

    // Build a supply catalog lookup so we can get the supply's
    // English name + the supply-id → bedKey → freq mapping.
    const supplyCatalog = {};
    (state.medications || []).forEach(m => {
      if (m && m.id && (m.form === "supplies" || m.category === "supplies")) {
        supplyCatalog[m.id] = m;
      }
    });

    const out = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;

        const meds = (Array.isArray(p.medications) ? p.medications : [])
          .filter(pm => pm && pm.id !== "syringe-5cc")
          .map(pm => {
            const catalog = (state.medications || []).find(m => m && m.id === pm.id);
            const source = catalog || pm;
            // Prefer English name (matches the patient-sheet requirement)
            const name = source.nameEn || source.nameTrade || source.nameAr || source.name || source.id || "";
            const freq = pm.frequency || (catalog ? catalog.defaultFrequency : "") || "";
            return { name: name, freq: freq };
          });

        // Inject distributed supplies as additional "meds" so the
        // جارت الجارت chart shows them with their frequencies.
        // supplyDistribution: { supplyId: { bedKey: freq, ... }, ... }
        if (supplyDistribution && typeof supplyDistribution === "object") {
          Object.keys(supplyDistribution).forEach(supplyId => {
            const dist = supplyDistribution[supplyId];
            if (!dist || typeof dist !== "object") return;
            const freq = dist[key];  // frequency assigned to THIS patient
            if (!freq) return;       // this patient didn't get this supply
            const catalog = supplyCatalog[supplyId];
            const name = (catalog && (catalog.nameEn || catalog.nameTrade || catalog.nameAr))
              || supplyId;
            meds.push({ name: name, freq: String(freq) });
          });
        }

        out.push({
          name: p.name.trim(),
          id: p.plateNumber || "",   // رقم الطبلة — اختياري
          meds: meds
        });
      });
    });
    return out;
  }

  /* تحويل التكرار إلى الرقم المكتوب في خانة الجارت
     مثلاً: "2x1" → "2"  /  "1×3" → "1"  /  "3" → "3"
     نطابق أنماط: NxN (حروف x أو ×) أو رقم مفرد */
  function freqToDose(freq) {
    if (!freq) return "1";
    const m = String(freq).match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (m) return m[1];
    const n = parseInt(freq, 10);
    if (!isNaN(n) && n > 0) return String(n);
    return "1";   // القيمة الافتراضية للتكرارات غير الرقمية (مثل "حسب القياس")
  }

  function buildChartTSV(state, supplyDistribution) {
    const patients = collectPatientsFromApp(state, supplyDistribution);

    // رؤوس الأعمدة: كل دواء فريد يظهر مرة واحدة فقط
    const medOrder = [];
    for (const p of patients)
      for (const m of p.meds)
        if (!medOrder.includes(m.name)) medOrder.push(m.name);

    // الصف الأول: خليتان فارغتان (اسم + رقم) + أسماء الأدوية
    const rows = [["", "", ...medOrder].join("\t")];

    // بقية الصفوف: صف لكل مريض
    for (const p of patients) {
      const doses = medOrder.map(() => "");
      for (const m of p.meds) {
        const idx = medOrder.indexOf(m.name);
        if (idx >= 0) doses[idx] = freqToDose(m.freq);
      }
      rows.push([p.name ?? "", p.id ?? "", ...doses].join("\t"));
    }
    return rows.join("\n");
  }

  /* الزر — يُربط في app.js */
  async function sendChart(state, supplyDistribution) {
    const tsv = buildChartTSV(state, supplyDistribution);
    // قناة احتياطية: الحافظة (لو فشل النقل المباشر اضغط Alt+V في الجارت)
    try { await navigator.clipboard.writeText(tsv); } catch (e) {}
    // القناة الرئيسية: البيانات داخل الرابط (hash fragment)
    const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(tsv))));
    window.open(CHART_URL + "#cpa=" + payload, "_blank");
    return { ok: true, tsv: tsv };
  }

  /* ---- Exports ---- */
  global.PharmacyChartBridge = {
    sendChart,
    collectPatientsFromApp,
    freqToDose,
    buildChartTSV,
    CHART_URL
  };

})(window);
