/* ============================================================
   app.js
   Application controller: holds in-memory state, wires UI
   events, manages the medication selection flow, and persists
   changes via PharmacyStorage.
   ============================================================ */

(function (global) {
  "use strict";

  // -------- In-memory state (mirror of storage for fast renders) --------
  const state = {
    patients: {},          // bedKey -> patient
    medications: [],       // catalog
    currentBed: null,      // { key, roomId, bed }
    // bottom-sheet selection state
    sheet: {
      open: false,
      activeTab: "vial",         // "vial" (default) | "tablet" — which form is shown
      selected: new Set(),        // med ids
      selectedList: [],          // [{ id, nameTrade, nameAr, nameEn, form, dose, frequency }]
      filter: ""
    },
    // admin editor state
    admin: {
      editingId: null,         // med id being edited; null = new
      isNew: false,
      selectedId: null         // row highlight
    }
  };

  // -------- Shortcuts --------
  const Storage = global.PharmacyStorage;
  const Ward    = global.PharmacyWard;
  const Meds    = global.PharmacyMedications;
  const UI      = global.PharmacyUI;
  const SB      = global.PharmacySupabase;          // may be undefined on very old browsers
  const SBSync  = global.PharmacySupabaseSync;      // may be undefined
  const Auth    = global.PharmacyAuth;             // auth module
  const $ = (id) => document.getElementById(id);

  // -------- Init --------
  function init() {
    hydrate();
    bindAuthEvents();
    bindEvents();
    bindPwaInstall();
    applyRoleVisibility();
    // Show login overlay if not logged in, otherwise show the app
    if (Auth && Auth.isLoggedIn()) {
      showApp();
      refreshAll();
      UI.showView("home");
      pullCatalogOnBoot();
    } else {
      showLogin();
    }
  }

  function hydrate() {
    const data = Storage.loadAll();
    state.patients    = data.patients || {};
    state.medications = data.medications && data.medications.length
      ? data.medications
      : Meds.DEFAULT_MEDICATIONS.slice();
  }

  // -------- Auth: show / hide login screen --------
  // We toggle the `is-authed` / `is-unauthed` class on <html> so the
  // pre-paint CSS gate (in <head>) stays in sync with runtime auth
  // state. The HTML default has `#app` visible and `#login-screen`
  // hidden, but the CSS in <head> overrides that based on the class
  // on <html>, so we must update the class whenever auth state changes
  // (login, logout, session expiry, etc.).
  function setAuthClass(loggedIn) {
    const html = document.documentElement;
    html.classList.toggle("is-authed",   !!loggedIn);
    html.classList.toggle("is-unauthed", !loggedIn);
  }

  function showLogin() {
    setAuthClass(false);
    $("login-screen").hidden = false;
    // Reset any previous form state
    $("login-username").value = "";
    $("login-password").value = "";
    $("login-error").hidden = true;
    // Focus the username field for fast typing on phones
    setTimeout(() => { try { $("login-username").focus(); } catch (e) {} }, 100);
  }

  function showApp() {
    setAuthClass(true);
    $("login-screen").hidden = true;
  }

  // Apply role-based visibility (hide ⚙ from pharmacist role)
  function applyRoleVisibility() {
    if (!Auth) return;
    const isAdmin = Auth.isAdmin();
    const adminBtn = $("open-admin");
    if (adminBtn) adminBtn.hidden = !isAdmin;
    // chart button + sync button + logout button are always visible (both roles)
    const chartBtn = $("print-chart-btn");
    if (chartBtn) chartBtn.hidden = false;
    const syncBtn = $("sync-now-btn");
    if (syncBtn) syncBtn.hidden = false;
    const logoutBtn = $("logout-btn");
    if (logoutBtn) logoutBtn.hidden = false;
  }

  // Bind login form + quick buttons + logout
  function bindAuthEvents() {
    if (!Auth) return;

    // Login form submit
    $("login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const username = $("login-username").value;
      const password = $("login-password").value;
      const res = Auth.login(username, password);
      if (res.ok) {
        onLoginSuccess();
      } else {
        const errEl = $("login-error");
        errEl.textContent = res.error;
        errEl.hidden = false;
      }
    });

    // Quick login button for pharmacist only (admin must use the form
    // with username + password for security).
    $("quick-pharmacist").addEventListener("click", () => {
      const res = Auth.loginAs("pharmacist");
      if (res.ok) onLoginSuccess();
    });

    // Logout button in header
    $("logout-btn").addEventListener("click", () => {
      if (!confirm("هل تريد تسجيل الخروج؟")) return;
      Auth.logout();
      applyRoleVisibility();
      showLogin();
      flashHint("تم تسجيل الخروج");
    });
  }

  function onLoginSuccess() {
    $("login-error").hidden = true;
    applyRoleVisibility();
    showApp();
    refreshAll();
    UI.showView("home");
    pullCatalogOnBoot();
    const user = Auth.getCurrentUser();
    flashHint(`مرحبًا ${user ? user.displayName : ""}`);
  }

  // -------- Supabase: pull catalog on boot --------
  // If Supabase is configured and reachable, replace the local catalog
  // with the cloud version — UNLESS the last push failed recently,
  // in which case the local catalog is fresher and we skip the pull
  // to avoid blowing away local edits that never made it to the cloud.
  async function pullCatalogOnBoot() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      updateSupabaseStatusUI("غير مربوط");
      return;
    }
    updateSupabaseStatusUI("جارٍ المزامنة…", "loading");
    // Pull catalog (medications)
    const res = await SBSync.pullCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
    } else if (res.skipped) {
      updateSupabaseStatusUI("يعمل محليًا · السحب متأخر", "error");
    } else {
      updateSupabaseStatusUI("خطأ: " + res.error, "error");
    }
    // Pull patients too
    const pres = await SBSync.pullPatients();
    if (pres.ok) {
      state.patients = Storage.loadPatients();
      refreshStatsAndRooms();
    }
  }

  // Push the local catalog to Supabase (called after every admin save).
  // If the push fails, the user is shown a clear warning so they know
  // their edits are local-only and won't appear on other devices until
  // the next successful push.
  async function pushCatalogAfterEdit() {
    if (!SB || !SBSync || !SB.isConfigured()) return;
    // Fire-and-forget: the local save is already done, this just syncs
    // to the cloud. If it fails, the user still has their local catalog.
    const res = await SBSync.pushCatalog();
    if (res.ok) {
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
    } else {
      updateSupabaseStatusUI("خطأ في الرفع: " + res.error, "error");
      flashHint("⚠ فشل رفع التعديل للسحابة — محفوظ محليًا فقط");
      console.warn("[Supabase] push failed:", res.error);
      // Retry once after a short delay (network blip recovery)
      setTimeout(() => {
        SBSync.pushCatalog().then(r => {
          if (r.ok) updateSupabaseStatusUI(`مربوط · ${r.count} دواء`, "connected");
        });
      }, 2000);
    }
  }

  // Manual "push now" — used by the manual push button in advanced settings
  async function pushCatalogManual() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ");
      return;
    }
    updateSupabaseStatusUI("جارٍ الرفع…", "loading");
    const res = await SBSync.pushCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم رفع ${res.count} دواء للسحابة`);
    } else {
      updateSupabaseStatusUI("فشل الرفع: " + res.error, "error");
      flashHint("فشل الرفع للسحابة: " + res.error);
    }
  }

  // Manual "pull now" — used by the manual pull button in advanced settings
  async function pullCatalogManual() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ");
      return;
    }
    if (!confirm("سحب الكتالوج من السحابة سيستبدل نسختك المحلية.\nملاحظة: بيانات المرضى لن تُستبدل بل ستُدمج (الأحدث يفوز).\nهل تريد المتابعة؟")) return;
    updateSupabaseStatusUI("جارٍ السحب…", "loading");
    const res = await SBSync.pullCatalog(true);  // force = true
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم سحب ${res.count} دواء من السحابة`);
    } else {
      updateSupabaseStatusUI("فشل السحب: " + res.error, "error");
      flashHint("فشل السحب من السحابة: " + res.error);
    }
    // Also merge-pull patients (non-destructive)
    const pres = await SBSync.pullPatients();
    if (pres.ok) {
      state.patients = Storage.loadPatients();
      refreshStatsAndRooms();
      flashHint(`تم دمج ${pres.count} مريض من السحابة`);
    }
  }

  // -------- Manual sync from the header button --------
  // Single tap → pulls catalog (force) + merge-pulls patients, with
  // a simple success message ("تمت المزامنة بنجاح") or a detailed
  // error message. Disables the button + spins the icon while the
  // sync is running so the user can't double-trigger it.
  let _syncInFlight = false;
  async function syncNow() {
    if (_syncInFlight) return; // prevent double-tap
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ — افتح الإعدادات لربط الحساب");
      return;
    }

    const btn = $("sync-now-btn");
    const wasDisabled = btn ? btn.disabled : false;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-syncing");
    }
    _syncInFlight = true;
    updateSupabaseStatusUI("جارٍ المزامنة…", "loading");

    let okCount = 0;
    let failCount = 0;
    let firstError = "";

    try {
      // 1) Pull catalog (force = true to bypass the "unsynced local
      //    edits" guard, since the user explicitly asked for a sync)
      const cres = await SBSync.pullCatalog(true);
      if (cres.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
        okCount++;
      } else if (cres.skipped) {
        // skipped is not really a failure — local catalog is fresher
        okCount++;
      } else {
        failCount++;
        firstError = firstError || ("الكتالوج: " + cres.error);
      }

      // 2) Merge-pull patients (non-destructive, last-write-wins)
      const pres = await SBSync.pullPatients();
      if (pres.ok) {
        state.patients = Storage.loadPatients();
        refreshStatsAndRooms();
        okCount++;
      } else {
        failCount++;
        firstError = firstError || ("المرضى: " + pres.error);
      }

      // 3) Report result
      if (failCount === 0) {
        updateSupabaseStatusUI(
          `مربوط · ${state.medications.length} دواء · ${Object.keys(state.patients).length} مريض`,
          "connected"
        );
        flashHint("تمت المزامنة بنجاح");
      } else if (okCount === 0) {
        updateSupabaseStatusUI("فشلت المزامنة: " + firstError, "error");
        flashHint("فشلت المزامنة: " + firstError);
      } else {
        // partial: one part failed, the other succeeded
        updateSupabaseStatusUI("مزامنة جزئية — فشل: " + firstError, "error");
        flashHint("مزامنة جزئية — فشل: " + firstError);
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      updateSupabaseStatusUI("فشلت المزامنة: " + msg, "error");
      flashHint("فشلت المزامنة: " + msg);
    } finally {
      _syncInFlight = false;
      if (btn) {
        btn.classList.remove("is-syncing");
        btn.disabled = wasDisabled;
      }
    }
  }

  // -------- iOS PWA print workaround --------
  // window.print() doesn't work in iOS Safari's standalone mode
  // (when the app is added to the home screen). The workaround: open
  // a NEW Safari tab containing only the chart + the print CSS, then
  // call window.print() inside that new tab. Safari proper has full
  // AirPrint support, so the print dialog opens normally.
  //
  // Returns true if the new window was opened successfully, false
  // otherwise (popup blocked, no permission, etc.).
  function printChartInNewWindow() {
    const chartRoot = document.getElementById("chart-print-root");
    if (!chartRoot) return false;

    // Get the chart HTML (already built by UI.buildChartReport)
    const chartHTML = chartRoot.innerHTML;

    // Open a new tab. _blank + no features so iOS Safari opens a
    // full Safari tab (not a PWA child window).
    const printWindow = window.open("", "_blank");
    if (!printWindow) return false; // popup blocked

    // Self-contained HTML doc with:
    // - Google Fonts (Tajawal, Cairo) for proper Arabic rendering
    // - The chart print CSS (extracted from styles.css, no @media
    //   print wrapper needed since the whole document is the print
    //   content)
    // - The chart HTML
    // - An inline script that triggers print() after the fonts
    //   have had a chance to load, then closes the tab.
    const doc = printWindow.document;
    doc.open();
    doc.write([
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>طباعة التشارت</title>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">',
      '<style>',
      '@page { size: A4 landscape; margin: 3mm; }',
      'body { background: #fff; margin: 0; padding: 0; color: #000; font-family: "Tajawal", "Cairo", "Arial", sans-serif; }',
      '.chart-print-root { display: block; }',
      '.chart-page { display: block; }',
      '.chart-matrix { width: 100%; border-collapse: collapse; font-size: 7px; table-layout: fixed; }',
      '.chart-patient-col-header { background: #fff; color: #000; font-weight: 800; padding: 1px 2px; border: 1px solid #000; text-align: center; font-size: 10px; width: 70px; min-width: 70px; vertical-align: middle; line-height: 1.3; }',
      '.chart-med-col-header { background: #fff; color: #000; border: 1px solid #000; padding: 1px 0; text-align: center; vertical-align: middle; height: 81px; width: 18px; min-width: 18px; }',
      '.chart-med-label { writing-mode: vertical-rl; text-orientation: mixed; font-size: 11px; font-weight: 700; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-height: 75px; margin: auto 0; display: block; }',
      '.chart-patient-cell { background: #fff; font-weight: 700; padding: 0 3px; border: 1px solid #000; text-align: center; vertical-align: middle; width: 70px; min-width: 70px; height: 18px; font-size: 9px; color: #000; line-height: 18px; }',
      '.chart-cell { border: 1px solid #000; text-align: center; vertical-align: middle; padding: 0; font-size: 11px; font-weight: 800; color: #000; width: 18px; min-width: 18px; height: 18px; line-height: 18px; background: #fff; box-sizing: border-box; }',
      '.chart-matrix tr { height: 18px; }',
      '.chart-cell-custom { font-size: 8px; font-weight: 700; line-height: 1; }',
      '.chart-page-break { page-break-before: always; }',
      '.chart-matrix th, .chart-matrix td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      '</style>',
      '</head>',
      '<body>',
      '<div class="chart-print-root">',
      chartHTML,
      '</div>',
      '<script>',
      // Wait for fonts to load before printing. We try a few
      // strategies: (1) wait for window.load (fonts cached), then
      // (2) wait a short delay to ensure layout has settled.
      'window.addEventListener("load", function() {',
      // 800ms gives the fonts time to load even on slow networks.
      // The chart is already rendered visually; print is just
      // snapshotting what's on screen.
      '  setTimeout(function() {',
      '    try { window.print(); } catch (e) {}',
      // Try to close the tab after printing. iOS Safari may block
      // window.close() for tabs the user opened (vs. those opened
      // by script), but since we opened this via window.open(), it
      // should be closeable. Wrap in try/catch in case it isn't.
      '    setTimeout(function() { try { window.close(); } catch (e) {} }, 1000);',
      '  }, 800);',
      '});',
      '<\/script>',
      '</body>',
      '</html>'
    ].join('\n'));
    doc.close();
    return true;
  }

  // Update the small status badge in the Supabase settings panel.
  function updateSupabaseStatusUI(text, kind) {
    const el = $("sb-status");
    if (!el) return;
    el.textContent = "الحالة: " + text;
    el.classList.remove("is-connected", "is-error", "is-loading");
    if (kind === "connected") el.classList.add("is-connected");
    else if (kind === "error") el.classList.add("is-error");
    else if (kind === "loading") el.classList.add("is-loading");
  }

  // Pre-fill the Supabase settings inputs if already configured.
  function refreshSupabaseInputs() {
    if (!SB) return;
    const cfg = SB.loadConfig();
    if (cfg) {
      $("sb-url").value = cfg.url || "";
      $("sb-key").value = cfg.anonKey || "";
    }
  }

  // -------- Render refresh --------
  function refreshAll() {
    UI.renderStats(state.patients);
    UI.renderRooms(state.patients);
    UI.renderPatientsList(state.patients);
    if (state.currentBed) {
      const p = state.patients[state.currentBed.key] || null;
      UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
    }
  }

  function refreshPatientViewOnly() {
    if (!state.currentBed) return;
    const p = state.patients[state.currentBed.key] || null;
    UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
  }

  function refreshStatsAndRooms() {
    UI.renderStats(state.patients);
    UI.renderRooms(state.patients);
    UI.renderPatientsList(state.patients);
  }

  // -------- Patient helpers --------
  function ensurePatient(bedKey) {
    if (!state.patients[bedKey]) state.patients[bedKey] = { name: "", medications: [] };
    if (!Array.isArray(state.patients[bedKey].medications)) {
      state.patients[bedKey].medications = [];
    }
    return state.patients[bedKey];
  }
  function persistPatient(bedKey) {
    Storage.upsertPatient(bedKey, state.patients[bedKey]);
    refreshStatsAndRooms();
    // Push patients to Supabase (fire-and-forget, with one retry)
    if (SBSync && SBSync.pushPatients) {
      SBSync.pushPatients().then(r => {
        if (!r.ok) {
          console.warn("[Supabase] patient push failed, retrying once:", r.error);
          // Retry once after a short delay (network blip recovery)
          setTimeout(() => {
            SBSync.pushPatients().then(r2 => {
              if (!r2.ok) console.warn("[Supabase] patient push retry failed:", r2.error);
            });
          }, 2000);
        }
      });
    }
  }

  // -------- Auto-managed syringe entry (one per patient) --------
  // The '5cc Syringe' supply (id: syringe-5cc) is auto-managed for
  // each patient. There is at most ONE syringe entry per patient,
  // and its frequency reflects the TOTAL number of syringes needed
  // across all the patient's vials and ampules.
  //
  // COUNTING RULE (the user's clinical rule):
  //   - For each vial/ampule on the patient, parse its frequency
  //     (e.g. '1×2' → 2). The number after '×' is how many times
  //     per day the medication is administered, and each administration
  //     needs a fresh syringe.
  //   - Sum those numbers across all vials + ampules → total syringe
  //     count for the day.
  //   - For non-numeric frequencies ('حسب القياس', 'حسب البروتوكول',
  //     'حسب الحاجة', etc.) → count as 1 syringe (assumption: the
  //     medication IS administered at least once, just not on a
  //     fixed schedule).
  //
  // Example:
  //   Ceftriaxone (vial, 1×2) + Vancomycin (vial, 1×2) → 2 + 2 = 4
  //   → syringe entry has frequency '1×4' → chart shows '4'
  //
  // The rest of the rule (one entry per patient, auto-add/remove,
  // recompute on every change) stays the same as before.
  function _syringesForFrequency(freq) {
    if (!freq || typeof freq !== "string") return 1; // treat missing as 1
    // Look for the pattern `×N` or `xN` (any multiplication mark)
    // followed by a number.
    const m = freq.match(/[×x]\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    // Non-numeric frequency (e.g. 'حسب القياس') → assume 1
    return 1;
  }

  function recomputeSyringeForPatient(patient, catalog) {
    if (!patient || !Array.isArray(patient.medications)) return;
    if (!Array.isArray(catalog)) return;

    const syringeMed = catalog.find(m => m && m.id === "syringe-5cc");
    if (!syringeMed) return; // user deleted syringe from catalog

    // Sum the per-dose counts across all vials + ampules on the
    // patient. Each vial/ampule's frequency tells us how many
    // times/day it's administered, and each administration needs a
    // fresh syringe.
    let totalSyringes = 0;
    let hasInjections = false;
    patient.medications.forEach(pm => {
      if (!pm) return;
      if (pm.form === "vial" || pm.form === "ampule") {
        hasInjections = true;
        totalSyringes += _syringesForFrequency(pm.frequency);
      }
    });

    // Find all syringe entries (there could be 0, 1, or more if the
    // user manually added one). We consolidate to at most one.
    const syringeIndices = [];
    patient.medications.forEach((pm, i) => {
      if (pm && pm.id === "syringe-5cc") syringeIndices.push(i);
    });

    if (!hasInjections || totalSyringes === 0) {
      // No injections → remove all syringe entries (no syringe needed)
      for (let i = syringeIndices.length - 1; i >= 0; i--) {
        patient.medications.splice(syringeIndices[i], 1);
      }
    } else {
      // Has injections → ensure exactly one syringe entry with
      // frequency = `1×N` where N = totalSyringes
      const newFreq = "1×" + totalSyringes;
      if (syringeIndices.length === 0) {
        // Add a new syringe entry
        patient.medications.push({
          id:        "syringe-5cc",
          nameTrade: syringeMed.nameTrade,
          nameAr:    syringeMed.nameAr    || "",
          nameEn:    syringeMed.nameEn    || "",
          form:      "supplies",
          dose:      syringeMed.defaultDose      || "1 سرنجة",
          frequency: newFreq
        });
      } else {
        // Update the first syringe entry, remove any duplicates
        patient.medications[syringeIndices[0]].frequency = newFreq;
        for (let i = syringeIndices.length - 1; i >= 1; i--) {
          patient.medications.splice(syringeIndices[i], 1);
        }
      }
    }
  }

  // -------- PWA install button (Android Chrome / Edge / etc.) --------
  // The browser fires `beforeinstallprompt` when it considers the
  // site installable (manifest + SW + served over HTTPS). We capture
  // the event, show the install button, and on click call prompt().
  // On iOS Safari there's no `beforeinstallprompt` — the user must
  // tap Share → Add to Home Screen manually. We detect iOS and show
  // a one-time hint explaining how to do it.
  let deferredInstallPrompt = null;

  function bindPwaInstall() {
    const btn = $("install-app-btn");
    if (!btn) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    // If already installed/running as standalone, hide the button.
    if (isStandalone) {
      btn.hidden = true;
      return;
    }

    // Always show the install button on the login screen (not just
    // when the browser fires beforeinstallprompt — Chrome on desktop
    // sometimes never fires it even when the app is technically
    // installable, and we want the user to always have a way to
    // install via the button).
    btn.hidden = false;

    // Capture the event when it does fire so we can use the native
    // prompt (better UX than instructions).
    window.addEventListener("beforeinstallprompt", (e) => {
      // Prevent the mini-infobar from showing on Android Chrome
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    btn.addEventListener("click", async () => {
      // iOS Safari → show instructions (no native prompt available)
      if (isIOS && !deferredInstallPrompt) {
        showIosInstallHint();
        return;
      }
      // Android/Chrome with native prompt → use it
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") {
          flashHint("تم تثبيت التطبيق على جهازك");
        }
        deferredInstallPrompt = null;
        btn.hidden = true;
        return;
      }
      // No native prompt available (desktop Chrome without
      // engagement, Firefox, etc.) → show generic browser-menu
      // instructions.
      showGenericInstallHint();
    });

    // Once installed, hide the button for good.
    window.addEventListener("appinstalled", () => {
      btn.hidden = true;
      flashHint("تم تثبيت التطبيق بنجاح");
    });
  }

  function showGenericInstallHint() {
    // Generic instructions for browsers without a native prompt.
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
    const isEdge   = /Edg/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);

    let browserName = "متصفحك";
    let steps = "";
    if (isChrome) {
      browserName = "Google Chrome";
      steps = "1) افتح قائمة Chrome (⋮ في أعلى اليمين)\n2) اختر \"تثبيت التطبيق\" أو \"Install app\"\n3) اضغط \"تثبيت\"";
    } else if (isEdge) {
      browserName = "Microsoft Edge";
      steps = "1) افتح قائمة Edge (⋯ في أعلى اليمين)\n2) اختر \"التطبيقات\" → \"تثبيت هذا الموقع كتطبيق\"\n3) اضغط \"تثبيت\"";
    } else if (isFirefox) {
      browserName = "Firefox";
      steps = "1) لا يدعم Firefox تثبيت PWA رسميًا\n2) يمكنك إضافة اختصار للصفحة الرئيسية بدلاً من ذلك";
    } else {
      steps = "ابحث في قائمة المتصفح عن خيار \"تثبيت التطبيق\" أو \"Install app\"";
    }
    alert(
      "لتثبيت التطبيق عبر " + browserName + ":\n\n" + steps + "\n\n" +
      "ملاحظة: يجب فتح الموقع عبر HTTPS حتى يتوفر خيار التثبيت."
    );
  }

  function showIosInstallHint() {
    // Lightweight instructions for iOS Safari (no native prompt).
    confirm(
      "لتثبيت التطبيق على iPhone/iPad:\n\n" +
      "1) افتح هذا الرابط في متصفح Safari\n" +
      "2) اضغط زر المشاركة (المربع مع السهم لأعلى)\n" +
      "3) اختر \"إضافة إلى الشاشة الرئيسية\"\n" +
      "4) اضغط \"إضافة\"\n\n" +
      "هل تريد إغلاق هذه الرسالة؟"
    );
  }

  // -------- Event wiring --------
  function bindEvents() {
    // Room/bed tap (event delegation on rooms grid)
    $("rooms-grid").addEventListener("click", (e) => {
      const btn = e.target.closest(".bed-btn");
      if (!btn) return;
      openPatient({
        key:    btn.dataset.key,
        roomId: parseInt(btn.dataset.roomId, 10),
        bed:    parseInt(btn.dataset.bed, 10)
      });
    });

    // Patients list tap
    $("patients-list").addEventListener("click", (e) => {
      const row = e.target.closest(".patient-row");
      if (!row) return;
      openPatient({
        key:    row.dataset.key,
        roomId: parseInt(row.dataset.roomId, 10),
        bed:    parseInt(row.dataset.bed, 10)
      });
    });

    // Patient name input — save on blur, debounced
    let nameTimer = null;
    $("patient-name-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.name = e.target.value;
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => persistPatient(state.currentBed.key), 400);
    });
    $("patient-name-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(nameTimer);
      // collapse empty-name patient (no name and no meds)
      const p = state.patients[state.currentBed.key];
      if (p && (!p.name || !p.name.trim()) && (!p.medications || p.medications.length === 0)) {
        const bedKey = state.currentBed.key;
        Storage.deletePatient(bedKey);
        delete state.patients[bedKey];
        // Propagate the collapse to the cloud so it doesn't come back
        // on the next pull (which would otherwise merge it back in).
        if (SBSync && SBSync.pushPatientDelete) {
          SBSync.pushPatientDelete(bedKey).then(r => {
            if (!r.ok) console.warn("[Supabase] auto-collapse delete failed:", r.error);
          });
        }
      } else {
        persistPatient(state.currentBed.key);
      }
      refreshStatsAndRooms();
    });

    // Back button
    $("back-btn").addEventListener("click", () => {
      state.currentBed = null;
      UI.showView("home");
    });

    // Open sheet (in patient view) — single binding
    $("open-med-sheet").addEventListener("click", openSheetFromPatientView);

    // Meds list — delete & edit (event delegation)
    $("meds-list").addEventListener("click", (e) => {
      const del = e.target.closest('[data-action="delete-med"]');
      if (!del || !state.currentBed) return;
      const idx = parseInt(del.dataset.medIndex, 10);
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      p.medications.splice(idx, 1);
      // Recompute the auto-managed syringe entry: if a vial/ampule
      // was deleted, the syringe's count needs to drop; if the user
      // deleted the syringe itself, the recompute re-adds it (since
      // the rule says: syringe exists iff there are vials/ampules).
      recomputeSyringeForPatient(p, state.medications);
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });
    $("meds-list").addEventListener("input", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex) return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      if (t.dataset.field === "dose") {
        p.medications[idx].dose = t.value;
      } else if (t.dataset.field === "frequency") {
        p.medications[idx].frequency = t.value;
      }
      clearTimeout(p._saveTimer);
      p._saveTimer = setTimeout(() => {
        // Recompute the syringe in case the user edited it manually
        // (the syringe's frequency is system-managed and should
        // always reflect the vial + ampule count, not the user's
        // manual edit). If they edited a non-syringe med, the
        // recompute is a no-op.
        recomputeSyringeForPatient(p, state.medications);
        persistPatient(state.currentBed.key);
        refreshPatientViewOnly();
      }, 400);
    });
    $("meds-list").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex || t.dataset.field !== "frequency") return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      p.medications[idx].frequency = t.value;
      // Same recompute as the input handler — covers the case where
      // the user picks a frequency from a dropdown on the syringe row.
      recomputeSyringeForPatient(p, state.medications);
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });

    // Delete patient
    $("delete-patient").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      const name = p && p.name ? p.name : "";
      const msg = name
        ? `هل تريد تفريغ السرير وحذف المريض "${name}"؟`
        : "هل تريد تفريغ هذا السرير؟";
      if (!confirm(msg)) return;
      const bedKey = state.currentBed.key;
      Storage.deletePatient(bedKey);
      delete state.patients[bedKey];
      state.currentBed = null;
      refreshStatsAndRooms();
      UI.showView("home");
      // Sync the single deleted bed to Supabase (don't bulk-delete)
      if (SBSync && SBSync.pushPatientDelete) {
        SBSync.pushPatientDelete(bedKey).then(r => {
          if (!r.ok) console.warn("[Supabase] patient delete push failed:", r.error);
        });
      }
    });

    // ----- Bottom navigation -----
    $("bottom-nav").addEventListener("click", (e) => {
      const item = e.target.closest(".nav-item");
      if (!item) return;
      const nav = item.dataset.nav;
      if (nav === "home") {
        state.currentBed = null;
        UI.showView("home");
      } else if (nav === "patients") {
        UI.showView("patients");
        UI.renderPatientsList(state.patients);
      }
    });

    // ----- Bottom sheet -----
    $("sheet-close").addEventListener("click", closeSheet);
    $("sheet-cancel").addEventListener("click", closeSheet);
    $("sheet-overlay").addEventListener("click", closeSheet);

    // Search in sheet
    let searchTimer = null;
    $("med-search").addEventListener("input", (e) => {
      state.sheet.filter = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
        bindMedOptionCheckboxes();
      }, 100);
    });

    // Tab clicks — switch the active form, keep the search query.
    // Tab keys are now any of: vial, ampule, prefilled-syringe, tablet, supplies.
    $("sheet-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".sheet-tab");
      if (!tab) return;
      const newTab = tab.dataset.tab;
      if (state.sheet.activeTab === newTab) return; // no change
      state.sheet.activeTab = newTab;
      UI.setActiveTabUI(newTab);
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, newTab);
      bindMedOptionCheckboxes();
    });

    // Med option checkboxes (delegated)
    $("med-options").addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const id = cb.dataset.medId;
      if (cb.checked) addToSelected(id);
      else removeFromSelected(id);
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
      bindMedOptionCheckboxes();
      syncSelectedUI();
    });

    // Selected list interactions (delegated)
    // - ✕ button (delete-selected) → removes the med from the selected list
    // - "+" button (freq-increment) → freq increases by 1 (max 12)
    // - "−" button (freq-decrement) → freq decreases by 1 (min 1)
    // For custom freqs ("حسب القياس"), tapping + or - switches to numeric:
    //   "+" → 1×1, "−" → 1×1 (can't be 1×0).
    // Dose stays unchanged; only the frequency changes.
    $("selected-list").addEventListener("click", (e) => {
      const del = e.target.closest('[data-action="del-selected"]');
      if (del) {
        const idx = parseInt(del.dataset.selIndex, 10);
        const item = state.sheet.selectedList[idx];
        if (!item) return;
        state.sheet.selected.delete(item.id);
        state.sheet.selectedList.splice(idx, 1);
        UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
        bindMedOptionCheckboxes();
        syncSelectedUI();
        return;
      }

      const incBtn = e.target.closest('[data-action="freq-increment"]');
      const decBtn = e.target.closest('[data-action="freq-decrement"]');
      if (!incBtn && !decBtn) return;

      const selItem = (incBtn || decBtn).closest(".sel-item");
      if (!selItem) return;
      const idx = parseInt(selItem.dataset.selIndex, 10);
      const item = state.sheet.selectedList[idx];
      if (!item) return;

      const MAX = 12;
      const MIN = 1;
      let currentCount = (function () {
        const m = (item.frequency || "").match(/×\s*(\d+)/);
        return m ? parseInt(m[1], 10) : -1; // -1 = custom/non-numeric
      })();

      let newCount;
      if (currentCount === -1) {
        // Was custom: switching to numeric starts at 1
        newCount = 1;
      } else if (incBtn) {
        newCount = Math.min(MAX, currentCount + 1);
      } else {
        newCount = Math.max(MIN, currentCount - 1);
      }
      item.frequency = `1×${newCount}`;
      syncSelectedUI();
    });

    // Add selected to patient
    $("sheet-add").addEventListener("click", () => {
      if (!state.currentBed) return;
      if (state.sheet.selectedList.length === 0) return;
      const p = ensurePatient(state.currentBed.key);

      // 1) Add the user-selected meds to the patient
      state.sheet.selectedList.forEach(s => {
        p.medications.push({
          id:        s.id,
          nameTrade: s.nameTrade,
          nameAr:    s.nameAr,
          nameEn:    s.nameEn,
          form:      s.form || "vial",
          dose:      s.dose,
          frequency: s.frequency
        });
      });
      const userAddedCount = state.sheet.selectedList.length;

      // 2) Recompute the auto-managed syringe entry. This updates
      //    (or creates, or removes) the single syringe-5cc entry so
      //    its frequency = total vial + ampule count on the patient.
      //    The user said NOT to show a message about the syringe —
      //    the syringe is silently maintained in the background.
      recomputeSyringeForPatient(p, state.medications);

      persistPatient(state.currentBed.key);
      closeSheet();
      // No mention of the auto-managed syringe — just the meds the
      // user explicitly added.
      flashHint("تمت إضافة " + userAddedCount + " علاج");
      // Return to rooms view immediately so the pharmacist can move to
      // the next patient without an extra tap on the back button.
      state.currentBed = null;
      UI.showView("home");
    });

    // ----- Admin: open via header gear -----
    $("open-admin").addEventListener("click", openAdminView);

    // ----- Print Chart (التشارت) -----
    // Builds a patient × medication matrix and opens the print dialog.
    // Visible to both admin and pharmacist — it's the final product.
    $("print-chart-btn").addEventListener("click", () => {
      if (!state.medications || state.medications.length === 0) {
        flashHint("لا توجد أدوية في الكتالوج");
        return;
      }
      UI.buildChartReport(state.patients, state.medications);

      // Detect installed PWA on iOS. window.print() is not reliably
      // supported in iOS Safari's standalone mode (when the app is
      // added to the home screen). The workaround: open the chart in
      // a new Safari tab, which has full print support, and auto-
      // trigger print from there.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        navigator.standalone === true;

      if (isIOS && isStandalone) {
        // Use the new-window workaround for iOS PWA
        if (!printChartInNewWindow()) {
          // window.open() was blocked → fall back to direct print
          // (which usually doesn't work in iOS PWA, but it's our only
          // option if pop-ups are blocked). Show a hint so the user
          // knows why their browser tab didn't open.
          flashHint("تعذّر فتح نافذة الطباعة — جرّب في متصفح Safari مباشرة");
          requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
        }
      } else {
        // Browser (any platform) or Android PWA: window.print() works.
        // Defer by two animation frames so iOS Safari has time to lay
        // out the chart DOM before the print dialog opens.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.print();
          });
        });
      }
    });

    // ----- Sync now (manual) -----
    // Pulls the catalog + patients from Supabase (non-destructive merge
    // for patients). Visible to both admin and pharmacist. Disables
    // itself and spins the icon while the sync is running to prevent
    // double-clicks.
    $("sync-now-btn").addEventListener("click", syncNow);

    // Admin back button
    $("admin-back-btn").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = false;
      state.admin.selectedId = null;
      UI.hideAdminForm();
      state.currentBed = null;
      UI.showView("home");
    });

    // Admin "دواء جديد"
    $("admin-new-btn").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = true;
      state.admin.selectedId = null;
      UI.showAdminForm({}, true);
      UI.renderAdminMedList(state.medications, null);
      $("adm-name-ar").focus();
    });

    // Admin list clicks (delegated) — edit / delete / move
    $("admin-med-list").addEventListener("click", (e) => {
      const editBtn = e.target.closest('[data-action="edit-med"]');
      const delBtn  = e.target.closest('[data-action="del-med"]');
      const moveBtn = e.target.closest('[data-action^="move-"]');
      if (editBtn) {
        const id = editBtn.dataset.medId;
        const m = state.medications.find(x => x.id === id);
        if (!m) return;
        state.admin.editingId = id;
        state.admin.isNew = false;
        state.admin.selectedId = id;
        UI.showAdminForm(m, false);
        UI.renderAdminMedList(state.medications, id);
      } else if (delBtn) {
        const id = delBtn.dataset.medId;
        const m = state.medications.find(x => x.id === id);
        if (!m) return;
        const label = UI.primaryName(m) || "هذا الدواء";
        if (!confirm(`حذف "${label}" من الكتالوج؟\n(لن يؤثر على العلاجات المسجلة بالفعل على المرضى)`)) return;
        state.medications = state.medications.filter(x => x.id !== id);
        Storage.saveMedications(state.medications); pushCatalogAfterEdit();
        if (state.admin.editingId === id) {
          state.admin.editingId = null;
          state.admin.isNew = false;
          UI.hideAdminForm();
        }
        state.admin.selectedId = null;
        UI.renderAdminMedList(state.medications, null);
        flashHint("تم حذف الدواء من الكتالوج");
      } else if (moveBtn) {
        const id = moveBtn.dataset.medId;
        const action = moveBtn.dataset.action; // move-top | move-up | move-down | move-bottom
        const idx = state.medications.findIndex(x => x.id === id);
        if (idx < 0) return;
        const item = state.medications[idx];
        state.medications.splice(idx, 1);
        let newIdx;
        if (action === "move-top")         newIdx = 0;
        else if (action === "move-up")      newIdx = Math.max(0, idx - 1);
        else if (action === "move-down")   newIdx = Math.min(state.medications.length, idx + 1);
        else if (action === "move-bottom") newIdx = state.medications.length;
        else return;
        state.medications.splice(newIdx, 0, item);
        Storage.saveMedications(state.medications); pushCatalogAfterEdit();
        UI.renderAdminMedList(state.medications, id);
        // Scroll the moved row into view if it's outside the visible area
        const rowEl = document.querySelector(`.admin-med-row[data-med-id="${id}"]`);
        if (rowEl) rowEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });

    // Admin: frequency dropdown — toggle custom field
    $("adm-freq").addEventListener("change", UI.toggleAdminFreqCustom);

    // Admin: cancel edit
    $("admin-cancel").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = false;
      UI.hideAdminForm();
    });

    // Admin: save (add or update)
    $("admin-save").addEventListener("click", () => {
      const data = UI.readAdminForm();
      // validation — at least one name is required (trade, ar, or en)
      if (!data.nameTrade && !data.nameAr && !data.nameEn) {
        flashHint("أدخل اسم الدواء (تجاري أو علمي)");
        $("adm-name-trade").focus();
        return;
      }
      // dose is OPTIONAL — some forms (syrups, solutions) don't have
      // a fixed dose, so we allow it to be empty.
      if (!data.defaultFrequency) {
        flashHint("أدخل التكرار الافتراضي");
        $("adm-freq").focus();
        return;
      }
      if (state.admin.isNew) {
        // generate stable id from scientific name (preferred) or trade name or arabic
        const baseSource = data.nameEn || data.nameTrade || data.nameAr;
        const base = baseSource
          .toLowerCase()
          .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 32) || ("med-" + Date.now());
        let id = base;
        let counter = 2;
        while (state.medications.some(m => m.id === id)) {
          id = `${base}-${counter++}`;
        }
        state.medications.push({
          id,
          nameTrade: data.nameTrade,
          nameAr:    data.nameAr,
          nameEn:    data.nameEn,
          form:      data.form,
          defaultDose: data.defaultDose,
          defaultFrequency: data.defaultFrequency
        });
        Storage.saveMedications(state.medications); pushCatalogAfterEdit();
        state.admin.editingId = id;
        state.admin.isNew = false;
        state.admin.selectedId = id;
        UI.renderAdminMedList(state.medications, id);
        // keep form open so admin can keep editing if desired, but switch title to edit
        UI.showAdminForm(state.medications.find(m => m.id === id), false);
        flashHint("تمت إضافة الدواء");
      } else {
        const m = state.medications.find(x => x.id === state.admin.editingId);
        if (!m) return;
        m.nameTrade = data.nameTrade;
        m.nameAr = data.nameAr;
        m.nameEn = data.nameEn;
        m.form = data.form;
        m.defaultDose = data.defaultDose;
        m.defaultFrequency = data.defaultFrequency;
        Storage.saveMedications(state.medications); pushCatalogAfterEdit();
        UI.renderAdminMedList(state.medications, m.id);
        flashHint("تم حفظ التعديلات");
      }
    });

    // Admin: wipe patients only (keep medications)
    $("admin-wipe").addEventListener("click", () => {
      if (!confirm("⚠ تحذير: هذا سيمسح جميع بيانات المرضى نهائيًا.\nالأدوية لن تُمسح.\nهل أنت متأكد؟")) return;
      try {
        localStorage.removeItem("pharma.patients.v1");
      } catch (e) { /* ignore */ }
      state.patients = {};
      state.currentBed = null;
      refreshStatsAndRooms();
      flashHint("تم مسح جميع بيانات المرضى");
      // Sync wipe to Supabase — explicit bulk delete (the only place
      // that does this; everywhere else we upsert-merge to avoid
      // wiping data that other devices may still need to push up).
      if (SBSync && SBSync.pushPatientsWipe) {
        SBSync.pushPatientsWipe().then(r => {
          if (!r.ok) console.warn("[Supabase] wipe push failed:", r.error);
        });
      }
    });

    // ----- Supabase: test / save / clear -----
    $("sb-test").addEventListener("click", async () => {
      if (!SB) { flashHint("مكتبة Supabase غير محمّلة"); return; }
      // Use whatever is currently in the inputs (even if not saved yet)
      const url = $("sb-url").value.trim();
      const anonKey = $("sb-key").value.trim();
      if (!url || !anonKey) {
        updateSupabaseStatusUI("أدخل URL و Anon Key أولاً", "error");
        return;
      }
      // Save temporarily so testConnection can use it
      SB.saveConfig(url, anonKey);
      updateSupabaseStatusUI("جارٍ الاختبار…", "loading");
      const res = await SB.testConnection();
      if (res.ok) {
        updateSupabaseStatusUI("الاتصال ناجح ✓", "connected");
        flashHint("تم الاتصال بـ Supabase بنجاح");
      } else {
        updateSupabaseStatusUI("فشل الاتصال: " + res.error, "error");
        flashHint("فشل الاتصال بـ Supabase");
      }
    });

    $("sb-save").addEventListener("click", async () => {
      if (!SB) { flashHint("مكتبة Supabase غير محمّلة"); return; }
      const url = $("sb-url").value.trim();
      const anonKey = $("sb-key").value.trim();
      if (!url || !anonKey) {
        updateSupabaseStatusUI("أدخل URL و Anon Key أولاً", "error");
        flashHint("أدخل URL و Anon Key");
        return;
      }
      SB.saveConfig(url, anonKey);
      updateSupabaseStatusUI("تم الحفظ · جارٍ المزامنة…", "loading");
      flashHint("تم حفظ إعدادات Supabase");
      // Try to pull the catalog right away
      const res = await SBSync.pullCatalog();
      if (res.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
        updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
        flashHint("تمت المزامنة من Supabase");
      } else {
        // Pull failed → push the local catalog to populate the empty table
        const pushRes = await SBSync.pushCatalog();
        if (pushRes.ok) {
          updateSupabaseStatusUI(`مربوط · ${pushRes.count} دواء (مرفوع محليًا)`, "connected");
          flashHint("تم رفع الكتالوج المحلي إلى Supabase");
        } else {
          updateSupabaseStatusUI("مربوط لكن فشلت المزامنة: " + pushRes.error, "error");
          flashHint("فشلت المزامنة مع Supabase");
        }
      }
      // Also merge-pull patients so the user's local patients stay
      // in sync with any other device that pushed data to the cloud.
      const pres = await SBSync.pullPatients();
      if (pres.ok) {
        state.patients = Storage.loadPatients();
        refreshStatsAndRooms();
      }
    });

    $("sb-clear").addEventListener("click", () => {
      if (!SB) return;
      if (!confirm("إلغاء ربط Supabase؟ سيبقى الكتالوج المحلي كما هو.")) return;
      SB.clearConfig();
      refreshSupabaseInputs();
      updateSupabaseStatusUI("غير مربوط");
      flashHint("تم إلغاء ربط Supabase");
    });

    // Manual push/pull buttons (advanced)
    $("sb-push-now").addEventListener("click", pushCatalogManual);
    $("sb-pull-now").addEventListener("click", pullCatalogManual);
  }

  // -------- Admin view --------
  function openAdminView() {
    state.admin.editingId = null;
    state.admin.isNew = false;
    state.admin.selectedId = null;
    UI.hideAdminForm();
    UI.renderAdminMedList(state.medications, null);
    refreshSupabaseInputs();
    // The default Supabase config is embedded, so the app is always
    // "configured" out of the box. Show that in the status badge.
    if (SB && SB.isConfigured()) {
      const usingEmbedded = SB.isUsingEmbedded();
      const label = usingEmbedded ? "مربوط تلقائيًا · جاهز للمزامنة" : "مربوط بإعداد مخصص";
      updateSupabaseStatusUI(label, "connected");
    } else {
      updateSupabaseStatusUI("غير مربوط");
    }
    UI.showView("admin");
  }

  // -------- Sheet helpers --------
  function openSheetFromPatientView() {
    if (!state.currentBed) {
      UI.showView("home");
      flashHint("اختر سريرًا أولًا لإضافة علاج");
      return;
    }
    resetSheet();
    // Render the tabs (auto-picks the first non-empty form as active)
    state.sheet.activeTab = UI.renderSheetTabs(state.medications, state.sheet.activeTab) || "vial";
    UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
    bindMedOptionCheckboxes();
    syncSelectedUI();
    UI.openSheet();
    state.sheet.open = true;
  }
  function closeSheet() {
    UI.closeSheet();
    state.sheet.open = false;
  }
  function resetSheet() {
    state.sheet.selected.clear();
    state.sheet.selectedList = [];
    state.sheet.filter = "";
    // Default to "vial" — renderSheetTabs will pick a real default
    // (first non-empty form) when the sheet opens.
    state.sheet.activeTab = "vial";
    $("med-search").value = "";
    $("selected-list").innerHTML = "";
    $("sheet-add").disabled = true;
    $("sheet-selected").hidden = true;
    $("selected-count").textContent = "0";
  }

  // Re-bind checkboxes after re-render (preserves checked state from selected set)
  function bindMedOptionCheckboxes() {
    document.querySelectorAll('#med-options input[type="checkbox"]').forEach(cb => {
      cb.checked = state.sheet.selected.has(cb.dataset.medId);
    });
  }

  function addToSelected(id) {
    if (state.sheet.selected.has(id)) return;
    const m = state.medications.find(x => x.id === id);
    if (!m) return;
    state.sheet.selected.add(id);
    state.sheet.selectedList.push({
      id: m.id,
      nameTrade: m.nameTrade,
      nameAr:    m.nameAr,
      nameEn:    m.nameEn,
      form:      m.form || "vial",
      dose: m.defaultDose,
      frequency: m.defaultFrequency
    });
  }
  function removeFromSelected(id) {
    state.sheet.selected.delete(id);
    state.sheet.selectedList = state.sheet.selectedList.filter(s => s.id !== id);
  }
  function syncSelectedUI() {
    const count = state.sheet.selectedList.length;
    $("selected-count").textContent = String(count);
    $("sheet-selected").hidden = count === 0;
    $("sheet-add").disabled = count === 0;
    UI.renderSelectedList(state.sheet.selectedList);
  }

  // -------- Open a patient --------
  function openPatient({ key, roomId, bed }) {
    state.currentBed = { key, roomId, bed };
    const p = state.patients[key] || null;
    UI.renderPatientView(p, roomId, bed);
    UI.showView("patient");
  }

  // -------- Lightweight toast (no extra DOM) --------
  let hintTimer = null;
  function flashHint(msg) {
    let t = $("app-hint");
    if (!t) {
      t = document.createElement("div");
      t.id = "app-hint";
      t.style.cssText = `
        position:fixed;
        left:50%; top: calc(env(safe-area-inset-top, 0px) + 16px);
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92);
        color:#fff;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 700;
        z-index: 200;
        box-shadow: 0 4px 14px rgba(15,23,42,0.30);
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease, transform 180ms ease;
      `;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.style.opacity = "1";
      t.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
  }

  // -------- Boot --------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})(window);
