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
  function showLogin() {
    $("login-screen").hidden = false;
    // Reset any previous form state
    $("login-username").value = "";
    $("login-password").value = "";
    $("login-error").hidden = true;
    // Focus the username field for fast typing on phones
    setTimeout(() => { try { $("login-username").focus(); } catch (e) {} }, 100);
  }

  function showApp() {
    $("login-screen").hidden = true;
    // Update the user label in the header
    const user = Auth ? Auth.getCurrentUser() : null;
    const label = $("current-user-label");
    if (label) label.textContent = user ? user.displayName : "—";
  }

  // Apply role-based visibility (hide ⚙ from pharmacist role)
  function applyRoleVisibility() {
    if (!Auth) return;
    const isAdmin = Auth.isAdmin();
    const adminBtn = $("open-admin");
    if (adminBtn) adminBtn.hidden = !isAdmin;
    // chart button + logout button are always visible (both roles)
    const chartBtn = $("print-chart-btn");
    if (chartBtn) chartBtn.hidden = false;
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

    // Quick login buttons (one tap, no password needed for demo)
    $("quick-admin").addEventListener("click", () => {
      const res = Auth.loginAs("admin");
      if (res.ok) onLoginSuccess();
    });
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
    const res = await SBSync.pullCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      refreshStatsAndRooms();
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint("تمت مزامنة الكتالوج من Supabase");
    } else if (res.skipped) {
      // Pull was skipped to protect local edits — keep the local catalog
      updateSupabaseStatusUI("يعمل محليًا · السحب متأخر", "error");
      flashHint("الكتالوج المحلي محفوظ (آخر رفع لـ Supabase فشل)");
    } else {
      updateSupabaseStatusUI("خطأ: " + res.error, "error");
      console.warn("[Supabase] pull failed:", res.error);
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
    if (!confirm("سحب الكتالوج من السحابة سيستبدل نسختك المحلية.\nهل تريد المتابعة؟")) return;
    updateSupabaseStatusUI("جارٍ السحب…", "loading");
    const res = await SBSync.pullCatalog(true);  // force = true
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      refreshStatsAndRooms();
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم سحب ${res.count} دواء من السحابة`);
    } else {
      updateSupabaseStatusUI("فشل السحب: " + res.error, "error");
      flashHint("فشل السحب من السحابة: " + res.error);
    }
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
        Storage.deletePatient(state.currentBed.key);
        delete state.patients[state.currentBed.key];
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
      p._saveTimer = setTimeout(() => persistPatient(state.currentBed.key), 400);
    });
    $("meds-list").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex || t.dataset.field !== "frequency") return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      p.medications[idx].frequency = t.value;
      persistPatient(state.currentBed.key);
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
      Storage.deletePatient(state.currentBed.key);
      delete state.patients[state.currentBed.key];
      state.currentBed = null;
      refreshStatsAndRooms();
      UI.showView("home");
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
      } else if (nav === "add") {
        // If we're inside a patient view → open the sheet directly
        if (state.currentBed) {
          openSheetFromPatientView();
        } else {
          // Otherwise, prompt the user to pick a bed first
          state.currentBed = null;
          UI.showView("home");
          flashHint("اختر سريرًا أولًا لإضافة علاج");
        }
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
      persistPatient(state.currentBed.key);
      closeSheet();
      flashHint("تمت إضافة " + state.sheet.selectedList.length + " علاج");
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
      window.print();
    });

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
      if (!data.defaultDose) {
        flashHint("أدخل الجرعة الافتراضية");
        $("adm-dose").focus();
        return;
      }
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

    // Admin: reset to defaults
    $("admin-reset").addEventListener("click", () => {
      if (!confirm("استعادة قائمة الأدوية الافتراضية؟\nسيتم استبدال جميع التعديلات بقائمة الأدوية التجريبية الأصلية.")) return;
      Storage.resetMedicationsToDefault();
      state.medications = Storage.loadMedications();
      state.admin.editingId = null;
      state.admin.isNew = false;
      state.admin.selectedId = null;
      UI.hideAdminForm();
      UI.renderAdminMedList(state.medications, null);
      flashHint("تم استعادة القائمة الافتراضية");
      pushCatalogAfterEdit();  // Sync the reset to Supabase
    });

    // Admin: wipe all data
    $("admin-wipe").addEventListener("click", () => {
      if (!confirm("⚠ تحذير: هذا سيمسح جميع بيانات المرضى والأدوية نهائيًا.\nهل أنت متأكد؟")) return;
      if (!confirm("التأكيد النهائي: لا يمكن التراجع. متابعة؟")) return;
      try {
        localStorage.removeItem("pharma.patients.v1");
        localStorage.removeItem("pharma.medications.v1");
      } catch (e) { /* ignore */ }
      state.patients = {};
      Storage.resetMedicationsToDefault();
      state.medications = Storage.loadMedications();
      state.currentBed = null;
      state.admin.editingId = null;
      state.admin.isNew = false;
      state.admin.selectedId = null;
      UI.hideAdminForm();
      UI.renderAdminMedList(state.medications, null);
      refreshStatsAndRooms();
      flashHint("تم مسح جميع البيانات");
      pushCatalogAfterEdit();  // Sync the reset to Supabase
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
        refreshStatsAndRooms();
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
